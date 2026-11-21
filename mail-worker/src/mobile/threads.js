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
	const owners = new Map(messages.map(m => [m.email_id,m.user_id]));
	function find(id) { let root = id; while (parent.get(root) !== root) root = parent.get(root); while (id !== root) { const next = parent.get(id); parent.set(id, root); id = next; } return root; }
	function union(a, b) { const x = find(a), y = find(b); if (x !== y) parent.set(Math.max(x,y), Math.min(x,y)); }
	const tokens = new Map();
	for (const m of messages) {
		for (const token of [...referenceIds(m.message_id), ...referenceIds(m.in_reply_to), ...referenceIds(m.relation)]) {
			const key = `${m.user_id}:${token}`;
			if (tokens.has(key)) union(m.email_id, tokens.get(key)); else tokens.set(key, m.email_id);
		}
		if (m.reply_to_email_id && owners.get(m.reply_to_email_id) === m.user_id) union(m.email_id, m.reply_to_email_id);
	}
	const fallback = new Map();
	for (const m of [...messages].sort((a,b) => a.create_time.localeCompare(b.create_time) || a.email_id-b.email_id)) {
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

export const threadColumns = 'e.email_id,e.user_id,e.message_id,e.in_reply_to,e.relation,e.reply_to_email_id,e.subject,e.send_email,e.recipient,e.cc,e.create_time';

// Resolving placement after indexing keeps confirmed mail out of the delivery retry path.
async function fileDeliveredInbox(db,userId) {
  const fresh="EXISTS(SELECT 1 FROM mobile_thread_state WHERE user_id=p.user_id AND revision=indexed_revision)";
  await db.batch([
    db.prepare(`INSERT OR REPLACE INTO conversation_filing(user_id,email_id,wake_at)
      SELECT DISTINCT e.user_id,e.email_id,0 FROM scheduled_inbox_deliveries p
      JOIN mobile_thread_members sent ON sent.user_id=p.user_id AND sent.email_id=p.email_id
      JOIN email copy ON copy.email_id=p.email_id AND copy.user_id=p.user_id AND copy.is_del=0 AND copy.trashed_at IS NULL
      JOIN account sender ON sender.account_id=copy.account_id AND sender.user_id=p.user_id AND sender.is_del=0
      JOIN mobile_thread_members m ON m.user_id=sent.user_id AND m.thread_id=sent.thread_id
      JOIN email e ON e.email_id=m.email_id AND e.user_id=m.user_id
      JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id AND a.is_del=0
      WHERE p.user_id=? AND ${fresh} AND e.email_id<=p.email_id AND e.is_del=0 AND e.trashed_at IS NULL AND e.status NOT IN (6,7)`).bind(userId),
    db.prepare(`INSERT INTO mobile_changes(user_id,entity,entity_id,operation)
      SELECT p.user_id,'message',p.email_id,'upsert' FROM scheduled_inbox_deliveries p
      WHERE p.user_id=? AND ${fresh} AND EXISTS(SELECT 1 FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id AND a.is_del=0
        WHERE e.user_id=p.user_id AND e.email_id=p.email_id AND e.is_del=0 AND e.trashed_at IS NULL)`).bind(userId),
    db.prepare(`DELETE FROM scheduled_inbox_deliveries AS p WHERE p.user_id=? AND ${fresh}`).bind(userId),
  ]);
}

export async function ensureThreads(db, userId) {
  const state = await db.prepare(`SELECT s.*,EXISTS(SELECT 1 FROM scheduled_inbox_deliveries p WHERE p.user_id=s.user_id) pending
    FROM mobile_thread_state s WHERE s.user_id=?`).bind(userId).first();
  if (!state) return;
  if (state.indexed_revision!==state.revision) await indexThreads(db,userId,state.revision);
  if (state.pending) await fileDeliveredInbox(db,userId);
}

async function indexThreads(db,userId,revision) {
	const [rows, accounts] = await db.batch([
		db.prepare(`SELECT ${threadColumns}
			FROM email e JOIN account a ON a.account_id=e.account_id WHERE e.user_id=? AND e.is_del=0 AND e.trashed_at IS NULL AND e.status NOT IN (6,7) AND a.is_del=0`).bind(userId),
		db.prepare('SELECT email FROM account WHERE user_id=?').bind(userId)
	]);
	const groups = groupThreads(rows.results, accounts.results.map(a => a.email));
	for (let i=0; i<groups.length; i+=80) {
		await db.batch(groups.slice(i,i+80).map(m => db.prepare(`INSERT INTO mobile_thread_members(email_id,user_id,thread_id) VALUES (?,?,?)
			ON CONFLICT(email_id) DO UPDATE SET thread_id=excluded.thread_id,user_id=excluded.user_id WHERE thread_id!=excluded.thread_id OR user_id!=excluded.user_id`).bind(m.emailId,m.userId,m.threadId)));
	}
	// Preserve a concurrent writer's newer revision so the next request reindexes it.
	await db.prepare('UPDATE mobile_thread_state SET indexed_revision=? WHERE user_id=?').bind(revision,userId).run();
}
