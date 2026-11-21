import {containsExcluded,excludedPhrases} from '../../../shared/mail-search-words';
import {addPeopleFilter,addSearchDates,addSizeFilter} from '../service/mail-search-filters';
import emailUtils from '../utils/email-utils';
import BizError from '../error/biz-error';
import { permission, positive, conflict } from './auth';
import * as drafts from './drafts';
import { send } from './send';
import { normalizeRecipients, validateSubject } from '../service/email-sender';

const timeField = "json_extract(data,'$.scheduledAt')";
export async function schedule(c, userId, id, input) {
	id = positive(id);
	await permission(c, userId, 'email:send');
	const current = await drafts.get(c, userId, id, true);
	const { version, sendAt } = input;
	if (current.state === 'scheduled' && current.version === version + 1 && current.scheduledAt === sendAt)
		return { draftId: id, sendAt, version: current.version };
	if (current.version !== version || current.state !== 'draft') throw conflict(current);
	if (!Number.isSafeInteger(sendAt) || sendAt <= Math.floor(Date.now() / 1000) || sendAt > 253402300799)
		throw new BizError('Choose a future send time.', 400);
	normalizeRecipients(current.receiveEmail, current.cc, current.bcc);
	validateSubject(current.subject);
	const saved = await c.env.db
		.prepare(
			`UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',?,'$.scheduleKey',?),state='scheduled',
      version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_id=? AND version=? AND state='draft'
      AND (SELECT COUNT(*) FROM cloud_drafts d JOIN account a ON a.user_id=d.user_id AND a.account_id=d.account_id AND a.is_del=0 WHERE d.user_id=? AND json_extract(d.data,'$.scheduledAt') IS NOT NULL)<100 RETURNING version`,
		)
		.bind(sendAt, 'cloudmail.schedule/' + crypto.randomUUID(), userId, id, version, userId)
		.first();
	if (!saved) {
		const latest = await drafts.get(c, userId, id, true);
		if (latest.version !== version) throw conflict(latest);
		throw new BizError('You can have up to 100 messages in Scheduled.', 400);
	}
	return { draftId: id, sendAt, version: saved.version };
}

// Keep filing choices separate from the content revision used to claim or cancel delivery.
export async function setScheduledMark(c, userId, rawId, { field, value, version }) {
  const id = positive(rawId);
  const path = field === 'starred' ? '$.mailboxStarred' : field === 'important' ? '$.mailboxImportant' : null;
  if (!path || typeof value !== 'boolean') throw new BizError('Invalid scheduled message mark.', 400);
  const changed = await c.env.db.prepare(`UPDATE cloud_drafts SET data=json_set(data,?,?)
    WHERE user_id=? AND draft_id=? AND version=? AND state IN ('scheduled','schedule_failed')
    AND EXISTS (SELECT 1 FROM account a WHERE a.account_id=cloud_drafts.account_id AND a.user_id=cloud_drafts.user_id AND a.is_del=0)
    RETURNING draft_id`).bind(path, Number(value), userId, id, positive(version)).first();
  if (!changed) {
    await drafts.get(c,userId,id,true);
    throw new BizError('This scheduled message changed. Refresh Scheduled.', 409);
  }
  return {draftId:id,field,value};
}

