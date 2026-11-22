import {captureMove,withMoveRetry} from './conversation-move-undo.js';
import {conversationSenders} from './conversation-senders';
import {prepareExcludedSearch} from './mail-word-index';
import {withLabelMove} from './label-move.js';
import { mailboxAttachments } from './mailbox-attachments';
import { addMailFilters } from '../service/mail-search-filters';
import { importanceFields, importanceJoin, importanceReason, setImportance } from "./mail-importance";
import { checkCategory, categoryQuery, fileCategory, categoryFolders, purchaseMessage } from './inbox-categories';
import { changeLabels } from './mailbox-labels';
import { filedConversations, filingAnchor, inboxMember } from './conversation-filing';
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
function participants(row, folder, senders) {
	if (folder === 'sent') {
		try {
			for (const [label, field] of [['To', row.sent_recipients], ['Cc', row.sent_cc], ['Bcc', row.sent_bcc]]) {
				const people = JSON.parse(field || '[]');
				const names = people.map((person) => person.name || person.address || (typeof person === 'string' ? person : '')).filter(Boolean);
				if (names.length) return label + ': ' + names.join(', ');
			}
		} catch {
			/* Older rows may lack structured recipients. */
		}
	}
	const names = senders.map(sender => sender.name);
	return names.map((name) => (names.length > 1 ? name.split(/\s+/)[0] : name)).join(', ');
}
// Match a label folder's account-scoped membership and whole-conversation unread state.
export async function labelUnreadCounts(c, params, userId) {
	const db = c.env.db;
	await ensureThreads(db,userId);
	const combined = Number(params.allReceive) === 1;
	const {results} = await db.prepare(`WITH labeled AS (
    SELECT DISTINCT lm.label_id, m.thread_id FROM mailbox_label_members lm
    JOIN email e ON e.email_id=lm.email_id AND e.user_id=lm.user_id
    JOIN account a ON a.account_id=e.account_id
    JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
    WHERE ${visible} ${combined ? '' : 'AND e.account_id=?'}
  ), unread_labels AS (
  SELECT label_id FROM labeled WHERE EXISTS (
    SELECT 1 FROM mobile_thread_members m JOIN email e ON e.email_id=m.email_id AND e.user_id=m.user_id
    JOIN account a ON a.account_id=e.account_id
    WHERE m.thread_id=labeled.thread_id AND ${visible} AND e.type=0 AND e.unread=0
  ) UNION ALL
  SELECT l.label_id FROM cloud_drafts d JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id AND a.is_del=0
    JOIN mailbox_labels l ON l.user_id=d.user_id AND l.label_id IN (SELECT value FROM json_each(d.data,'$.labelIds'))
    WHERE d.user_id=? AND json_extract(d.data,'$.scheduledAt') IS NOT NULL AND json_extract(d.data,'$.scheduledUnread')=1
      ${combined ? '' : 'AND d.account_id=?'}
  ) SELECT label_id,COUNT(*) count FROM unread_labels GROUP BY label_id`)
		.bind(userId,...(combined ? [] : [Number(params.accountId) || 0]),userId,userId,...(combined ? [] : [Number(params.accountId) || 0])).all();
	return Object.fromEntries(results.map(row => [row.label_id,row.count]));
}

