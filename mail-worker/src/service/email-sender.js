import BizError from '../error/biz-error';
import { parseHTML } from 'linkedom';
import verifyUtils from '../utils/verify-utils';

export const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export function validateRecipients(recipients) {
	if (!Array.isArray(recipients) || recipients.length === 0 ||
		recipients.some(address => typeof address !== 'string' || !verifyUtils.isEmail(address))) {
		throw new BizError('Enter at least one valid recipient email address.', 400);
	}
	if (recipients.length > 50) {
		throw new BizError('A message can have at most 50 recipients.', 400);
	}
}

export function normalizeRecipients(to, cc = [], bcc = []) {
	if (![to,cc,bcc].every(Array.isArray)) throw new BizError('Recipients must be arrays.',400);
	validateRecipients(to);
	validateRecipients([...to,...cc,...bcc]);
	const seen = new Set();
	const unique = list => list.map(a => a.trim().toLowerCase()).filter(a => { if(seen.has(a)) return false; seen.add(a); return true; });
	const recipients = { to: unique(to), cc: unique(cc), bcc: unique(bcc) };
	return { ...recipients, all: [...recipients.to,...recipients.cc,...recipients.bcc] };
}

export function validateAttachmentCount(attachments, inline = false) {
	if (!Array.isArray(attachments)) {
		throw new BizError('Attachments must be an array.', 400);
	}
	if (attachments.length > MAX_ATTACHMENTS) {
		throw new BizError(`A message can contain at most ${MAX_ATTACHMENTS} ${inline ? 'inline images' : 'file attachments'}.`, 400);
	}
}

export async function normalizeAttachment(attachment) {
	if (!attachment || typeof attachment.filename !== 'string' || !attachment.filename.trim() || /[\r\n\0]/.test(attachment.filename)) {
		throw new BizError('Every attachment must have a valid filename.', 400);
	}
	let content = attachment.content;
	try {
		if (typeof content === 'string') {
			if (content.startsWith('data:')) {
				const match = /^data:[^,]*;base64,([\s\S]*)$/.exec(content);
				if (!match) throw new Error('Invalid data URL');
				content = match[1];
			}
			content = content.replace(/\s/g, '');
			if (content.length > MAX_MESSAGE_BYTES * 2) {
				throw new BizError('Message exceeds the 5 MiB limit, including attachments and encoding overhead.', 413);
			}
			if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
				throw new Error('Invalid base64');
			}
			content = Uint8Array.from(atob(content), char => char.charCodeAt(0)).buffer;
		} else if (ArrayBuffer.isView(content)) {
			content = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
		} else if (content instanceof Blob) {
			content = await content.arrayBuffer();
		}
		if (!(content instanceof ArrayBuffer)) throw new Error('Missing binary content');
	} catch (error) {
		if (error instanceof BizError) throw error;
		throw new BizError(`Attachment "${attachment.filename}" is missing or contains invalid file data.`, 400);
	}
	const type = attachment.mimeType || attachment.contentType || attachment.type || 'application/octet-stream';
	if (typeof type !== 'string' || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(type)) {
		throw new BizError(`Attachment "${attachment.filename}" has an invalid MIME type.`, 400);
	}
	const normalized = {
		content,
		filename: attachment.filename,
		type,
		disposition: attachment.contentId ? 'inline' : 'attachment'
	};
	if (attachment.contentId) {
		if (typeof attachment.contentId !== 'string') throw new BizError('Invalid inline image content ID.', 400);
		normalized.contentId = attachment.contentId.replace(/^<|>$/g, '');
		if (!normalized.contentId || /[\s<>]/.test(normalized.contentId)) throw new BizError('Invalid inline image content ID.', 400);
	}
	return normalized;
}

function encodedSize(bytes) {
	const base64Length = 4 * Math.ceil(bytes / 3);
	return base64Length + 2 * Math.ceil(base64Length / 76);
}

export function validateMessageSize(message) {
	const bytes = value => new TextEncoder().encode(value || '').byteLength;
	// Reserve MIME boundaries and headers, and include base64 expansion and line wrapping.
	let size = 16 * 1024 + encodedSize(bytes(message.html)) + encodedSize(bytes(message.text));
	size += bytes(JSON.stringify({ from: message.from, to: message.to, cc: message.cc, bcc: message.bcc, subject: message.subject, headers: message.headers }));
	for (const attachment of message.attachments || []) {
		size += encodedSize(attachment.content.byteLength) + bytes(attachment.filename) * 3 + bytes(attachment.type) + 1024;
	}
	if (size > MAX_MESSAGE_BYTES) {
		throw new BizError('Message exceeds the 5 MiB limit, including attachments and encoding overhead. Reduce the message or attachments.', 413);
	}
}

