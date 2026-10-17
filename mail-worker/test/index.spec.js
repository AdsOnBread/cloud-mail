import { env } from 'cloudflare:test';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { dbInit } from '../src/init/init';
import { permissionDefaults, upgradeEnglishDefaults, defaultNotice } from '../src/init/english-defaults';
import emailService from '../src/service/email-service';
import settingService from '../src/service/setting-service';
import attService from '../src/service/att-service';
import kvConst from '../src/const/kv-const';
import { t } from '../src/i18n/i18n';

function context(extra = {}) {
	const values = new Map();
	return {
		env: { ...env, ...extra },
		get: key => values.get(key), set: (key, value) => values.set(key, value),
		req: { param: () => env.jwt_secret }, text: text => text
	};
}
const mail = extra => ({ accountId: 1, subject: 'Report', content: '<p>Hello</p>', receiveEmail: ['person@external.com'], ...extra });

beforeEach(async () => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	await dbInit.init(context());
	await env.db.prepare("UPDATE setting SET send = 0").run();
	await env.db.prepare("UPDATE role SET send_type = 'count', send_count = 100").run();
	await env.db.prepare("INSERT INTO user (user_id, email, password, salt) VALUES (1, 'admin@example.com', 'unused', 'unused'), (2, 'person@example.com', 'unused', 'unused')").run();
	await env.db.prepare("INSERT INTO account (account_id, email, user_id, name) VALUES (1, 'admin@example.com', 1, 'Admin'), (2, 'person@example.com', 2, 'Person')").run();
	await settingService.refresh(context());
});
afterEach(() => vi.restoreAllMocks());

describe('Sending with local mailbox storage', () => {
	it('sends ordinary and inline attachments and preserves stored MIME metadata', async () => {
		const send = vi.fn().mockResolvedValue({ messageId: 'cf-provider-id' });
		const ctx = context({ email: { send } });
		const [row] = await emailService.send(ctx, mail({
			content: '<p>Hello</p><img src="data:image/png;base64,AP+A" />',
			attachments: [{ filename: 'report.pdf', content: 'AP+A', contentType: 'application/pdf' }]
		}), 1);
		const payload = send.mock.calls[0][0];
		expect(payload.attachments).toHaveLength(2);
		expect(payload.html).toContain(`cid:${payload.attachments[0].contentId}`);
		expect([...new Uint8Array(payload.attachments[1].content)]).toEqual([0, 255, 128]);
		expect(row.status).toBe(1);
		expect(row.providerMessageId).toBe('cf-provider-id');
		expect(row.messageId).not.toBe('cf-provider-id');
		const file = row.attList.find(att => att.filename === 'report.pdf');
		expect(file.mimeType).toBe('application/pdf');
		const obj = await env.r2.get(file.key);
		expect(obj.httpMetadata.contentType).toBe('application/pdf');
		expect([...new Uint8Array(await obj.arrayBuffer())]).toEqual([0, 255, 128]);
	});

	it('delivers internal mail and plus aliases without an external binding', async () => {
		await emailService.send(context(), mail({ receiveEmail: ['person+tag@example.com'], attachments: [{ filename: 'file.txt', content: 'SGk=', contentType: 'text/plain' }] }), 1);
		const received = await env.db.prepare('SELECT * FROM email WHERE type = 0').all();
		expect(received.results).toHaveLength(1);
		expect(received.results[0]).toMatchObject({ user_id: 2, account_id: 2, to_email: 'person+tag@example.com' });
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM attachments').first()).total).toBe(2);
	});

	it.each([
		{ receiveEmail: [] },
		{ receiveEmail: Array(51).fill('person@external.com') },
		{ attachments: Array(11).fill({ filename: 'x.txt', content: 'SGk=' }) },
		{ attachments: [{ filename: 'x.txt' }] },
		{ attachments: [{ filename: 'x.txt', content: 'invalid!' }] },
		{ content: '<img src="data:image/png;base64,AP+A" />'.repeat(11) },
		{ content: '<img src="attachments/missing.png" />' },
		{ attachments: [{ filename: 'big.bin', content: new Uint8Array(4 * 1024 * 1024) }] }
	])('fails validation before sending, persistence or quota changes (case %#)', async invalid => {
		const send = vi.fn();
		await expect(emailService.send(context({ email: { send } }), mail(invalid), 1)).rejects.toBeDefined();
		expect(send).not.toHaveBeenCalled();
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM email').first()).total).toBe(0);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM attachments').first()).total).toBe(0);
		expect((await env.db.prepare('SELECT send_count FROM user WHERE user_id = 1').first()).send_count).toBe(0);
	});

	it('does not persist or increment quota after provider rejection or missing binding', async () => {
		const send = vi.fn().mockRejectedValue(Object.assign(new Error('unverified'), { code: 'E_SENDER_NOT_VERIFIED' }));
		await expect(emailService.send(context({ email: { send } }), mail(), 1)).rejects.toMatchObject({ code: 400 });
		await expect(emailService.send(context(), mail(), 1)).rejects.toMatchObject({ code: 503 });
		expect(send).toHaveBeenCalledTimes(1);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM email').first()).total).toBe(0);
		expect((await env.db.prepare('SELECT send_count FROM user WHERE user_id = 1').first()).send_count).toBe(0);
	});

	it('loads stored inline images and rejects missing stored file bytes', async () => {
		const ctx = context();
		await env.db.prepare("INSERT INTO attachments (user_id, email_id, account_id, key, filename, mime_type, size) VALUES (1, 1, 1, 'attachments/logo.png', 'logo.png', 'image/png', 3)").run();
		await env.r2.put('attachments/logo.png', new Uint8Array([0, 255, 128]));
		const result = await attService.toImageUrlHtml(ctx, '<img src="attachments/logo.png" />');
		expect([...new Uint8Array(result.imageDataList[0].content)]).toEqual([0, 255, 128]);
		await env.r2.delete('attachments/logo.png');
		await expect(attService.toImageUrlHtml(ctx, '<img src="attachments/logo.png" />')).rejects.toMatchObject({ code: 400 });
	});

	it('preserves domain and role sending restrictions', async () => {
		const send = vi.fn();
		await env.db.prepare("UPDATE role SET send_type = 'internal'").run();
		await expect(emailService.send(context({ email: { send } }), mail({ accountId: 2 }), 2)).rejects.toBeDefined();
		expect(send).not.toHaveBeenCalled();
		await env.db.prepare("UPDATE role SET send_type = 'count', avail_domain = '@other.com'").run();
		await expect(emailService.send(context({ email: { send } }), mail({ accountId: 2 }), 2)).rejects.toBeDefined();
		expect(send).not.toHaveBeenCalled();
	});
});