export async function conversationList(c, p, userId) {
	const db = c.env.db;
	await ensureThreads(db, userId);
	const tab = p.category ? checkCategory(p.category) : null;
  const category = categoryFolders.includes(p.folder) ? p.folder : tab;
  const categoryCounts = p.folder === 'all' && String(p.countOnly) === '1' && String(p.categoryCounts) === '1';
  if (categoryCounts) {
    const combined = Number(p.allReceive) === 1;
    // An unread reply on another alias still counts when this alias has a visible member.
    // Start with unread threads, then inspect only their members for classification and scope.
    const {results} = await db.prepare(`WITH unread AS (
      SELECT DISTINCT m.thread_id FROM email e JOIN account a ON a.account_id=e.account_id
      JOIN mobile_thread_members m ON m.user_id=e.user_id AND m.email_id=e.email_id
      WHERE ${visible} AND e.type=0 AND e.unread=0
    ), grouped AS (
      SELECT m.thread_id, MIN(CASE WHEN e.type=0 THEN e.email_id END) category_source,
        MAX(override.change_id) category_override, MAX(CASE WHEN ${purchaseMessage} THEN 1 ELSE 0 END) purchase_match
      FROM unread u CROSS JOIN mobile_thread_members m ON m.user_id=? AND m.thread_id=u.thread_id
      JOIN email e ON e.email_id=m.email_id AND e.user_id=m.user_id JOIN account a ON a.account_id=e.account_id
      LEFT JOIN mailbox_categories override ON override.email_id=e.email_id AND override.user_id=e.user_id
      WHERE ${visible} GROUP BY m.thread_id ${combined?'':'HAVING MAX(e.account_id=?)=1'}
    )${categoryQuery} SELECT category,COUNT(*) n,SUM(purchase_match) purchases FROM categorized GROUP BY category`)
      .bind(userId,userId,userId,...(combined?[]:[Number(p.accountId)||0])).all();
    return {categoryUnread:{...Object.fromEntries(results.map(r=>[r.category,r.n])),
      purchases:results.reduce((n,row)=>n+row.purchases,0)}};
  }
  const categorize = Boolean(category) || String(p.includeCategory) === '1';
  const purchases = p.folder === 'purchases';
  if(tab && p.folder!=='inbox')throw new BizError('Categories are available in Inbox.',400);
  const filters = [];
	const args = [userId];
	if (!['inbox', 'sent', 'starred', 'archived', 'snoozed', 'all', 'label','important','purchases', ...categoryFolders].includes(p.folder)) throw new BizError('Invalid folder.', 400);
	if (p.folder === 'label') {
    if (!validId(p.labelId)) throw new BizError('Invalid label.',400);
    filters.push('EXISTS (SELECT 1 FROM mailbox_label_members lm WHERE lm.user_id=e.user_id AND lm.email_id=e.email_id AND lm.label_id=?)');
    args.push(Number(p.labelId));
  }
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
	if (!(await prepareExcludedSearch(db,userId,p.folder==='starred' || Number(p.allReceive)===1 ? null : p.accountId,p.excluded))) return {preparingSearch:true};
	addMailFilters(p,filters,args,{conversation:true});
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
    summaries AS (SELECT m.thread_id,${importanceFields},${purchases?'MAX(CASE WHEN '+purchaseMessage+' THEN 1 ELSE 0 END) purchase_match,':''}${categorize?"MIN(CASE WHEN e.type=0 THEN e.email_id END) category_source, MAX(override.change_id) category_override,":""} MIN(e.email_id) first_email_id,MAX(CASE WHEN e.type=1 THEN e.email_id END) last_sent_id,MAX(e.email_id) last_email_id,COUNT(*) message_count,
      SUM(CASE WHEN e.type=0 AND e.unread=0 THEN 1 ELSE 0 END) unread_count,
      MAX(CASE WHEN s.star_id IS NOT NULL THEN 1 ELSE 0 END) starred
      FROM email e JOIN account a ON a.account_id=e.account_id JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
      LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id
      ${importanceJoin}
      ${categorize?'LEFT JOIN mailbox_categories override ON override.email_id=e.email_id AND override.user_id=e.user_id':''}
      WHERE ${visible} AND m.thread_id IN (SELECT thread_id FROM eligible) GROUP BY m.thread_id),
    grouped AS (SELECT summary.*, ${importanceReason} AS importance_reason FROM summaries summary
      LEFT JOIN mailbox_importance choice ON choice.change_id=summary.importance_change
      ${p.folder==='important'?'WHERE ('+importanceReason+') IS NOT NULL':purchases?'WHERE summary.purchase_match=1':''})${categorize?categoryQuery:''}`;
	const bound = [userId, userId, ...args, userId];
  const groupSource=categorize?'categorized':'grouped';
	if (String(p.countOnly) === '1') {
    const result=await db.prepare(`${base} SELECT COUNT(*) AS unreadThreads FROM ${groupSource} WHERE unread_count>0 ${category?'AND category=?':''}`).bind(...bound,...(category?[category]:[])).first();
    return {unreadThreads:result.unreadThreads};
  }
  // Read backwards from the first visible conversation (or the end of the folder).
  // The returned rows always follow the caller's chosen display order.
  const backward=p.pageDirection==='backward';
  const includeOffset=String(p.includeOffset)==='1';
  const asc = (Number(p.timeSort) === 1) !== backward;
	const limit = limitOf(p.limit);
	const chronological = ['inbox', 'sent', 'starred','all','label','important','purchases',...categoryFolders].includes(p.folder);
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
		db.prepare(`${base} SELECT ${category?'category,':''}COUNT(*) total, COALESCE(SUM(unread_count>0),0) unread_threads FROM ${groupSource} ${category?'GROUP BY category':''}`).bind(...bound),
		db
			.prepare(
				`${base}, draft_times AS (
        SELECT m.thread_id,MAX(unixepoch(d.updated_at)) draft_time FROM cloud_drafts d
        JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id AND a.is_del=0
        JOIN mobile_thread_members m ON m.user_id=d.user_id AND m.email_id=CASE
          WHEN json_extract(d.data,'$.sendType')='reply' THEN json_extract(d.data,'$.emailId')
          WHEN json_extract(d.data,'$.sendType')='forward' AND json_extract(d.data,'$.ui.inlineReply')=1
            THEN json_extract(d.data,'$.ui.responseSourceId') END
        WHERE d.user_id=? AND d.state='draft' GROUP BY m.thread_id)
      SELECT g.*,${includeOffset && cursor ? 'COUNT(*) OVER () remaining_count,' : ''}(SELECT json_group_array(DISTINCT lm.label_id) FROM mobile_thread_members tm
        JOIN mailbox_label_members lm ON lm.email_id=tm.email_id AND lm.user_id=tm.user_id JOIN email member ON member.email_id=tm.email_id
        JOIN account ma ON ma.account_id=member.account_id AND ma.user_id=member.user_id AND ma.is_del=0
        WHERE tm.user_id=e.user_id AND tm.thread_id=g.thread_id AND member.is_del=0 AND member.trashed_at IS NULL AND member.status NOT IN (6,7)) label_ids,
        CASE WHEN f.email_id IS NOT NULL AND (f.wake_at IS NULL OR f.wake_at>unixepoch()) THEN 1 ELSE 0 END filed_away,sent.recipient sent_recipients,sent.cc sent_cc,sent.bcc sent_bcc,f.wake_at,${orderTime} activity_time,first.subject,e.send_email last_sender_email,e.name last_sender_name,e.create_time last_date,e.status,
      SUBSTR(COALESCE(e.text,''),1,180) preview FROM ${groupSource} g JOIN email e ON e.email_id=g.last_email_id JOIN email first ON first.email_id=g.first_email_id LEFT JOIN email sent ON sent.email_id=g.last_sent_id LEFT JOIN filed f ON f.thread_id=g.thread_id LEFT JOIN draft_times d ON d.thread_id=g.thread_id
      ${category?'WHERE g.category=?':''} ${cursor ? (category?'AND ':'WHERE ') + after : ''} ORDER BY ${chronological ? 'activity_time ' + ordered + ',' : ''} g.last_email_id ${ordered} LIMIT ?`,
			)
			.bind(...bound, userId, ...(category?[category]:[]), ...(cursor && byTime ? [Number(parts[0])] : []), ...(cursor ? [cursor] : []), limit + 1),
		db.prepare(`SELECT min(wake_at) wake FROM (
        SELECT min(wake_at) wake_at FROM conversation_filing WHERE user_id=? AND wake_at>unixepoch()
        UNION ALL SELECT min(json_extract(d.data,'$.scheduledWakeAt')) FROM cloud_drafts d
        JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id AND a.is_del=0
        WHERE d.user_id=? AND json_extract(d.data,'$.scheduledAt') IS NOT NULL AND json_extract(d.data,'$.scheduledWakeAt')>unixepoch()
      )`).bind(userId,userId),
	]);
	const totals=category?count.results.find(row=>row.category===category):count.results[0];
  const total=totals?.total || 0;
  const pageSize=backward && !cursor && total ? (total-1)%limit+1 : limit;
  const rows = page.results.slice(0, pageSize);
  if (backward) rows.reverse();
  // Keyset rows can change rank between requests while remaining on the same side
  // of the date/ID boundary. Count the qualifying side in the page snapshot.
  const remaining=cursor ? (rows[0]?.remaining_count || 0) : total;
  const offset=backward ? Math.max(0,remaining-rows.length) : total-remaining;
  const hasMore=includeOffset ? rows.length>0 && offset+rows.length<total : backward ? Boolean(cursor && rows.length) : page.results.length>limit;
  const cursorOf=row=>chronological ? `${row.activity_time}:${row.last_email_id}` : row.last_email_id;
  const [files, authors] = await Promise.all([
    mailboxAttachments(db, userId, rows, 'threads'),
    conversationSenders(db, userId, rows.map(row => row.thread_id)),
  ]);

	return {
		threads: rows.map((row) => {
			const { sent_recipients, sent_cc, sent_bcc, first_email_id, last_sent_id, category_source, category_override, purchase_match, remaining_count, importance_change, replied, ...summary } = row;
			const senders = authors.get(row.thread_id)?.senders || [];
			return { ...camel(summary), ...(p.folder === 'sent' ? {} : {senders}), ...files.get(row.thread_id), labelIds: JSON.parse(row.label_ids), participants: participants(row, p.folder, senders) };
		}),
		unreadThreads: totals?.unread_threads||0,
    ...(category?{categoryUnread:Object.fromEntries(count.results.map(row=>[row.category,row.unread_threads]))}:{}),
		nextWakeAt: nextWake.results[0].wake,
    total, hasMore, ...(includeOffset ? {offset} : {}),
    firstCursor:rows.length ? cursorOf(rows[0]) : null,
    nextCursor:hasMore ? cursorOf(rows.at(-1)) : null,
	};
}
export async function draftThreads(c, ids, userId) {
	if (!Array.isArray(ids) || ids.length > 95 || ids.some((id) => !validId(id))) throw new BizError('Invalid draft anchors.', 400);
	if (!ids.length) return [];
	const db = c.env.db;
	await ensureThreads(db, userId);
  const {results}=await db.prepare(`WITH targets AS MATERIALIZED (
      SELECT e.email_id,m.thread_id FROM email e JOIN account a ON a.account_id=e.account_id
      JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
      WHERE ${visible} AND e.email_id IN (SELECT value FROM json_each(?))
    ), summaries AS (
      SELECT m.thread_id,MIN(e.email_id) first_id,${filingAnchor} filing_id,
        MAX(e.type=0 AND e.status=0) received, MAX(e.type=0 AND e.unread=0) has_unread
      FROM mobile_thread_members m JOIN email e ON e.email_id=m.email_id AND e.user_id=m.user_id
      JOIN account a ON a.account_id=e.account_id
      WHERE ${visible} AND m.thread_id IN (SELECT thread_id FROM targets)
      GROUP BY m.thread_id
    ) SELECT t.email_id,t.thread_id,first.subject,s.has_unread,
      CASE WHEN f.email_id IS NULL THEN s.received ELSE coalesce(f.wake_at<=unixepoch(),0) END inbox
    FROM targets t JOIN summaries s ON s.thread_id=t.thread_id JOIN email first ON first.email_id=s.first_id
    LEFT JOIN conversation_filing f ON f.user_id=? AND f.email_id=s.filing_id
    ORDER BY t.email_id`).bind(userId,JSON.stringify(ids.map(Number)),userId,userId).all();
	const authors = await conversationSenders(db,userId,[...new Set(results.map(row => row.thread_id))]);
  return results.map(row => ({...camel(row),...authors.get(row.thread_id)}));
}
export async function conversationMessages(c, p, userId) {
	const db = c.env.db;
	await ensureThreads(db, userId);
	const threadId = await resolve(db, userId, p.emailId);
	const limit = limitOf(p.limit);
	const before = Number(p.before) || 0;
	const [count, page, accounts, labels] = await db.batch([
		db
			.prepare(
				`WITH ${filedConversations}, summary AS (SELECT COUNT(*) total,${importanceFields},
        SUM(e.type=0) incoming, SUM(e.type=0 AND e.unread=0) unread_count,
        CASE WHEN f.email_id IS NOT NULL AND (f.wake_at IS NULL OR f.wake_at>unixepoch()) THEN 1 ELSE 0 END filed_away,
        MIN(e.email_id) first_id FROM email e JOIN account a ON a.account_id=e.account_id
        JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id LEFT JOIN filed f ON f.thread_id=m.thread_id
        ${importanceJoin} WHERE ${visible} AND m.thread_id=?)
        SELECT summary.*,first.subject,${importanceReason} AS importance_reason FROM summary
        LEFT JOIN email first ON first.email_id=summary.first_id
        LEFT JOIN mailbox_importance choice ON choice.change_id=summary.importance_change`,
            )
            .bind(userId,userId,userId,threadId),
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
    db.prepare(`SELECT DISTINCT lm.label_id FROM email e JOIN account a ON a.account_id=e.account_id
      JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
      JOIN mailbox_label_members lm ON lm.email_id=e.email_id AND lm.user_id=e.user_id
      WHERE ${visible} AND m.thread_id=?`).bind(userId,threadId),
	]);
	const rows = page.results.slice(0, limit);
	return {
		threadId,
		subject: count.results[0].subject, importanceReason:count.results[0].importance_reason,
    unreadCount: count.results[0].unread_count, incoming: count.results[0].incoming, filedAway: Boolean(count.results[0].filed_away),
		labelIds: labels.results.map(row=>row.label_id),
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
	if (action === 'importance' && typeof p.important !== 'boolean')throw new BizError('Invalid importance state.',400);
	if (action === 'star' && typeof p.starred !== 'boolean') throw new BizError('Invalid star state.', 400);
	const apply=record=>applyConversationAction(c,p,userId,action,anchors,record);
	if (action==='move' && p.clientId!==undefined)
		return withLabelMove(c.env.db,userId,p.clientId,p.labelId,['move',p.fromLabelId??0,[...anchors].sort((a,b)=>a-b)],apply);
  if (action==='move' && p.undoable===true && p.requestId!==undefined)
    return withMoveRetry(c.env.db,userId,p.requestId,JSON.stringify([p.labelId,p.fromLabelId??0,[...anchors].sort((a,b)=>a-b)]),apply);
	return apply(null);
}
async function applyConversationAction(c,p,userId,action,anchors,record) {
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
	if(action==='importance'){
    await setImportance(db,userId,ids,p.important);
  } else if (action === 'category') {
    await fileCategory(db,userId,ids,p.category);
  } else if (action === 'label') {
    await changeLabels(db,userId,ids,p.add,p.remove);
  } else if (['archive', 'snooze', 'inbox','move'].includes(action)) {
		if (action === 'snooze' && (!Number.isSafeInteger(p.wakeAt) || p.wakeAt <= Math.floor(Date.now() / 1000) || p.wakeAt > 253402300799))
			throw new BizError('Choose a future snooze time.', 400);
		const wakeAt = action === 'move' ? (p.labelId ? null : 0) : action === 'archive' ? null : action === 'inbox' ? 0 : p.wakeAt;
		// File exactly the members that were resolved, including older anchors that may survive a deletion.
		const statements = [];
    const result = {conversationCount:threads.size, messageCount:ids.length};
    if(action==='move'){
      const source=p.fromLabelId??0,destination=p.labelId;
      if(![source,destination].every(id=>Number.isSafeInteger(id) && id>=0) || source>0 && destination===source)
        throw new BizError('Choose a different destination.',400);
      const selected=[...new Set([source,destination].filter(Boolean))];
      if(selected.length){
        const {results}=await db.prepare(`SELECT label_id FROM mailbox_labels WHERE user_id=? AND label_id IN (${selected.map(()=>'?')})`).bind(userId,...selected).all();
        if(results.length!==selected.length)throw new BizError('Label not found.',404);
      }
      if (p.undoable === true) {
        result.undoToken = crypto.randomUUID();
        statements.push(...captureMove(db,userId,result.undoToken,source,destination,ids));
      }
      for(let i=0;i<ids.length;i+=30){
        const members=ids.slice(i,i+30);
        if(destination)statements.push(db.prepare(`INSERT INTO mailbox_label_members(user_id,label_id,email_id) VALUES ${members.map(()=>'(?,?,?)')} ON CONFLICT(user_id,label_id,email_id) DO NOTHING`).bind(...members.flatMap(id=>[userId,destination,id])));
        if(source)statements.push(db.prepare(`DELETE FROM mailbox_label_members WHERE user_id=? AND label_id=? AND email_id IN (${members.map(()=>'?')})`).bind(userId,source,...members));
      }
    }

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
		if (result.undoToken) statements.push(db.prepare("UPDATE conversation_move_undo SET state='ready' WHERE token=?").bind(result.undoToken));
    if (record) statements.push(record(result));
		await db.batch(statements);
    return result;
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
