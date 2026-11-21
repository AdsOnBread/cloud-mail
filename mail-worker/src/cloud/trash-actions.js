import {captureMove,withMoveRetry} from '../service/conversation-move-undo.js';
import {validateLabelChange} from '../service/mailbox-labels';
import {withLabelMove} from '../service/label-move';
import BizError from '../error/biz-error';
import { ensureThreads, groupThreads, threadColumns } from '../mobile/threads';
import { positive } from './auth';
import { owned } from './mail';
import { relatedActiveMail } from './trash-threads';

function selectedIds(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new BizError('Choose 1 to 100 messages.',400);
  return [...new Set(ids.map(id=>positive(id)))];
}

export async function setTrashRead(db,userId,ids,read) {
  if (typeof read !== 'boolean') throw new BizError('Choose a read status.',400);
  const selected=selectedIds(ids);
  const eligible=`SELECT e.email_id FROM email e JOIN account a ON a.account_id=e.account_id
    WHERE ${owned} AND e.trashed_at IS NOT NULL AND e.email_id IN (SELECT value FROM json_each(?))`;
  const result=await db.prepare(`WITH selected AS MATERIALIZED (${eligible}) UPDATE email SET unread=?
    WHERE email_id IN (SELECT email_id FROM selected) AND (SELECT COUNT(*) FROM selected)=? RETURNING email_id`)
    .bind(userId,JSON.stringify(selected),Number(read),selected.length).all();
  if (!result.results.length) throw new BizError('A selected message is no longer in Trash.',409);
  return {messageCount:selected.length};
}

// Scheduled mail in Trash still belongs to its editable draft. Mark the
// underlying record so Undo, restoration and eventual delivery retain the choice.
export async function setTrashImportance(db,userId,rawId,important) {
  const id=positive(rawId);
  if (typeof important!=='boolean') throw new BizError('Choose an importance status.',400);
  const eligible=`FROM email e JOIN account a ON a.account_id=e.account_id
    WHERE ${owned} AND e.email_id=? AND e.trashed_at IS NOT NULL`;
  const [message,draft]=await db.batch([
    db.prepare(`INSERT OR REPLACE INTO mailbox_importance(user_id,email_id,important)
      SELECT e.user_id,e.email_id,? ${eligible} AND e.scheduled_draft_id IS NULL RETURNING email_id`)
      .bind(Number(important),userId,id),
    db.prepare(`UPDATE cloud_drafts SET data=json_set(data,'$.mailboxImportant',?)
      WHERE user_id=? AND state='trashed' AND draft_id=(SELECT e.scheduled_draft_id ${eligible}) RETURNING draft_id`)
      .bind(Number(important),userId,userId,id),
  ]);
  if (!message.results.length && !draft.results.length) throw new BizError('This message is no longer in Trash.',409);
  return {importanceReason:important ? 'user' : null};
}

export async function setTrashLabels(db,userId,ids,add,remove) {
  const selected=selectedIds(ids);
  validateLabelChange(add,remove);
  const labels=[...new Set([...add,...remove])];
  const messages=JSON.stringify(selected);
  const conditions=`SELECT
    (SELECT COUNT(*) FROM email e JOIN account a ON a.account_id=e.account_id
      WHERE ${owned} AND e.trashed_at IS NOT NULL AND e.email_id IN (SELECT value FROM json_each(?)))=? AS valid_mail,
    (SELECT COUNT(*) FROM mailbox_labels WHERE user_id=? AND label_id IN (SELECT value FROM json_each(?)))=? AS valid_labels`;
  const check=[userId,messages,selected.length,userId,JSON.stringify(labels),labels.length];
  // D1 runs the eligibility check and guarded writes in a single transaction.
  const guard=`EXISTS (SELECT 1 FROM (${conditions}) WHERE valid_mail AND valid_labels)`;
  const statements=[db.prepare(conditions).bind(...check)];
  if (add.length) statements.push(db.prepare(`INSERT OR IGNORE INTO mailbox_label_members(user_id,label_id,email_id)
    SELECT ?,l.value,m.value FROM json_each(?) l CROSS JOIN json_each(?) m WHERE ${guard}`)
    .bind(userId,JSON.stringify(add),messages,...check));
  if (remove.length) statements.push(db.prepare(`DELETE FROM mailbox_label_members WHERE user_id=?
    AND label_id IN (SELECT value FROM json_each(?)) AND email_id IN (SELECT value FROM json_each(?)) AND ${guard}`)
    .bind(userId,JSON.stringify(remove),messages,...check));
  const [result]=await db.batch(statements);
  if (!result.results[0].valid_mail) throw new BizError('A selected message is no longer in Trash.',409);
  if (!result.results[0].valid_labels) throw new BizError('Label not found.',404);
  return {messageCount:selected.length};
}

