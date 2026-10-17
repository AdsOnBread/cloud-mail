import { ensureThreads } from './threads';
import r2Service from '../service/r2-service';
import BizError from '../error/biz-error';

export const camel = row => row && Object.fromEntries(Object.entries(row).map(([k,v]) => [k.replace(/_([a-z])/g, (_,l) => l.toUpperCase()),v]));
const visible = 'e.is_del=0 AND e.status NOT IN (6,7) AND a.is_del=0';
const limitOf = n => Math.min(100, Math.max(1, Number(n) || 30));
function threadStatement(db, userId, p = {}) {
	const filter = ['1=1']; const args = [userId];
	if (p.folder === 'inbox') filter.push('e.type=0 AND e.status=0');
	if (p.folder === 'sent') filter.push('e.type=1');
	if (p.folder === 'starred') filter.push('s.star_id IS NOT NULL');
	if (Number(p.accountId)) { filter.push('e.account_id=?'); args.push(Number(p.accountId)); }
	if (p.q?.trim()) {
		filter.push('(e.subject LIKE ? OR e.send_email LIKE ? OR e.name LIKE ? OR e.recipient LIKE ? OR e.cc LIKE ? OR e.text LIKE ? OR e.content LIKE ?)');
		args.push(...Array(7).fill('%' + p.q.trim().slice(0,200) + '%'));
	}
	const outer = [];
	if (p.before) { outer.push('g.last_email_id < ?'); }
	if (p.ids?.length) outer.push(`g.thread_id IN (${p.ids.map(() => '?').join(',')})`);
	const query = `WITH base AS (
		SELECT e.*,m.thread_id,s.star_id FROM email e JOIN account a ON a.account_id=e.account_id
		JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
		LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id WHERE e.user_id=? AND ${visible}
	), grouped AS (
		SELECT m.thread_id,MAX(e.email_id) last_email_id,COUNT(*) message_count,
		SUM(CASE WHEN e.type=0 AND e.unread=0 THEN 1 ELSE 0 END) unread_count,
		SUM(CASE WHEN e.type=0 AND e.status=0 THEN 1 ELSE 0 END) inbox_count,
		SUM(CASE WHEN e.type=1 THEN 1 ELSE 0 END) sent_count,
		MAX(CASE WHEN s.star_id IS NOT NULL THEN 1 ELSE 0 END) starred,
		GROUP_CONCAT(DISTINCT e.account_id) account_ids,
		MAX(CASE WHEN ${filter.join(' AND ')} THEN 1 ELSE 0 END) eligible
		FROM base e JOIN mobile_thread_members m ON m.email_id=e.email_id
		LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id GROUP BY m.thread_id
	) SELECT g.*,e.subject,e.name sender,e.send_email sender_email,e.create_time last_date,
		SUBSTR(COALESCE(NULLIF(e.text,''),e.subject,''),1,180) preview
		FROM grouped g JOIN email e ON e.email_id=g.last_email_id
		WHERE g.eligible=1 ${outer.length ? 'AND ' + outer.join(' AND ') : ''}
		ORDER BY g.last_email_id DESC LIMIT ?`;
	if (p.before) args.push(Number(p.before));
	if (p.ids?.length) args.push(...p.ids);
	args.push(limitOf(p.limit) + 1);
	return db.prepare(query).bind(...args);
}
const threadPage = (rows, limit) => ({ threads: rows.slice(0,limit).map(camel), hasMore: rows.length>limit,
	nextCursor: rows.length>limit ? rows[limit-1].last_email_id : null });
const mailboxStatement = (db,userId) => db.prepare('SELECT * FROM account WHERE user_id=? AND is_del=0 ORDER BY sort DESC,account_id').bind(userId);
const unreadStatement = (db,userId) => db.prepare(`SELECT COUNT(*) total FROM email e JOIN account a ON a.account_id=e.account_id WHERE e.user_id=? AND ${visible} AND e.type=0 AND e.unread=0`).bind(userId);

export async function bootstrap(db,userId,p={}) {
	await ensureThreads(db,userId);
	// A single D1 batch supplies a transactionally consistent baseline and cursor.
	const [cursor,mailboxes,unread,threads] = await db.batch([
		db.prepare('SELECT COALESCE(MAX(seq),0) cursor FROM mobile_changes WHERE user_id=?').bind(userId),
		mailboxStatement(db,userId),unreadStatement(db,userId),threadStatement(db,userId,{...p,folder:p.folder || 'inbox'})
	]);
	return { cursor:cursor.results[0].cursor, mailboxes:mailboxes.results.map(camel), unreadTotal:unread.results[0].total,
		...threadPage(threads.results,limitOf(p.limit)) };
}
export async function threads(db,userId,p={}) {
	await ensureThreads(db,userId);
	return threadPage((await threadStatement(db,userId,p).all()).results,limitOf(p.limit));
}
const summarySelect = `SELECT e.email_id,e.user_id,e.account_id,e.send_email,e.name,e.subject,e.type,e.status,e.unread,e.create_time,
	e.message_id,e.in_reply_to,e.relation,e.reply_to_email_id,e.recipient,e.cc,
	CASE WHEN e.type=1 THEN e.bcc ELSE '[]' END bcc,
	COALESCE(m.thread_id,'t-'||e.email_id) thread_id,CASE WHEN s.star_id IS NULL THEN 0 ELSE 1 END is_star,
	SUBSTR(COALESCE(NULLIF(e.text,''),e.subject,''),1,180) list_text
	FROM email e JOIN account a ON a.account_id=e.account_id LEFT JOIN mobile_thread_members m ON m.email_id=e.email_id
	LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id`;
