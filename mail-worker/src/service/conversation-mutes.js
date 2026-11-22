import {mailboxEntries} from "../../../shared/stored-recipients.js";
// Store membership by message. The thread identifier may change when an older
// original is deleted or explicit reply headers join two threads.
export const muteNotificationIndex = "CREATE INDEX IF NOT EXISTS idx_mute_new_mail ON mobile_changes(user_id,entity_id) WHERE entity='message' AND new_mail=1";
export const muteSchema = [
  `CREATE TABLE IF NOT EXISTS conversation_mutes (
    user_id INTEGER NOT NULL,email_id INTEGER NOT NULL REFERENCES email(email_id) ON DELETE CASCADE,
    origin TEXT NOT NULL,quiet INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,email_id))`,
  'CREATE INDEX IF NOT EXISTS idx_mute_origin ON conversation_mutes(user_id,origin)',
  `CREATE TABLE IF NOT EXISTS conversation_mute_prior (
    token TEXT NOT NULL REFERENCES conversation_move_undo(token) ON DELETE CASCADE,
    email_id INTEGER NOT NULL,origin TEXT,quiet INTEGER,PRIMARY KEY(token,email_id))`,
  'CREATE INDEX IF NOT EXISTS idx_mute_prior_email ON conversation_mute_prior(email_id,token)',
  ...['INSERT','DELETE','UPDATE'].map(event=>{
    const row=event==='DELETE' ? 'OLD' : 'NEW';
    return `CREATE TRIGGER IF NOT EXISTS mute_undo_${event.toLowerCase()} AFTER ${event} ON conversation_mutes BEGIN
      DELETE FROM conversation_move_undo WHERE user_id=${row}.user_id AND state='ready' AND token IN
      (SELECT token FROM conversation_mute_prior WHERE email_id=${row}.email_id); END`;
  })
];

function addresses(value) {
  return mailboxEntries(value).map(entry=>entry.address.trim().toLowerCase());
}

export function inheritedMutes(messages, groups, ownAddresses) {
  if (!messages.some(row=>row.mute_origin)) return [];
  const own=new Set(ownAddresses.map(address=>address.toLowerCase()));
  const threads=new Map(groups.map(member=>[member.emailId,member.threadId]));
  const prior=new Map(), result=[];
  for(const row of [...messages].sort((a,b)=>a.email_id-b.email_id)) {
    const thread=threads.get(row.email_id), previous=prior.get(thread);
    const recipients=new Set([...addresses(row.recipient),...addresses(row.cc)]);
    const addressed=[...recipients].filter(address=>own.has(address));
    const direct=recipients.size===1 && addressed.length===1;
    const added=addressed.some(address=>!previous?.participants.has(address));
    const origin=row.mute_origin || previous?.origin;
    const source=row.mute_origin ? row.email_id : previous?.source;
    if (!row.mute_origin && origin) {
      result.push({id:row.email_id,source,origin,quiet:Number(row.type===0 && row.status===0 && !direct && !added)});
    }
    recipients.add((row.send_email || '').toLowerCase());
    prior.set(thread,{participants:recipients,origin,source});
  }
  return result;
}

export function inheritMuteStatements(db,userId,revision,updates) {
  const statements=[];
  for (let i=0;i<updates.length;i+=150) {
    // A newer mute, unmute, or index revision wins over this indexer's snapshot.
    const batch=JSON.stringify(updates.slice(i,i+150));
    statements.push(db.prepare(`INSERT OR IGNORE INTO conversation_mutes(user_id,email_id,origin,quiet)
      SELECT src.user_id,m.email_id,src.origin,json_extract(j.value,'$.quiet') FROM json_each(?) j
      JOIN conversation_mutes src ON src.user_id=? AND src.email_id=json_extract(j.value,'$.source') AND src.origin=json_extract(j.value,'$.origin')
      JOIN mobile_thread_members anchor ON anchor.user_id=src.user_id AND anchor.email_id=src.email_id
      JOIN mobile_thread_members m ON m.user_id=src.user_id AND m.email_id=json_extract(j.value,'$.id') AND m.thread_id=anchor.thread_id
      WHERE EXISTS(SELECT 1 FROM mobile_thread_state WHERE user_id=src.user_id AND revision=?)`)
      .bind(batch,userId,revision),
      db.prepare(`UPDATE mobile_changes SET new_mail=0 WHERE user_id=? AND entity='message' AND new_mail=1
        AND entity_id IN (SELECT m.email_id FROM json_each(?) j JOIN conversation_mutes m
          ON m.user_id=? AND m.email_id=json_extract(j.value,'$.id') AND m.quiet=1 AND m.origin=json_extract(j.value,'$.origin'))`)
        .bind(userId,batch,userId));
  }
  return statements;
}

export function changeMuteStatements(db,userId,ids,muted,token,origin) {
  const statements=[];
  for(let i=0;i<ids.length;i+=250) {
    const members=JSON.stringify(ids.slice(i,i+250));
    statements.push(db.prepare(`INSERT INTO conversation_mute_prior(token,email_id,origin,quiet)
      SELECT ?,j.value,m.origin,m.quiet FROM json_each(?) j
      LEFT JOIN conversation_mutes m ON m.user_id=? AND m.email_id=j.value`).bind(token,members,userId));
    if (muted) {
      statements.push(db.prepare(`INSERT OR REPLACE INTO conversation_mutes(user_id,email_id,origin,quiet)
        SELECT ?,value,?,0 FROM json_each(?)`).bind(userId,origin,members),
        db.prepare(`INSERT OR REPLACE INTO conversation_filing(user_id,email_id,wake_at)
          SELECT ?,value,NULL FROM json_each(?)`).bind(userId,members));
    } else {
      // Removing the label affects future delivery. Keep the current placement,
      // including manually snoozed messages and replies that skipped the Inbox.
      statements.push(db.prepare(`INSERT OR IGNORE INTO conversation_filing(user_id,email_id,wake_at)
        SELECT user_id,email_id,NULL FROM conversation_mutes WHERE user_id=? AND quiet=1 AND email_id IN (SELECT value FROM json_each(?))`).bind(userId,members),
        db.prepare('DELETE FROM conversation_mutes WHERE user_id=? AND email_id IN (SELECT value FROM json_each(?))').bind(userId,members));
    }
  }
  if (!muted) {
    // A trashed sibling keeps its last thread index until restored. Follow its
    // original mute decision even if removing the oldest member renamed the thread.
    statements.push(db.prepare(`INSERT OR IGNORE INTO conversation_mute_prior(token,email_id,origin,quiet)
      SELECT ?,m.email_id,m.origin,m.quiet FROM conversation_mutes m JOIN email e ON e.email_id=m.email_id AND e.user_id=m.user_id
      JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id
      WHERE m.user_id=? AND (e.trashed_at IS NOT NULL OR e.is_del=1 OR a.is_del=1)
        AND m.origin IN (SELECT prior.origin FROM conversation_mute_prior prior WHERE prior.token=?)`).bind(token,userId,token),
      db.prepare(`DELETE FROM conversation_mutes WHERE user_id=? AND email_id IN (SELECT email_id FROM conversation_mute_prior WHERE token=?)`).bind(userId,token));
  }
  return statements;
}