// Filing follows the newest incoming member, or the first message for sent-only threads.
function anchor(current,row) {
  if (!current) return row;
  const incoming = message => message.type===0 && message.status===0;
  if (incoming(row)!==incoming(current)) return incoming(row) ? row : current;
  return (incoming(row) ? row.email_id>current.email_id : row.email_id<current.email_id) ? row : current;
}

export async function moveFromTrash(db,userId,ids,labelId,clientId,{undoable,requestId,previousLocation}={}) {
  const selected=selectedIds(ids);
  if (!Number.isSafeInteger(labelId) || labelId<0) throw new BizError('Choose a destination.',400);
  const idList=JSON.stringify(selected.sort((a,b)=>a-b));
  const recovery={db,userId,selected,labelId,idList,undoable:undoable===true};
  const apply=record=>{
    if (!previousLocation) return recover(recovery,record);
    const guard=`(SELECT COUNT(*) FROM email e JOIN account a ON a.account_id=e.account_id WHERE ${owned}
      AND e.trashed_at IS NOT NULL AND e.scheduled_draft_id IS NULL AND e.email_id IN (SELECT value FROM json_each(?)))=?`;
    return commitRecovery(recovery,record,selected,guard,[userId,idList,selected.length],[]);
  };
  if (undoable===true && requestId!==undefined && clientId===undefined)
    return withMoveRetry(db,userId,requestId,JSON.stringify(['trash',previousLocation===true,labelId,selected]),apply);
  return withLabelMove(db,userId,clientId,labelId,['trash',selected],apply);
}
async function recover(recovery,record) {
  const {db,userId,selected,labelId,idList}=recovery;
  // Project just the selected messages back into the normal thread grouping. Trash
  // may contain a newer reply, an older anchor, or an entirely deleted conversation.
  await ensureThreads(db,userId);
  const [mail,accounts,state,destination]=await db.batch([
    db.prepare(`SELECT ${threadColumns},e.trashed_at,e.type,e.status,e.scheduled_draft_id FROM email e JOIN account a ON a.account_id=e.account_id
      WHERE ${owned} AND e.trashed_at IS NOT NULL AND e.email_id IN (SELECT value FROM json_each(?))`).bind(userId,idList),
    db.prepare('SELECT email FROM account WHERE user_id=?').bind(userId),
    db.prepare('SELECT revision,indexed_revision FROM mobile_thread_state WHERE user_id=?').bind(userId),
    db.prepare('SELECT label_id FROM mailbox_labels WHERE user_id=? AND label_id=?').bind(userId,labelId)
  ]);
  if (labelId && !destination.results.length) throw new BizError('Label not found.',404);
  if (mail.results.some(row=>row.scheduled_draft_id)) throw new BizError('Restore the unsent message to Drafts.',409);
  if (mail.results.length!==selected.length) throw new BizError('A selected message is no longer in Trash.',409);
  if (!state.results.length || state.results[0].indexed_revision!==state.results[0].revision) throw new BizError('Trash changed. Refresh and try again.',409);
  const active=await relatedActiveMail(db,userId,mail.results);
  const rows=[...mail.results,...active].sort((a,b)=>a.email_id-b.email_id);
  const groups=groupThreads(rows,accounts.results.map(a=>a.email));
  const affected=new Set(groups.filter((_,i)=>rows[i].trashed_at).map(group=>group.threadId));
  const threads=new Map();
  for (const [index,member] of groups.entries()) {
    if (!affected.has(member.threadId)) continue;
    const row=rows[index];
    const thread=threads.get(member.threadId) || {restored:[]};
    thread.anchor=anchor(thread.anchor,row);
    if (row.trashed_at) thread.restored.push(row.email_id);
    else thread.previous=anchor(thread.previous,row);
    threads.set(member.threadId,thread);
  }

  // Guard the whole batch against a concurrent mailbox change or label deletion.
  // All filing writes precede the email update, which advances the revision.
  const guard='EXISTS (SELECT 1 FROM mobile_thread_state WHERE user_id=? AND revision=?) AND (?=0 OR EXISTS (SELECT 1 FROM mailbox_labels WHERE user_id=? AND label_id=?))';
  const check=[userId,state.results[0].revision,labelId,userId,labelId];
  const touched=new Set(selected);
  const statements=[];
  if (labelId) statements.push(db.prepare(`INSERT OR IGNORE INTO mailbox_label_members(user_id,label_id,email_id)
    SELECT ?,?,value FROM json_each(?) WHERE ${guard}`).bind(userId,labelId,idList,...check));
  for (const {restored,anchor:next,previous} of threads.values()) {
    // A label on a recovered message must not refile an active sibling. If a
    // recovered message becomes the new anchor, inherit the surviving thread's filing.
    if (labelId && previous) {
      const fallback=previous.type===0 && previous.status===0 ? 0 : null;
      statements.push(db.prepare(`INSERT OR REPLACE INTO conversation_filing(user_id,email_id,wake_at,notified)
        SELECT ?,j.value,CASE WHEN f.email_id IS NULL THEN ? ELSE f.wake_at END,COALESCE(f.notified,0)
        FROM json_each(?) j LEFT JOIN conversation_filing f ON f.user_id=? AND f.email_id=?
        WHERE ${guard}`).bind(userId,fallback,JSON.stringify(restored),userId,previous.email_id,...check));
    } else {
      const filed=labelId ? restored : [...new Set([...restored,next.email_id])];
      if (!labelId) touched.add(next.email_id);
      statements.push(db.prepare(`INSERT OR REPLACE INTO conversation_filing(user_id,email_id,wake_at)
        SELECT ?,value,? FROM json_each(?) WHERE ${guard}`).bind(userId,labelId ? null : 0,JSON.stringify(filed),...check));
    }
  }
  return commitRecovery(recovery,record,[...touched],guard,check,statements);
}
async function commitRecovery({db,userId,selected,labelId,idList,undoable},record,touched,guard,check,filing) {
  const result={messageCount:selected.length};
  const statements=[];
  if (undoable) {
    result.undoToken=crypto.randomUUID();
    statements.push(...captureMove(db,userId,result.undoToken,0,labelId,touched,guard,check));
    statements.push(db.prepare(`INSERT INTO trash_recovery_prior(token,email_id,trashed_at)
      SELECT ?,email_id,trashed_at FROM email WHERE user_id=? AND email_id IN (SELECT value FROM json_each(?)) AND ${guard}`)
      .bind(result.undoToken,userId,idList,...check));
  }
  statements.push(...filing);
  if (record) statements.push(record(result,guard,check));
  const mailUpdate=statements.length;
  statements.push(db.prepare(`UPDATE email SET trashed_at=NULL WHERE email_id IN
    (SELECT value FROM json_each(?) WHERE ${guard}) AND user_id=? RETURNING email_id`).bind(idList,...check,userId));
  if (undoable) statements.push(db.prepare("UPDATE conversation_move_undo SET state='ready' WHERE token=?").bind(result.undoToken));
  const results=await db.batch(statements);
  if (results[mailUpdate].results.length!==selected.length) throw new BizError('Trash changed. Refresh and try again.',409);
  return result;
}
