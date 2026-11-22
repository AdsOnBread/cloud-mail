// Store membership by message. The thread identifier may change when an older
// original is deleted or explicit reply headers join two threads.
export const muteSchema = [
  `CREATE TABLE IF NOT EXISTS conversation_mutes (
    user_id INTEGER NOT NULL,email_id INTEGER NOT NULL REFERENCES email(email_id) ON DELETE CASCADE,
    origin TEXT NOT NULL,quiet INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,email_id))`,
  'CREATE INDEX IF NOT EXISTS idx_mute_origin ON conversation_mutes(user_id,origin)',
  `CREATE TABLE IF NOT EXISTS conversation_mute_prior (
    token TEXT NOT NULL REFERENCES conversation_move_undo(token) ON DELETE CASCADE,
    email_id INTEGER NOT NULL,origin TEXT,quiet INTEGER,PRIMARY KEY(token,email_id))`,
  `CREATE TRIGGER IF NOT EXISTS mute_undo_changed AFTER DELETE ON conversation_mutes BEGIN
    DELETE FROM conversation_move_undo WHERE user_id=OLD.user_id AND state='ready' AND token IN
      (SELECT token FROM conversation_move_prior WHERE user_id=OLD.user_id AND email_id=OLD.email_id); END`
];

function addresses(value) {
  try {
    return JSON.parse(value || '[]').map(entry=>entry?.address || entry?.email || entry)
      .filter(address=>typeof address==='string').map(address=>address.trim().toLowerCase()).filter(Boolean);
  } catch { return []; }
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
    statements.push(db.prepare(`INSERT OR IGNORE INTO conversation_mutes(user_id,email_id,origin,quiet)
      SELECT src.user_id,m.email_id,src.origin,json_extract(j.value,'$.quiet') FROM json_each(?) j
      JOIN conversation_mutes src ON src.user_id=? AND src.email_id=json_extract(j.value,'$.source') AND src.origin=json_extract(j.value,'$.origin')
      JOIN mobile_thread_members anchor ON anchor.user_id=src.user_id AND anchor.email_id=src.email_id
      JOIN mobile_thread_members m ON m.user_id=src.user_id AND m.email_id=json_extract(j.value,'$.id') AND m.thread_id=anchor.thread_id
      WHERE EXISTS(SELECT 1 FROM mobile_thread_state WHERE user_id=src.user_id AND revision=?)`)
      .bind(JSON.stringify(updates.slice(i,i+150)),userId,revision));
  }
  return statements;
}

export function changeMuteStatements(db,userId,ids,muted,token) {
  const statements=[];
  for(let i=0;i<ids.length;i+=250) {
    const members=JSON.stringify(ids.slice(i,i+250));
    statements.push(db.prepare(`INSERT INTO conversation_mute_prior(token,email_id,origin,quiet)
      SELECT ?,j.value,m.origin,m.quiet FROM json_each(?) j
      LEFT JOIN conversation_mutes m ON m.user_id=? AND m.email_id=j.value`).bind(token,members,userId));
    if (muted) {
      statements.push(db.prepare(`INSERT OR REPLACE INTO conversation_mutes(user_id,email_id,origin,quiet)
        SELECT ?,value,?,0 FROM json_each(?)`).bind(userId,token,members),
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
  return statements;
}