// Apply the user's whole selection to one snapshot. A delivery or cancellation
// racing the request must not change a different revision or half the selection.
export function setScheduledRead(c,userId,input) {
  return setScheduledFlag(c,userId,input?.messages,'$.scheduledUnread',input?.unread);
}
export function setScheduledInbox(c,userId,input) {
  const expected=input?.previousEdit;
  if (expected!==undefined && (typeof expected!=='string' || expected.length!==36)) throw new BizError('Invalid filing change.',400);
  return setScheduledFlag(c,userId,input?.messages,'$.scheduledInbox',input?.inbox,expected);
}
async function setScheduledFlag(c,userId,selection,path,value,previousEdit) {
  if (!Array.isArray(selection) || !selection.length || selection.length>50 || typeof value!=='boolean') throw new BizError('Invalid scheduled message selection.',400);
  const messages=selection.map(row=>[positive(row?.draftId),positive(row?.version)]);
  if (new Set(messages.map(([id])=>id)).size!==messages.length) throw new BizError('Duplicate scheduled message.',400);
  const inbox=path==='$.scheduledInbox', edit=inbox ? crypto.randomUUID() : null;
  // Materialize the old flags before updating. Undo restores only messages this action moved.
  const selectionArgs=[path,JSON.stringify(messages),userId];
  if (previousEdit) selectionArgs.push(previousEdit);
  const result=await c.env.db.prepare(`WITH eligible AS MATERIALIZED (
    SELECT d.draft_id,coalesce(json_extract(d.data,?),0) old_value FROM cloud_drafts d
    JOIN account a ON a.user_id=d.user_id AND a.account_id=d.account_id AND a.is_del=0
    JOIN json_each(?) r ON json_extract(r.value,'$[0]')=d.draft_id AND json_extract(r.value,'$[1]')=d.version
    WHERE d.user_id=? AND d.state IN ('scheduled','schedule_failed')
    ${previousEdit ? "AND json_extract(d.data,'$.scheduledInboxEdit')=?" : ''}
  ) UPDATE cloud_drafts SET data=json_set(data,?,?${inbox ? ",'$.scheduledInboxEdit',?" : ''})
    WHERE draft_id IN (SELECT draft_id FROM eligible) AND (SELECT count(*) FROM eligible)=?
    RETURNING draft_id,(SELECT old_value FROM eligible WHERE eligible.draft_id=cloud_drafts.draft_id) AS old_value`)
    .bind(...selectionArgs,path,Number(value),...(inbox ? [edit] : []),messages.length).all();
  if (!result.results.length) throw new BizError('A scheduled message changed. Refresh Scheduled.',409);
  const reply={updated:result.results.length};
  if (inbox) {
    reply.edit=edit;
    reply.changed=result.results.filter(row=>Boolean(row.old_value)!==value).map(row=>row.draft_id);
  }
  return reply;
}

