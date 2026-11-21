import BizError from '../error/biz-error';
import {permission} from './auth';
import {eligibleSelection,scheduledSelection} from './scheduled';

const stale=()=>new BizError('A message changed or delivery already started. Refresh Scheduled.',409);
const recipients=field=>`(SELECT json_group_array(json_object('address',value,'name','')) FROM json_each(d.data,'$.${field}'))`;

export async function trashScheduled(c,userId,input) {
  await permission(c,userId,'email:delete');
  const selection=scheduledSelection(input?.messages);
  const db=c.env.db, edit=crypto.randomUUID();
  const receipts=`FROM cloud_drafts d JOIN email e ON e.scheduled_draft_id=d.draft_id AND e.user_id=d.user_id
    WHERE d.user_id=? AND d.state='trashed' AND json_extract(d.data,'$.trashEdit')=?`;
  const statement=sql=>db.prepare(sql).bind(userId,edit);
  const [changed]=await db.batch([
    db.prepare(`WITH eligible AS MATERIALIZED (SELECT d.draft_id ${eligibleSelection})
      UPDATE cloud_drafts SET state='trashed',version=version+1,updated_at=CURRENT_TIMESTAMP,
        data=json_remove(json_set(data,'$.trashEdit',?,'$.trashState',state,'$.trashSendAt',json_extract(data,'$.scheduledAt')),'$.scheduledAt')
      WHERE draft_id IN (SELECT draft_id FROM eligible) AND (SELECT count(*) FROM eligible)=? RETURNING draft_id`)
      .bind(JSON.stringify(selection),userId,edit,selection.length),
    statement(`INSERT INTO email(user_id,account_id,scheduled_draft_id,trashed_at,type,unread,send_email,name,subject,text,content,recipient,cc,bcc,message_id)
      SELECT d.user_id,d.account_id,d.draft_id,CURRENT_TIMESTAMP,1,1-coalesce(json_extract(d.data,'$.scheduledUnread'),0),
        a.email,coalesce(nullif(json_extract(d.data,'$.name'),''),a.name),json_extract(d.data,'$.subject'),json_extract(d.data,'$.text'),
        CASE WHEN json_extract(d.data,'$.plainText')=1 THEN '' ELSE json_extract(d.data,'$.content') END,
        ${recipients('receiveEmail')},${recipients('cc')},${recipients('bcc')},'<'||hex(randomblob(16))||'@draft.invalid>'
      FROM cloud_drafts d JOIN account a ON a.account_id=d.account_id
      WHERE d.user_id=? AND d.state='trashed' AND json_extract(d.data,'$.trashEdit')=?`),
    statement(`INSERT INTO attachments(user_id,account_id,email_id,key,filename,mime_type,size,content_id,related,disposition,type)
      SELECT f.user_id,e.account_id,e.email_id,f.key,f.filename,f.mime_type,f.size,f.content_id,f.attachment_id,
        CASE WHEN coalesce(f.content_id,'')='' THEN 'attachment' ELSE 'inline' END,0
      FROM draft_files f JOIN (SELECT d.draft_id,e.email_id,e.account_id ${receipts}) e ON e.draft_id=f.draft_id`),
    statement(`DELETE FROM draft_files WHERE draft_id IN (SELECT d.draft_id ${receipts})`),
    statement(`INSERT OR IGNORE INTO mailbox_label_members(user_id,label_id,email_id)
      SELECT r.user_id,l.label_id,r.email_id FROM (SELECT d.user_id,e.email_id,json_extract(d.data,'$.labelIds') labels ${receipts}) r
      JOIN json_each(r.labels) j JOIN mailbox_labels l ON l.label_id=j.value AND l.user_id=r.user_id`),
  ]);
  if (changed.results.length!==selection.length) throw stale();
  return {edit,count:selection.length};
}

export async function undoScheduledTrash(c,userId,{edit,count}) {
  await permission(c,userId,'email:delete');
  if (typeof edit!=='string' || edit.length!==36 || !Number.isInteger(count) || count<1 || count>50) throw stale();
  // Undo may re-enable delivery only for an active sender with send permission.
  let canSend=true;
  try {await permission(c,userId,'email:send');} catch(error){if(error.code!==403)throw error; canSend=false;}
  const db=c.env.db;
  const eligible=`FROM cloud_drafts d JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id AND a.is_del=0
    JOIN email e ON e.scheduled_draft_id=d.draft_id AND e.user_id=d.user_id AND e.trashed_at IS NOT NULL
    WHERE d.user_id=? AND d.state='trashed' AND json_extract(d.data,'$.trashEdit')=?`;
  const [marked,recovered]=await db.batch([
    db.prepare(`WITH selected AS MATERIALIZED (SELECT d.draft_id,json_extract(d.data,'$.trashState')='scheduled'
      AND json_extract(d.data,'$.trashSendAt')>unixepoch() resumable ${eligible})
      UPDATE cloud_drafts SET data=json_set(data,'$.resumeSchedule',cast(? AND resumable AND
        (SELECT count(*) FROM cloud_drafts q JOIN account a ON a.account_id=q.account_id AND a.user_id=q.user_id AND a.is_del=0
          WHERE q.user_id=? AND json_extract(q.data,'$.scheduledAt') IS NOT NULL)+(SELECT sum(resumable) FROM selected)<=100 AS INTEGER))
      FROM selected WHERE cloud_drafts.draft_id=selected.draft_id AND (SELECT count(*) FROM selected)=?
      RETURNING json_extract(data,'$.resumeSchedule') AS resumed`).bind(userId,edit,Number(canSend),userId,count),
    db.prepare(`UPDATE email SET trashed_at=NULL WHERE email_id IN (SELECT e.email_id ${eligible}
      AND json_type(d.data,'$.resumeSchedule') IS NOT NULL) RETURNING email_id`).bind(userId,edit),
  ]);
  if (recovered.results.length!==count) throw stale();
  return {scheduled:marked.results.filter(row=>row.resumed).length,drafts:count-marked.results.filter(row=>row.resumed).length};
}
