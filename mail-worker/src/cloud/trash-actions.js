import BizError from '../error/biz-error';
import { groupThreads, threadColumns } from '../mobile/threads';
import { positive } from './auth';
import { owned } from './mail';

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

// Filing follows the newest incoming member, or the first message for sent-only threads.
function anchor(current,row) {
  if (!current) return row;
  const incoming = message => message.type===0 && message.status===0;
  if (incoming(row)!==incoming(current)) return incoming(row) ? row : current;
  return (incoming(row) ? row.email_id>current.email_id : row.email_id<current.email_id) ? row : current;
}

export async function moveFromTrash(db,userId,ids,labelId) {
  const selected=selectedIds(ids);
  if (!Number.isSafeInteger(labelId) || labelId<0) throw new BizError('Choose a destination.',400);
  const idList=JSON.stringify(selected);
  // Project just the selected messages back into the normal thread grouping. Trash
  // may contain a newer reply, an older anchor, or an entirely deleted conversation.
  const [mail,accounts,state,destination]=await db.batch([
    db.prepare(`SELECT ${threadColumns},e.trashed_at,e.type,e.status FROM email e JOIN account a ON a.account_id=e.account_id
      WHERE ${owned} AND (e.trashed_at IS NULL OR e.email_id IN (SELECT value FROM json_each(?)))`).bind(userId,idList),
    db.prepare('SELECT email FROM account WHERE user_id=?').bind(userId),
    db.prepare('SELECT revision FROM mobile_thread_state WHERE user_id=?').bind(userId),
    db.prepare('SELECT label_id FROM mailbox_labels WHERE user_id=? AND label_id=?').bind(userId,labelId)
  ]);
  if (labelId && !destination.results.length) throw new BizError('Label not found.',404);
  const rows=mail.results;
  if (rows.filter(row=>row.trashed_at).length!==selected.length) throw new BizError('A selected message is no longer in Trash.',409);
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
      statements.push(db.prepare(`INSERT OR REPLACE INTO conversation_filing(user_id,email_id,wake_at)
        SELECT ?,value,? FROM json_each(?) WHERE ${guard}`).bind(userId,labelId ? null : 0,JSON.stringify(filed),...check));
    }
  }
  statements.push(db.prepare(`UPDATE email SET trashed_at=NULL WHERE email_id IN
    (SELECT value FROM json_each(?) WHERE ${guard}) AND user_id=? RETURNING email_id`).bind(idList,...check,userId));
  const results=await db.batch(statements);
  if (results.at(-1).results.length!==selected.length) throw new BizError('Trash changed. Refresh and try again.',409);
  return {messageCount:selected.length};
}
