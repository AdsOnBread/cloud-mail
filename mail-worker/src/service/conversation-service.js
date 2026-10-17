import { ensureThreads } from '../mobile/threads';
import { camel } from '../mobile/service';
import BizError from '../error/biz-error';
import emailService from './email-service';
import starService from './star-service';

const visible = 'e.user_id=? AND a.user_id=e.user_id AND a.is_del=0 AND e.is_del=0 AND e.status NOT IN (6,7)';
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
export async function conversationList(c, p, userId) {
	const db = c.env.db;
	await ensureThreads(db, userId);
	const filters = [];
	const args = [userId];
	if (!['inbox', 'sent', 'starred'].includes(p.folder)) throw new BizError('Invalid folder.', 400);
	if (p.folder === 'inbox') filters.push('e.type=0 AND e.status=0');
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
	const base = `WITH eligible AS (SELECT DISTINCT m.thread_id FROM email e JOIN account a ON a.account_id=e.account_id
    JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
    LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id WHERE ${visible} AND ${filters.join(' AND ')}),
    grouped AS (SELECT m.thread_id,MAX(e.email_id) last_email_id,COUNT(*) message_count,
      SUM(CASE WHEN e.type=0 AND e.unread=0 THEN 1 ELSE 0 END) unread_count,
      MAX(CASE WHEN s.star_id IS NOT NULL THEN 1 ELSE 0 END) starred,
      GROUP_CONCAT(DISTINCT COALESCE(NULLIF(e.name,''),e.send_email)) participants
      FROM email e JOIN account a ON a.account_id=e.account_id JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
      LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id
      WHERE ${visible} AND m.thread_id IN (SELECT thread_id FROM eligible) GROUP BY m.thread_id)`;
	const bound = [...args, userId];
	const asc = Number(p.timeSort) === 1;
	const limit = limitOf(p.limit);
	const cursor = Number(p.cursor) || 0;
	const [count, page] = await db.batch([
		db.prepare(`${base} SELECT COUNT(*) total FROM grouped`).bind(...bound),
		db
			.prepare(
				`${base} SELECT g.*,e.subject,e.create_time last_date,e.status,
      SUBSTR(COALESCE(NULLIF(e.text,''),e.subject,''),1,180) preview FROM grouped g JOIN email e ON e.email_id=g.last_email_id
      ${cursor ? `WHERE g.last_email_id ${asc ? '>' : '<'} ?` : ''} ORDER BY g.last_email_id ${asc ? 'ASC' : 'DESC'} LIMIT ?`,
			)
			.bind(...bound, ...(cursor ? [cursor] : []), limit + 1),
	]);
	const rows = page.results.slice(0, limit);
	return {
		threads: rows.map(camel),
		total: count.results[0].total,
		hasMore: page.results.length > limit,
		nextCursor: page.results.length > limit ? rows.at(-1).last_email_id : null,
	};
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
				`SELECT COUNT(*) total FROM email e JOIN account a ON a.account_id=e.account_id JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id WHERE ${visible} AND m.thread_id=?`,
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
				`SELECT e.email_id,s.star_id FROM email e JOIN account a ON a.account_id=e.account_id
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
	if (action === 'star') {
		for (const id of p.starred ? latest : stars) await starService[p.starred ? 'add' : 'cancel'](c, { emailId: id }, userId);
	} else
		for (let offset = 0; offset < ids.length; offset += 80) {
			const chunk = ids.slice(offset, offset + 80);
			if (action === 'delete') await emailService.delete(c, { emailIds: chunk.join(',') }, userId);
			else await emailService.read(c, { emailIds: chunk, unread: p.unread ?? 1 }, userId);
		}
	return { conversationCount: threads.size, messageCount: ids.length };
}