export async function buildMessage(params) {
	const recipients = normalizeRecipients(params.receiveEmail,params.cc,params.bcc);
	if (typeof params.subject !== 'string' || !params.subject.trim() || params.subject.length > 998 || /[\r\n]/.test(params.subject)) {
		throw new BizError('Enter a subject of 1 to 998 characters without line breaks.', 400);
	}
	if (!params.text && !params.html) throw new BizError('Enter a message body.', 400);
	const attachments = params.attachments || [];
	if (!Array.isArray(attachments)) throw new BizError('Attachments must be an array.', 400);
	validateAttachmentCount(attachments.filter(item => !item?.contentId));
	validateAttachmentCount(attachments.filter(item => item?.contentId), true);
	const message = {
		from: { email: params.accountEmail, name: params.name },
		to: recipients.to,
		subject: params.subject,
		text: params.text || '',
		html: params.html || '',
		attachments: await Promise.all(attachments.map(normalizeAttachment))
	};
	if (recipients.cc.length) message.cc = recipients.cc;
	if (recipients.bcc.length) message.bcc = recipients.bcc;
	const ids = message.attachments.filter(item => item.contentId).map(item => item.contentId);
	if (new Set(ids).size !== ids.length) throw new BizError('Inline image content IDs must be unique.', 400);
	const { document } = parseHTML(message.html);
	for (const image of document.querySelectorAll('img')) {
		const src = image.getAttribute('src') || '';
		if (src.startsWith('cid:') && !ids.includes(src.slice(4))) {
			throw new BizError('An inline image attachment is missing. Remove it or upload it again.', 400);
		}
	}
	if (params.sendType === 'reply' && params.messageId) {
		message.headers = { 'In-Reply-To': params.messageId, References: params.references || params.messageId };
	}
	validateMessageSize(message);
	return message;
}

const providerErrors = {
	E_SENDER_NOT_VERIFIED: ['Verify your sender domain in Cloudflare Email Service before sending.', 400],
	E_SENDER_DOMAIN_NOT_AVAILABLE: ['Enable Email Sending for your sender domain in Cloudflare.', 400],
	E_RECIPIENT_NOT_ALLOWED: ['The recipient is not allowed by the Cloudflare email binding.', 400],
	E_RECIPIENT_SUPPRESSED: ['Cloudflare has suppressed a recipient after a bounce or complaint.', 400],
	E_CONTENT_TOO_LARGE: ['Cloudflare rejected the message size. Reduce the body or attachments; the general limit is 5 MiB.', 413],
	E_TOO_MANY_RECIPIENTS: ['A message can have at most 50 recipients.', 400],
	E_TOO_MANY_ATTACHMENTS: ['Cloudflare rejected the attachment count. Reduce the number of attachments.', 400],
	E_RATE_LIMIT_EXCEEDED: ['Cloudflare sending rate limit reached. Try again later.', 429],
	E_DAILY_LIMIT_EXCEEDED: ['Cloudflare daily sending quota reached. Try again after the quota resets.', 429],
	E_DELIVERY_FAILED: ['Cloudflare could not deliver the message. Check the recipient address.', 502],
	E_INTERNAL_SERVER_ERROR: ['Cloudflare Email Service is temporarily unavailable. Check send activity before trying again.', 502],
	E_VALIDATION_ERROR: ['Cloudflare rejected the message. Check the sender, recipients, and attachment data.', 400],
	E_FIELD_MISSING: ['Cloudflare rejected the message because a required field is missing.', 400]
};

export async function sendMessage(binding, message) {
	if (!binding?.send) throw new BizError('Cloudflare Email Sending is not configured. Add the send_email binding named "email" and onboard your sender domain.', 503);
	try {
		return await binding.send(message);
	} catch (error) {
		console.error('Cloudflare email send failed', { code: error.code, message: error.message });
		const [message, code] = providerErrors[error.code] || ['Cloudflare could not accept the message. Check Cloudflare email activity before trying again.', 502];
		throw new BizError(message, code);
	}
}