export async function scheduledList(c, userId, accountId, filters = {}) {
  const args = [userId];
  const conditions = ["d.user_id=?", "json_extract(d.data,'$.scheduledAt') IS NOT NULL"];
  if (accountId) {
    conditions.push('d.account_id=?');
    args.push(positive(accountId));
  }
  if (filters.labelId) {
    conditions.push("EXISTS (SELECT 1 FROM mailbox_labels l JOIN json_each(d.data,'$.labelIds') j ON j.value=l.label_id WHERE l.user_id=d.user_id AND l.label_id=?)");
    args.push(positive(filters.labelId));
  }
  const from = 'FROM cloud_drafts d JOIN account a ON a.user_id=d.user_id AND a.account_id=d.account_id AND a.is_del=0';
  const starred = "COALESCE(json_extract(d.data,'$.mailboxStarred'),0)";
  const important = "json_extract(d.data,'$.mailboxImportant')";
  const reason = `CASE WHEN ${important}=1 THEN 'user' WHEN ${important}=0 THEN NULL
    WHEN json_extract(d.data,'$.sendType')='reply' AND json_extract(d.data,'$.emailId')>0 THEN 'reply'
    WHEN EXISTS (SELECT 1 FROM json_each(d.data,'$.receiveEmail') address WHERE address.value=a.email COLLATE NOCASE) THEN 'direct' END`;
  const inbox="coalesce(json_extract(d.data,'$.scheduledInbox'),0)";
  const unread="COALESCE(json_extract(d.data,'$.scheduledUnread'),0)";
  if (filters.mark==='inbox') conditions.push(inbox+'=1');
  if (filters.mark==='starred') conditions.push(starred+'=1');
  if (filters.mark==='important') conditions.push('('+reason+') IS NOT NULL');
  if (filters.countOnly === '1') {
    const extra=filters.includeInboxUnread==='1' ? `,COUNT(CASE WHEN ${inbox}=1 AND ${unread}=1 THEN 1 END) inboxUnread` : '';
    return c.env.db.prepare(`SELECT COUNT(*) count ${extra} ${from} WHERE ${conditions.join(' AND ')}`).bind(...args).first();
  }
  if (String(filters.isUnread)==='1') conditions.push(unread+'=1');
  const fileCount = "(SELECT COUNT(*) FROM draft_files f WHERE f.user_id=d.user_id AND f.draft_id=d.draft_id AND COALESCE(f.content_id,'')='')";
  const fileNames = `(SELECT json_group_array(json_object('attachmentId',attachment_id,'filename',filename,'mimeType',mime_type,'size',size))
    FROM (SELECT attachment_id,filename,mime_type,size FROM draft_files f
      WHERE f.user_id=d.user_id AND f.draft_id=d.draft_id AND COALESCE(f.content_id,'')='' ORDER BY f.attachment_id LIMIT 3))`;
  const senderName="COALESCE(NULLIF(json_extract(d.data,'$.name'),''),NULLIF(a.name,''),a.email)";
  const columns = {
    from: ['a.email',senderName],
    to: ['receiveEmail', 'cc', 'bcc'].map(key => `json_extract(d.data,'$.${key}')`),
    subject: ["json_extract(d.data,'$.subject')"],
  };
  const text = "json_extract(d.data,'$.text')";
  columns.q = [...columns.from, ...columns.to, ...columns.subject, text];
  for (const [field, choices] of Object.entries(columns)) {
    if (field === 'from' || field === 'to') {
      addPeopleFilter(filters, field, choices, conditions, args);
      continue;
    }
    const term = filters[field]?.trim().slice(0, 200);
    if (!term) continue;
    const matches = choices.map(column => `instr(lower(${column}),lower(?))>0`);
    // HTML-only drafts need their visible text extracted before a body search.
    if (field==='q') matches.push(`COALESCE(trim(${text}),'')=''`);
    conditions.push('(' + matches.join(' OR ') + ')');
    args.push(...choices.map(() => term));
  }
  if (filters.hasAttachment === '1') conditions.push(fileCount + '>0');
  addSizeFilter(filters,conditions,args,{
    columns:["json_extract(d.data,'$.subject')",text,"json_extract(d.data,'$.content')"],
    files:'SELECT sum(f.size) FROM draft_files f WHERE f.user_id=d.user_id AND f.draft_id=d.draft_id',
  });
  addSearchDates(filters, 'd.created_at', conditions, args);
  const {results} = await c.env.db.prepare(`SELECT d.draft_id AS draftId,d.version,d.account_id AS accountId,
    ${inbox} AS inbox,${unread} AS unread,${starred} AS starred,${reason} AS importanceReason,a.email AS senderEmail,${senderName} AS senderName,COALESCE(trim(${text}),'')='' AS html_only,
    CASE WHEN d.state='sending' AND d.updated_at < datetime('now','-15 minutes') THEN 'uncertain' ELSE d.state END AS state,
    json_extract(d.data,'$.subject') AS subject,json_extract(d.data,'$.receiveEmail') AS recipients,
    json_extract(d.data,'$.labelIds') AS labelIds,
    json_extract(d.data,'$.cc') AS cc,json_extract(d.data,'$.bcc') AS bcc,
    substr(json_extract(d.data,'$.text'),1,180) AS preview,json_extract(d.data,'$.scheduledAt') AS sendAt,
    ${fileCount} attachmentCount,${fileNames} AS attachments,json_extract(d.data,'$.scheduleError') AS error
    ${from} WHERE ${conditions.join(' AND ')} ORDER BY sendAt,d.draft_id`).bind(...args).all();
  const term=filters.q?.trim().slice(0,200).toLowerCase();
  const phrases=excludedPhrases(filters.excluded), excluded=new Set(), missingText=[];
  const messages=results.map(({html_only,...row})=>{
    const message={...row,labelIds:JSON.parse(row.labelIds || '[]'),attachments:JSON.parse(row.attachments),recipients:JSON.parse(row.recipients || '[]'),cc:JSON.parse(row.cc || '[]'),bcc:JSON.parse(row.bcc || '[]')};
    const headers=[message.senderName,message.senderEmail,message.subject,...message.recipients,...message.cc,...message.bcc];
    if (containsExcluded(headers,phrases)) excluded.add(row.draftId);
    else {
      const needsPositive=Boolean(term && html_only && !headers.some(value=>value?.toLowerCase().includes(term)));
      if (needsPositive || phrases.length) missingText.push({message,needsPositive});
    }
    return message;
  });
  // Read full searchable bodies in small batches only when the preview or headers cannot decide.
  for(let i=0;i<missingText.length;i+=4){
    const batch=missingText.slice(i,i+4);
    const {results:bodies}=await c.env.db.prepare(`SELECT d.draft_id,d.version,${text} AS text,
      CASE WHEN coalesce(trim(${text}),'')='' THEN json_extract(d.data,'$.content') END AS html
      FROM cloud_drafts d JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id AND a.is_del=0
      WHERE d.user_id=? AND d.draft_id IN (${batch.map(()=>'?').join(',')}) AND json_extract(d.data,'$.scheduledAt') IS NOT NULL`)
      .bind(userId,...batch.map(({message})=>message.draftId)).all();
    for (const {message,needsPositive} of batch) {
      const body=bodies.find(body=>body.draft_id===message.draftId && body.version===message.version);
      if (!body) {excluded.add(message.draftId);continue;}
      const visible=body.text?.trim() || emailUtils.htmlToText(body.html).replace(/\s+/g,' ').trim();
      if (containsExcluded([visible],phrases) || (needsPositive && !visible.toLowerCase().includes(term))) excluded.add(message.draftId);
      else if (needsPositive) message.preview=visible.slice(0,180);
    }
  }
  return messages.filter(row=>!excluded.has(row.draftId));
}