export async function changes(db,userId,p) {
	await ensureThreads(db,userId);
	const after=Number(p.after);
	if (!Number.isSafeInteger(after) || after<0) throw new BizError('Invalid synchronization cursor.',400);
	const limit=limitOf(p.limit);
	const [eventsResult,mailboxes,unread] = await db.batch([
		db.prepare('SELECT * FROM mobile_changes WHERE user_id=? AND seq>? ORDER BY seq ASC LIMIT ?').bind(userId,after,limit+1),
		mailboxStatement(db,userId),unreadStatement(db,userId)
	]);
	const hasMore=eventsResult.results.length>limit;
	const events=eventsResult.results.slice(0,limit);
	const ids=[...new Set(events.filter(e=>e.entity==='message').map(e=>e.entity_id))];
	const current=ids.length ? (await db.prepare(`${summarySelect} WHERE e.user_id=? AND ${visible} AND e.email_id IN (${ids.map(()=>'?').join(',')})`).bind(userId,...ids).all()).results : [];
	const currentMap=new Map(current.map(r=>[r.email_id,camel(r)]));
	const mailboxIds=[...new Set(events.filter(e=>e.entity==='mailbox').map(e=>e.entity_id))];
	const mailboxThreads=mailboxIds.length ? (await db.prepare(`SELECT DISTINCT m.thread_id FROM mobile_thread_members m JOIN email e ON e.email_id=m.email_id
		WHERE m.user_id=? AND e.account_id IN (${mailboxIds.map(()=>'?').join(',')})`).bind(userId,...mailboxIds).all()).results : [];
	const allThreadIds=[...new Set([...current.map(r=>r.thread_id),...events.map(e=>e.previous_thread_id).filter(Boolean),...mailboxThreads.map(t=>t.thread_id)])];
	const changedThreads={threads:[]};
	for(let offset=0;offset<allThreadIds.length;offset+=80) {
		changedThreads.threads.push(...(await threads(db,userId,{ids:allThreadIds.slice(offset,offset+80),limit:80})).threads);
	}
	const retained=new Set(changedThreads.threads.map(t=>t.threadId));
	return { cursor:events.at(-1)?.seq ?? after,hasMore,mailboxes:mailboxes.results.map(camel),unreadTotal:unread.results[0].total,
		changes:events.map(e=>({seq:e.seq,entity:e.entity,entityId:e.entity_id,
			operation:e.entity==='message' && !currentMap.has(e.entity_id) ? 'delete' : e.operation,
			newMail:!!e.new_mail,message:currentMap.get(e.entity_id) || null})),
		threads:changedThreads.threads,removedThreadIds:allThreadIds.filter(id=>!retained.has(id)) };
}
export async function threadMessages(db,userId,threadId,p={}) {
	await ensureThreads(db,userId);
	const limit=limitOf(p.limit);
	const rows=(await db.prepare(`${summarySelect} WHERE e.user_id=? AND ${visible} AND m.thread_id=? AND e.email_id>? ORDER BY e.email_id ASC LIMIT ?`)
		.bind(userId,threadId,Number(p.after)||0,limit+1).all()).results;
	return { messages:rows.slice(0,limit).map(camel),hasMore:rows.length>limit,nextCursor:rows.length>limit ? rows[limit-1].email_id:null };
}
export async function messageDetail(db,userId,emailId) {
	await ensureThreads(db,userId);
	const row=await db.prepare(`${summarySelect} WHERE e.user_id=? AND e.email_id=? AND ${visible}`).bind(userId,Number(emailId)).first();
	if (!row) throw new BizError('Message not found.',404);
	const [body,atts]=await db.batch([
		db.prepare('SELECT content,text,to_email,to_name FROM email WHERE email_id=? AND user_id=?').bind(Number(emailId),userId),
		db.prepare('SELECT * FROM attachments WHERE email_id=? AND user_id=?').bind(Number(emailId),userId)
	]);
	return {...camel(row),...camel(body.results[0]),attList:atts.results.map(a=>({...camel(a),downloadPath:`/api/mobile/v1/attachments/${a.att_id}/content`}))};
}
export async function attachment(c,userId,{id,key}) {
	const row=await c.env.db.prepare(`SELECT att.* FROM attachments att JOIN email e ON e.email_id=att.email_id JOIN account a ON a.account_id=e.account_id
		WHERE att.user_id=? AND e.user_id=? AND ${visible} AND ${id ? 'att.att_id=?' : 'att.key=?'} LIMIT 1`).bind(userId,userId,id ? Number(id):key).first();
	if (!row) throw new BizError('Attachment not found.',404);
	const obj=await r2Service.getObj(c,row.key);
	if (!obj) throw new BizError('Attachment file is unavailable.',404);
	const filename=(row.filename||'attachment').replace(/[\r\n\x00-\x1f"\\]/g,'_');
	return new Response(obj.body || obj, {headers:{'Content-Type':row.mime_type || 'application/octet-stream',
		'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
		'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