describe('English defaults and settings compatibility', () => {
	it('initializes English defaults and upgrades the same database repeatedly', async () => {
		expect((await env.db.prepare('SELECT name FROM role WHERE role_id = 1').first()).name).toBe('Standard User');
		expect((await env.db.prepare('SELECT name FROM perm WHERE perm_id = 1').first()).name).toBe('Emails');
		expect((await env.db.prepare('SELECT notice_content FROM setting').first()).notice_content).toBe(defaultNotice);
		await dbInit.init(context());
		await dbInit.init(context());
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM user').first()).total).toBe(2);
	});

	it('preserves an intentionally empty announcement when initialization is repeated', async () => {
		await env.db.prepare("UPDATE setting SET notice_content = ''").run();
		await dbInit.init(context());
		expect((await env.db.prepare('SELECT notice_content FROM setting').first()).notice_content).toBe('');
	});

	it('translates exact built-in legacy labels while preserving custom labels and content', async () => {
		const oldName = permissionDefaults.find(([id]) => id === 1)[1];
		await env.db.prepare('UPDATE perm SET name = ? WHERE perm_id = 1').bind(oldName).run();
		await env.db.prepare("UPDATE perm SET name = 'Custom permission' WHERE perm_id = 2").run();
		await env.db.prepare("UPDATE role SET name = 'Custom role', description = 'Custom description' WHERE role_id = 1").run();
		await env.db.prepare('UPDATE setting SET notice_content = ?').bind(oldName).run();
		await upgradeEnglishDefaults(env.db);
		await upgradeEnglishDefaults(env.db);
		expect((await env.db.prepare('SELECT name FROM perm WHERE perm_id = 1').first()).name).toBe('Emails');
		expect((await env.db.prepare('SELECT name FROM perm WHERE perm_id = 2').first()).name).toBe('Custom permission');
		expect((await env.db.prepare('SELECT name, description FROM role WHERE role_id = 1').first())).toMatchObject({ name: 'Custom role', description: 'Custom description' });
		expect((await env.db.prepare('SELECT notice_content FROM setting').first()).notice_content).toBe(oldName);
	});

	it('upgrades original role and notice defaults while preserving historical messages and provider IDs', async () => {
		const oldRole = '\u666e\u901a\u7528\u6237';
		const oldDescription = '\u53ea\u6709\u666e\u901a\u4f7f\u7528\u6743\u9650';
		const oldNotice = '\u672c\u9879\u76ee\u4ec5\u4f9b\u5b66\u4e60\u4ea4\u6d41\uff0c\u7981\u6b62\u7528\u4e8e\u8fdd\u6cd5\u4e1a\u52a1\n<br>\n\u8bf7\u9075\u5b88\u5f53\u5730\u6cd5\u89c4\uff0c\u4f5c\u8005\u4e0d\u627f\u62c5\u4efb\u4f55\u6cd5\u5f8b\u8d23\u4efb';
		await env.db.prepare('UPDATE role SET name = ?, description = ? WHERE role_id = 1').bind(oldRole, oldDescription).run();
		await env.db.prepare('UPDATE setting SET notice_content = ?').bind(oldNotice).run();
		await env.db.prepare("INSERT INTO email (user_id, account_id, subject, content, resend_email_id) VALUES (1, 1, 'Historical', ?, 'legacy-provider-id')").bind(oldNotice).run();
		await upgradeEnglishDefaults(env.db);
		await upgradeEnglishDefaults(env.db);
		expect(await env.db.prepare('SELECT name, description FROM role WHERE role_id = 1').first()).toMatchObject({ name: 'Standard User', description: 'Standard mailbox permissions' });
		expect((await env.db.prepare('SELECT notice_content FROM setting').first()).notice_content).toBe(defaultNotice);
		expect(await env.db.prepare('SELECT content, resend_email_id FROM email').first()).toMatchObject({ content: oldNotice, resend_email_id: 'legacy-provider-id' });
	});

	it('removes legacy credentials from cache and ignores older settings submissions', async () => {
		const setting = await env.kv.get(kvConst.SETTING, { type: 'json' });
		setting.resendTokens = { 'example.com': 'obsolete-credential' };
		await env.kv.put(kvConst.SETTING, JSON.stringify(setting));
		expect(await settingService.query(context())).not.toHaveProperty('resendTokens');
		expect(await env.kv.get(kvConst.SETTING, { type: 'json' })).not.toHaveProperty('resendTokens');
		await settingService.set(context(), { title: 'English title', resendTokens: { 'example.com': 'ignored' } });
		expect(await env.kv.get(kvConst.SETTING, { type: 'json' })).not.toHaveProperty('resendTokens');
		expect(t('notEmail')).toBe('Invalid email');
	});
});