export async function cancel(c, userId, id, version) {
	id = positive(id);
	version = positive(version);
	const draft = await drafts.get(c, userId, id, true);
	const changed = await c.env.db
		.prepare(
			`UPDATE cloud_drafts SET data=json_remove(data,'$.scheduledAt','$.scheduleKey','$.scheduleError','$.retryAt','$.scheduledUnread','$.scheduledInbox','$.scheduledInboxEdit'),state='draft',
    version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_id=? AND version=?
    AND state IN ('scheduled','schedule_failed') RETURNING draft_id`,
		)
		.bind(userId, id, version)
		.first();
	if (!changed) {
		if (draft.state === 'draft' && draft.version === version + 1) return { draftId: id };
		throw new BizError('This message has changed or delivery has already started. Refresh Scheduled.', 409);
	}
	return { draftId: id };
}

export async function deliverDue(c) {
	const db = c.env.db;
	// A prepared attempt has not claimed provider dispatch. Atomically release an abandoned
	// preparation before retrying. Dispatching attempts remain fenced and appear as uncertain.
	const abandoned = (
		await db
			.prepare(
				`SELECT d.draft_id,d.user_id,s.idempotency_key FROM cloud_drafts d
    JOIN send_attempts s ON s.user_id=d.user_id AND s.idempotency_key=json_extract(d.data,'$.scheduleKey')
    WHERE d.state='sending' AND s.state='prepared' AND d.updated_at<datetime('now','-15 minutes') LIMIT 20`,
			)
			.all()
	).results;
	for (const row of abandoned) {
		await db.batch([
			db
				.prepare(
					`UPDATE cloud_drafts SET state='scheduled',data=json_set(data,'$.scheduleKey',?),version=version+1,updated_at=CURRENT_TIMESTAMP
        WHERE draft_id=? AND user_id=? AND state='sending' AND json_extract(data,'$.scheduleKey')=? AND EXISTS
        (SELECT 1 FROM send_attempts WHERE user_id=? AND idempotency_key=? AND state='prepared')`,
				)
				.bind(
					'cloudmail.schedule/' + crypto.randomUUID(),
					row.draft_id,
					row.user_id,
					row.idempotency_key,
					row.user_id,
					row.idempotency_key,
				),
			db
				.prepare("DELETE FROM send_attempts WHERE user_id=? AND idempotency_key=? AND state='prepared'")
				.bind(row.user_id, row.idempotency_key),
		]);
	}
	// Separate invocations may see the same row. Only send()'s atomic revision claim can dispatch.
	const due = (
		await db
			.prepare(
				`SELECT user_id,draft_id,version,json_extract(data,'$.scheduleKey') AS scheduleKey FROM cloud_drafts WHERE state='scheduled'
    AND ${timeField}<=unixepoch() AND COALESCE(json_extract(data,'$.retryAt'),0)<=unixepoch() ORDER BY ${timeField},draft_id LIMIT 20`,
			)
			.all()
	).results;
	for (const row of due) {
		try {
			await send(c, row.user_id, { version: row.version, idempotencyKey: row.scheduleKey }, { draftId: row.draft_id, scheduled: true });
		} catch (error) {
			// Transient infrastructure failures before the claim can retry. A rejected preflight is editable in Scheduled.
			if (![400, 403, 404, 413].includes(error.code)) {
				await db
					.prepare(
						`UPDATE cloud_drafts SET data=json_set(data,'$.retryAt',unixepoch()+300)
          WHERE draft_id=? AND user_id=? AND state='scheduled' AND version=?`,
					)
					.bind(row.draft_id, row.user_id, row.version)
					.run();
				continue;
			}
			await db
				.prepare(
					`UPDATE cloud_drafts SET state='schedule_failed',data=json_set(data,'$.scheduleError',?),version=version+1,
        updated_at=CURRENT_TIMESTAMP WHERE draft_id=? AND user_id=? AND version=? AND state='scheduled'`,
				)
				.bind(error.message, row.draft_id, row.user_id, row.version)
				.run();
		}
	}
}
