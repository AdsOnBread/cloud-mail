export function normalizedSubject(value) {
	return (value || '').replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
