export const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;

function encodedSize(bytes) {
	const base64Length = 4 * Math.ceil(bytes / 3);
	return base64Length + 2 * Math.ceil(base64Length / 76);
}

export function messageSize(message) {
	const bytes = value => new TextEncoder().encode(value || '').byteLength;
	// Reserve MIME boundaries and headers, and include base64 expansion and line wrapping.
	let size = 16 * 1024 + encodedSize(bytes(message.html)) + encodedSize(bytes(message.text));
	size += bytes(JSON.stringify({ from: message.from, to: message.to, cc: message.cc, bcc: message.bcc, subject: message.subject, headers: message.headers }));
	for (const attachment of message.attachments || []) {
		size += encodedSize(attachment.content?.byteLength ?? attachment.size) + bytes(attachment.filename) * 3 + bytes(attachment.type) + 1024;
	}
	return size;
}
