const parseAddresses = value => {
	try { return JSON.parse(value || '[]').map(a => a.address || a.email || a).filter(a => typeof a === 'string'); }
	catch { return []; }
};
export function referenceIds(value) {
	return typeof value === 'string' ? (value.match(/<[^<>\s]+>/g) || []) : [];
}
export function normalizedSubject(value) {
	return (value || '').replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Pure grouping algorithm, shared by backfill and incremental reindexing. Ownership is a hard boundary.
export function groupThreads(messages, ownAddresses) {
	const own = new Set(ownAddresses.map(a => a.toLowerCase()));
	const parent = new Map(messages.map(m => [m.email_id, m.email_id]));
	function find(id) { let root = id; while (parent.get(root) !== root) root = parent.get(root); while (id !== root) { const next = parent.get(id); parent.set(id, root); id = next; } return root; }
	function union(a, b) { const x = find(a), y = find(b); if (x !== y) parent.set(Math.max(x,y), Math.min(x,y)); }
	const tokens = new Map();
	for (const m of messages) {
		for (const token of [...referenceIds(m.message_id), ...referenceIds(m.in_reply_to), ...referenceIds(m.relation)]) {
			const key = `${m.user_id}:${token}`;
			if (tokens.has(key)) union(m.email_id, tokens.get(key)); else tokens.set(key, m.email_id);
		}
		if (m.reply_to_email_id && parent.has(m.reply_to_email_id) && messages.some(p => p.email_id === m.reply_to_email_id && p.user_id === m.user_id)) union(m.email_id, m.reply_to_email_id);
	}
	const fallback = new Map();
	for (const m of [...messages].sort((a,b) => a.create_time.localeCompare(b.create_time))) {
		const subject = normalizedSubject(m.subject);
		if (!subject) continue;
		const participants = [...new Set([m.send_email, ...parseAddresses(m.recipient), ...parseAddresses(m.cc)]
			.filter(Boolean).map(a => a.toLowerCase()).filter(a => !own.has(a)))].sort().join(',');
		if (!participants) continue;
		const key = `${m.user_id}:${subject}:${participants}`;
		const time = Date.parse(m.create_time.replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(m.create_time) ? '' : 'Z'));
		const previous = fallback.get(key);
		// Conflicting explicit reference chains take precedence over subject heuristics.
		if (previous && time - previous.time <= 14*86400000 &&
			!(referenceIds(m.relation + ' ' + m.in_reply_to).length && referenceIds(previous.message.relation + ' ' + previous.message.in_reply_to).length && find(m.email_id) !== find(previous.message.email_id))) {
			union(m.email_id, previous.message.email_id);
		}
		fallback.set(key, { message: m, time });
	}
	return messages.map(m => ({ emailId: m.email_id, userId: m.user_id, threadId: `t-${find(m.email_id)}` }));
}

export async function ensureThreads(db, userId) {
	const state = await db.prepare('SELECT * FROM mobile_thread_state WHERE user_id=?').bind(userId).first();
	if (!state || state.indexed_revision === state.revision) return;
	const [rows, accounts] = await db.batch([
		db.prepare(`SELECT e.email_id,e.user_id,e.message_id,e.in_reply_to,e.relation,e.reply_to_email_id,e.subject,e.send_email,e.recipient,e.cc,e.create_time
			FROM email e JOIN account a ON a.account_id=e.account_id WHERE e.user_id=? AND e.is_del=0 AND e.status NOT IN (6,7) AND a.is_del=0`).bind(userId),
		db.prepare('SELECT email FROM account WHERE user_id=?').bind(userId)
	]);
	const groups = groupThreads(rows.results, accounts.results.map(a => a.email));
	for (let i=0; i<groups.length; i+=80) {
		await db.batch(groups.slice(i,i+80).map(m => db.prepare(`INSERT INTO mobile_thread_members(email_id,user_id,thread_id) VALUES (?,?,?)
			ON CONFLICT(email_id) DO UPDATE SET thread_id=excluded.thread_id,user_id=excluded.user_id WHERE thread_id!=excluded.thread_id OR user_id!=excluded.user_id`).bind(m.emailId,m.userId,m.threadId)));
	}
	// Preserve a concurrent writer's newer revision so the next request reindexes it.
	await db.prepare('UPDATE mobile_thread_state SET indexed_revision=? WHERE user_id=?').bind(state.revision,userId).run();
}
