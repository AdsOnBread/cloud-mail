import { filedConversations, inboxMember } from './conversation-filing';
import { ensureThreads } from '../mobile/threads';
import { camel } from '../mobile/service';
import BizError from '../error/biz-error';
import emailService from './email-service';
import starService from './star-service';

const visible = 'e.user_id=? AND a.user_id=e.user_id AND a.is_del=0 AND e.is_del=0 AND e.trashed_at IS NULL AND e.status NOT IN (6,7)';
const limitOf = (value) => Math.min(100, Math.max(1, Math.floor(Number(value)) || 30));
const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
async function resolve(db, userId, anchor) {
	if (!validId(anchor)) throw new BizError('Conversation not found.', 404);
	const row = await db
		.prepare(
			`SELECT m.thread_id FROM email e JOIN account a ON a.account_id=e.account_id
    JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id WHERE ${visible} AND e.email_id=?`,
		)
		.bind(userId, Number(anchor))
		.first();
	if (!row) throw new BizError('Conversation not found.', 404);
	return row.thread_id;
}
function participants(row, folder) {
	if (folder === 'sent') {
		try {
			const people = JSON.parse(row.sent_recipients || '[]');
			const names = people.map((person) => person.name || person.address || (typeof person === 'string' ? person : '')).filter(Boolean);
			if (names.length) return 'To: ' + names.join(', ');
		} catch {
			/* Older rows may lack structured recipients. */
		}
	}
	const names = JSON.parse(row.participants).filter(Boolean);
	return names.map((name) => (names.length > 1 ? name.split(/\s+/)[0] : name)).join(', ');
}
export async function conversationList(c, p, userId) {
	const db = c.env.db;
	await ensureThreads(db, userId);
	const filters = [];
	const args = [userId];
	if (!['inbox', 'sent', 'starred', 'archived', 'snoozed'].includes(p.folder)) throw new BizError('Invalid folder.', 400);
	if (p.folder === 'inbox') filters.push(inboxMember);
	if (p.folder === 'archived') filters.push('f.email_id IS NOT NULL AND f.wake_at IS NULL');
	if (p.folder === 'snoozed') filters.push('f.wake_at>unixepoch()');
	if (p.folder === 'sent') filters.push('e.type=1');
	if (p.folder === 'starred') filters.push('s.star_id IS NOT NULL');
	// Starred is deliberately user-wide, matching the existing web folder.
	if (p.folder !== 'starred' && Number(p.allReceive) !== 1) {
		filters.push('e.account_id=?');
		args.push(Number(p.accountId) || 0);
	}
	if (p.q?.trim()) {
		const term =
			'%' +
			p.q
				.trim()
				.slice(0, 200)
				.replace(/[\\%_]/g, '\\$&') +
			'%';
		filters.push(
			`(e.name LIKE ? ESCAPE '\\' OR e.send_email LIKE ? ESCAPE '\\' OR e.recipient LIKE ? ESCAPE '\\' OR e.cc LIKE ? ESCAPE '\\' OR e.subject LIKE ? ESCAPE '\\' OR e.text LIKE ? ESCAPE '\\' OR e.content LIKE ? ESCAPE '\\' OR (e.type=1 AND e.bcc LIKE ? ESCAPE '\\'))`,
		);
		args.push(...Array(8).fill(term));
	}
	const base = `WITH ${filedConversations}, eligible AS (SELECT DISTINCT m.thread_id FROM email e JOIN account a ON a.account_id=e.account_id
    JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
    LEFT JOIN filed f ON f.thread_id=m.thread_id
    LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id WHERE ${visible} AND ${filters.join(' AND ') || '1'}),
    grouped AS (SELECT m.thread_id, MIN(e.email_id) first_email_id,MAX(CASE WHEN e.type=1 THEN e.email_id END) last_sent_id,MAX(e.email_id) last_email_id,COUNT(*) message_count,
      SUM(CASE WHEN e.type=0 AND e.unread=0 THEN 1 ELSE 0 END) unread_count,
      MAX(CASE WHEN s.star_id IS NOT NULL THEN 1 ELSE 0 END) starred,
      JSON_GROUP_ARRAY(DISTINCT CASE WHEN e.type=1 THEN 'me' ELSE COALESCE(NULLIF(e.name,''),e.send_email) END) participants
      FROM email e JOIN account a ON a.account_id=e.account_id JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
      LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id
      WHERE ${visible} AND m.thread_id IN (SELECT thread_id FROM eligible) GROUP BY m.thread_id)`;
	const bound = [userId, userId, ...args, userId];
	const asc = Number(p.timeSort) === 1;
	const limit = limitOf(p.limit);
	const chronological = ['inbox', 'sent', 'starred'].includes(p.folder);
	// Older clients may submit a numeric cursor. The new opaque cursor also carries reminder time.
	const parts = String(p.cursor || '').split(':');
	const cursor = Number(parts.at(-1)) || 0;
	const ordered = asc ? 'ASC' : 'DESC';
	const comparison = asc ? '>' : '<';
	const orderTime =
		'MAX(COALESCE(unixepoch(e.create_time),0),COALESCE(d.draft_time,0),CASE WHEN f.wake_at<=unixepoch() THEN f.wake_at ELSE 0 END)';
	const byTime = chronological && parts.length === 2 && Number.isFinite(Number(parts[0]));
	const after = byTime ? `(${orderTime},g.last_email_id) ${comparison} (?,?)` : `g.last_email_id ${comparison} ?`;
	const [count, page, nextWake] = await db.batch([
		db.prepare(`${base} SELECT COUNT(*) total FROM grouped`).bind(...bound),
		db
			.prepare(
				`${base}, draft_times AS (
        SELECT m.thread_id,MAX(unixepoch(d.updated_at)) draft_time FROM cloud_drafts d
        JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id AND a.is_del=0
        JOIN mobile_thread_members m ON m.user_id=d.user_id AND m.email_id=json_extract(d.data,'$.emailId')
        WHERE d.user_id=? AND d.state='draft' AND json_extract(d.data,'$.sendType')='reply' GROUP BY m.thread_id)
      SELECT g.*,sent.recipient sent_recipients,f.wake_at,${orderTime} activity_time,first.subject,e.create_time last_date,e.status,
      SUBSTR(COALESCE(e.text,''),1,180) preview FROM grouped g JOIN email e ON e.email_id=g.last_email_id JOIN email first ON first.email_id=g.first_email_id LEFT JOIN email sent ON sent.email_id=g.last_sent_id LEFT JOIN filed f ON f.thread_id=g.thread_id LEFT JOIN draft_times d ON d.thread_id=g.thread_id
      ${cursor ? 'WHERE ' + after : ''} ORDER BY ${chronological ? 'activity_time ' + ordered + ',' : ''} g.last_email_id ${ordered} LIMIT ?`,
			)
			.bind(...bound, userId, ...(cursor && byTime ? [Number(parts[0])] : []), ...(cursor ? [cursor] : []), limit + 1),
		db.prepare('SELECT MIN(wake_at) wake FROM conversation_filing WHERE user_id=? AND wake_at>unixepoch()').bind(userId),
	]);
	const rows = page.results.slice(0, limit);
	return {
		threads: rows.map((row) => {
			const { sent_recipients, first_email_id, last_sent_id, ...summary } = row;
			return { ...camel(summary), participants: participants(row, p.folder) };
		}),
		nextWakeAt: nextWake.results[0].wake,
		total: count.results[0].total,
		hasMore: page.results.length > limit,
		nextCursor:
			page.results.length > limit
				? chronological
					? `${rows.at(-1).activity_time}:${rows.at(-1).last_email_id}`
					: rows.at(-1).last_email_id
				: null,
	};
}
export async function draftThreads(c, ids, userId) {
	if (!Array.isArray(ids) || ids.length > 95 || ids.some((id) => !validId(id))) throw new BizError('Invalid draft anchors.', 400);
	if (!ids.length) return [];
	const db = c.env.db;
	await ensureThreads(db, userId);
	const { results } = await db
		.prepare(
			`SELECT e.email_id, m.thread_id FROM email e JOIN account a ON a.account_id=e.account_id
		JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
		WHERE ${visible} AND e.email_id IN (${ids.map(() => '?').join(',')})`,
		)
		.bind(userId, ...ids)
		.all();
	return results.map(camel);
}
export async function conversationMessages(c, p, userId) {
	const db = c.env.db;
	await ensureThreads(db, userId);
	const threadId = await resolve(db, userId, p.emailId);
	const limit = limitOf(p.limit);
	const before = Number(p.before) || 0;
	const [count, page, accounts] = await db.batch([
		db
			.prepare(
				`SELECT COUNT(*) total, MIN(e.email_id) first_id, e.subject FROM email e JOIN account a ON a.account_id=e.account_id JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id WHERE ${visible} AND m.thread_id=?`,
			)
			.bind(userId, threadId),
		db
			.prepare(
				`SELECT e.email_id,e.user_id,e.account_id,e.send_email,e.name,e.subject,e.type,e.status,e.unread,e.create_time,e.recipient,e.cc,
      CASE WHEN e.type=1 THEN e.bcc ELSE '[]' END bcc,CASE WHEN s.star_id IS NULL THEN 0 ELSE 1 END is_star,
      SUBSTR(COALESCE(NULLIF(e.text,''),e.subject,''),1,180) list_text
      FROM email e JOIN account a ON a.account_id=e.account_id JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
      LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id WHERE ${visible} AND m.thread_id=? ${before ? 'AND e.email_id<?' : ''}
      ORDER BY e.email_id DESC LIMIT ?`,
			)
			.bind(userId, threadId, ...(before ? [before] : []), limit + 1),
		db.prepare('SELECT email FROM account WHERE user_id=?').bind(userId),
	]);
	const rows = page.results.slice(0, limit);
	return {
		threadId,
		subject: count.results[0].subject,
		ownedAddresses: accounts.results.map((row) => row.email),
		total: count.results[0].total,
		messages: rows.reverse().map(camel),
		hasMore: page.results.length > limit,
		nextCursor: page.results.length > limit ? rows[0].email_id : null,
	};
}
export async function conversationAction(c, p, userId, action) {
	p ||= {};
	const anchors = Array.isArray(p.emailIds) ? [...new Set(p.emailIds)] : [];
	if (!Array.isArray(p.emailIds) || !anchors.length || anchors.length > 95 || anchors.some((id) => !validId(id)))
		throw new BizError('Invalid conversations.', 400);
	if (action === 'read' && ![0, 1].includes(p.unread ?? 1)) throw new BizError('Invalid read state.', 400);
	if (action === 'star' && typeof p.starred !== 'boolean') throw new BizError('Invalid star state.', 400);
	const db = c.env.db;
	await ensureThreads(db, userId);
	// Resolve every anchor before performing mutations, then use only server-owned members.
	const threads = new Set();
	for (const id of anchors) threads.add(await resolve(db, userId, id));
	const ids = [];
	const stars = [];
	const latest = [];

	for (const threadId of threads) {
		const { results } = await db
			.prepare(
				`SELECT e.email_id,e.type,e.status,s.star_id FROM email e JOIN account a ON a.account_id=e.account_id
      JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id
      WHERE ${visible} AND m.thread_id=? ORDER BY e.email_id DESC`,
			)
			.bind(userId, threadId)
			.all();
		if (!results.length) throw new BizError('Conversation not found.', 404);
		ids.push(...results.map((r) => r.email_id));
		stars.push(...results.filter((r) => r.star_id).map((r) => r.email_id));
		if (!results.some((r) => r.star_id)) latest.push(results[0].email_id);
	}
	if (['archive', 'snooze', 'inbox'].includes(action)) {
		if (action === 'snooze' && (!Number.isSafeInteger(p.wakeAt) || p.wakeAt <= Math.floor(Date.now() / 1000) || p.wakeAt > 253402300799))
			throw new BizError('Choose a future snooze time.', 400);
		const wakeAt = action === 'archive' ? null : action === 'inbox' ? 0 : p.wakeAt;
		// File exactly the members that were resolved, including older anchors that may survive a deletion.
		const statements = [];
		for (let i = 0; i < ids.length; i += 30) {
			const chunk = ids.slice(i, i + 30);
			statements.push(
				db
					.prepare(
						`INSERT OR REPLACE INTO conversation_filing(user_id,email_id,wake_at)
				VALUES ${chunk.map(() => '(?,?,?)').join(',')}`,
					)
					.bind(...chunk.flatMap((id) => [userId, id, wakeAt])),
			);
		}
		for (const id of anchors)
			statements.push(
				db.prepare("INSERT INTO mobile_changes(user_id,entity,entity_id,operation) VALUES(?,'message',?,'upsert')").bind(userId, id),
			);
		await db.batch(statements);
	} else if (action === 'delete') {
    const statements = [];
    for (let i = 0; i < ids.length; i += 80) {
      const batch = ids.slice(i, i + 80);
      statements.push(db.prepare(`UPDATE email SET trashed_at=CURRENT_TIMESTAMP
        WHERE user_id=? AND trashed_at IS NULL AND email_id IN (${batch.map(() => '?')}) RETURNING email_id`)
        .bind(userId, ...batch));
    }
    const changes = await db.batch(statements);
    const emailIds = changes.flatMap(change => change.results.map(row => row.email_id));
    return { conversationCount: threads.size, messageCount: emailIds.length, emailIds };
  } else if (action === 'star') {
		for (const id of p.starred ? latest : stars) await starService[p.starred ? 'add' : 'cancel'](c, { emailId: id }, userId);
	} else
		for (let offset = 0; offset < ids.length; offset += 80) {
			const chunk = ids.slice(offset, offset + 80);
			await emailService.read(c, { emailIds: chunk, unread: p.unread ?? 1 }, userId);
		}
	return { conversationCount: threads.size, messageCount: ids.length };
}
