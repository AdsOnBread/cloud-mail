import { describe, it, expect, vi } from 'vitest';
import { buildMessage, normalizeAttachment, sendMessage, MAX_MESSAGE_BYTES } from '../src/service/email-sender';

const params = () => ({
	accountEmail: 'sender@example.com', name: 'Sender', receiveEmail: ['person@external.com'],
	subject: 'Report', html: '<p>Your report</p>', text: 'Your report'
});

describe('Cloudflare email payloads', () => {
	it('preserves binary upload bytes, MIME type, filename and inline content IDs', async () => {
		const bytes = new Uint8Array([0, 255, 137, 80, 13, 10, 128]);
		const binary = String.fromCharCode(...bytes);
		const message = await buildMessage({ ...params(), receiveEmail: ['a@external.com', 'b@external.com'], attachments: [
			{ filename: 'report.pdf', content: `data:application/pdf;base64,${btoa(binary)}`, contentType: 'application/pdf' },
			{ filename: 'logo.png', content: bytes.buffer, mimeType: 'image/png', contentId: '<logo>' }
		] });
		expect(message.from).toEqual({ email: 'sender@example.com', name: 'Sender' });
		expect(message.to).toHaveLength(2);
		expect(message.text).toBe('Your report');
		expect([...new Uint8Array(message.attachments[0].content)]).toEqual([...bytes]);
		expect(message.attachments[0]).toMatchObject({ filename: 'report.pdf', type: 'application/pdf', disposition: 'attachment' });
		expect(message.attachments[1]).toMatchObject({ type: 'image/png', disposition: 'inline', contentId: 'logo' });
	});

	it('respects byte offsets for typed arrays and supports blobs and empty files', async () => {
		const view = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
		const att = await normalizeAttachment({ filename: 'slice.bin', content: view });
		expect([...new Uint8Array(att.content)]).toEqual([2, 3]);
		expect((await normalizeAttachment({ filename: 'file.txt', content: new Blob(['abc']) })).content.byteLength).toBe(3);
		expect((await normalizeAttachment({ filename: 'empty.txt', content: '' })).content.byteLength).toBe(0);
	});

	it.each([null, undefined, 'not base64!', 'data:text/plain,hello', 'a===', {}])('rejects malformed or unavailable content: %s', async content => {
		await expect(buildMessage({ ...params(), attachments: [{ filename: 'broken.pdf', content }] })).rejects.toMatchObject({ code: 400 });
	});

	it('rejects broken inline references and duplicate content IDs', async () => {
		await expect(buildMessage({ ...params(), html: '<img src="cid:missing" />' })).rejects.toMatchObject({ code: 400 });
		await expect(buildMessage({ ...params(), attachments: [
			{ filename: 'one.png', content: 'AP+A', contentId: 'same' },
			{ filename: 'two.png', content: 'AP+A', contentId: 'same' }
		] })).rejects.toMatchObject({ code: 400 });
	});

	it('keeps reply headers separate from provider IDs', async () => {
		const message = await buildMessage({ ...params(), sendType: 'reply', messageId: '<thread@example.com>' });
		expect(message.headers).toEqual({ 'In-Reply-To': '<thread@example.com>', References: '<thread@example.com>' });
		const binding = { send: vi.fn().mockResolvedValue({ messageId: 'cloudflare-id' }) };
		expect(await sendMessage(binding, message)).toEqual({ messageId: 'cloudflare-id' });
		expect(binding.send).toHaveBeenCalledTimes(1);
	});

	it('enforces recipient and encoded size limits, including body content', async () => {
		await expect(buildMessage({ ...params(), receiveEmail: [] })).rejects.toMatchObject({ code: 400 });
		await expect(buildMessage({ ...params(), receiveEmail: ['invalid'] })).rejects.toMatchObject({ code: 400 });
		await expect(buildMessage({ ...params(), receiveEmail: Array(51).fill('a@external.com') })).rejects.toMatchObject({ code: 400 });
		await expect(buildMessage({ ...params(), receiveEmail: Array(50).fill('a@external.com') })).resolves.toBeDefined();
		await expect(buildMessage({ ...params(), html: 'a'.repeat(MAX_MESSAGE_BYTES) })).rejects.toMatchObject({ code: 413 });
		await expect(buildMessage({ ...params(), attachments: [{ filename: 'big.pdf', content: new Uint8Array(4 * 1024 * 1024) }] })).rejects.toMatchObject({ code: 413 });
	});

	it('reports a missing binding in English', async () => {
		await expect(sendMessage(undefined, await buildMessage(params()))).rejects.toMatchObject({ code: 503, message: expect.stringContaining('Cloudflare Email Sending') });
	});

	it.each([['E_SENDER_NOT_VERIFIED', 400], ['E_RATE_LIMIT_EXCEEDED', 429], ['E_CONTENT_TOO_LARGE', 413], ['E_INTERNAL_SERVER_ERROR', 502], ['UNKNOWN', 502]])('maps %s without retrying', async (code, status) => {
		const binding = { send: vi.fn().mockRejectedValue(Object.assign(new Error('provider detail'), { code })) };
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(sendMessage(binding, await buildMessage(params()))).rejects.toMatchObject({ name: 'BizError', code: status });
		expect(binding.send).toHaveBeenCalledTimes(1);
		log.mockRestore();
	});
});
