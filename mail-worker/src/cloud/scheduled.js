import emailUtils from '../utils/email-utils';
import BizError from '../error/biz-error';
import { permission, positive, conflict } from './auth';
import * as drafts from './drafts';
import { send } from './send';
import { normalizeRecipients } from '../service/email-sender';

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
	if (!current.subject?.trim() || current.subject.length > 998 || /[\r\n]/.test(current.subject) || !current.content?.trim())
		throw new BizError('Enter a subject and message before scheduling.', 400);
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

export async function scheduledList(c, userId, accountId, filters = {}) {
  const args = [userId];
  const conditions = ["d.user_id=?", "json_extract(d.data,'$.scheduledAt') IS NOT NULL"];
  if (accountId) {
    conditions.push('d.account_id=?');
    args.push(positive(accountId));
  }
  const from = 'FROM cloud_drafts d JOIN account a ON a.user_id=d.user_id AND a.account_id=d.account_id AND a.is_del=0';
  if (filters.countOnly === '1') {
    return c.env.db.prepare(`SELECT COUNT(*) count ${from} WHERE ${conditions.join(' AND ')}`).bind(...args).first();
  }
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
    const term = filters[field]?.trim().slice(0, 200);
    if (!term) continue;
    const matches = choices.map(column => `instr(lower(${column}),lower(?))>0`);
    // HTML-only drafts need their visible text extracted before a body search.
    if (field==='q') matches.push(`COALESCE(trim(${text}),'')=''`);
    conditions.push('(' + matches.join(' OR ') + ')');
    args.push(...choices.map(() => term));
  }
  if (filters.hasAttachment === '1') conditions.push(fileCount + '>0');
  const days = Number(filters.days);
  if ([1,7,30,365].includes(days)) {
    conditions.push("d.created_at>=datetime('now',?)");
    args.push('-' + days + ' days');
  }
  const {results} = await c.env.db.prepare(`SELECT d.draft_id AS draftId,d.version,d.account_id AS accountId,
    a.email AS senderEmail,${senderName} AS senderName,COALESCE(trim(${text}),'')='' AS html_only,
    CASE WHEN d.state='sending' AND d.updated_at < datetime('now','-15 minutes') THEN 'uncertain' ELSE d.state END AS state,
    json_extract(d.data,'$.subject') AS subject,json_extract(d.data,'$.receiveEmail') AS recipients,
    json_extract(d.data,'$.cc') AS cc,json_extract(d.data,'$.bcc') AS bcc,
    substr(json_extract(d.data,'$.text'),1,180) AS preview,json_extract(d.data,'$.scheduledAt') AS sendAt,
    ${fileCount} attachmentCount,${fileNames} AS attachments,json_extract(d.data,'$.scheduleError') AS error
    ${from} WHERE ${conditions.join(' AND ')} ORDER BY sendAt,d.draft_id`).bind(...args).all();
  const term=filters.q?.trim().slice(0,200).toLowerCase();
  const missingText=[];
  const messages=results.map(({html_only,...row})=>{
    const message={...row,attachments:JSON.parse(row.attachments),recipients:JSON.parse(row.recipients || '[]'),cc:JSON.parse(row.cc || '[]'),bcc:JSON.parse(row.bcc || '[]')};
    if(term && html_only && ![message.senderName,message.senderEmail,message.subject,...message.recipients,...message.cc,...message.bcc]
      .some(value=>value?.toLowerCase().includes(term)))missingText.push(message);
    return message;
  });
  const excluded=new Set();
  // Bound peak memory when several HTML-only messages on the same page have large bodies.
  for(let i=0;i<missingText.length;i+=4){
    const batch=missingText.slice(i,i+4);
    const {results:bodies}=await c.env.db.prepare(`SELECT d.draft_id,d.version,json_extract(d.data,'$.content') AS html
      FROM cloud_drafts d JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id AND a.is_del=0
      WHERE d.user_id=? AND d.draft_id IN (${batch.map(()=>'?').join(',')}) AND json_extract(d.data,'$.scheduledAt') IS NOT NULL`)
      .bind(userId,...batch.map(row=>row.draftId)).all();
    batch.forEach(row=>{
      const body=bodies.find(body=>body.draft_id===row.draftId && body.version===row.version);
      const visible=emailUtils.htmlToText(body?.html).replace(/\s+/g,' ').trim();
      if(visible.toLowerCase().includes(term))row.preview=visible.slice(0,180);
      else excluded.add(row.draftId);
    });
  }
  return messages.filter(row=>!excluded.has(row.draftId));
}

export async function cancel(c, userId, id, version) {
	id = positive(id);
	version = positive(version);
	const draft = await drafts.get(c, userId, id, true);
	const changed = await c.env.db
		.prepare(
			`UPDATE cloud_drafts SET data=json_remove(data,'$.scheduledAt','$.scheduleKey','$.scheduleError','$.retryAt'),state='draft',
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
