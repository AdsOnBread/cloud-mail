import BizError from '../error/biz-error.js';

// A later filing invalidates the whole selection. Changes to unrelated labels
// and newly arrived replies stay independent of the move.
function invalidate(table, event, row, labelChange = false) {
  const name = table === 'conversation_filing' ? 'filing' : 'label';
  const verb = event.split(' ')[0].toLowerCase();
  return `CREATE TRIGGER IF NOT EXISTS move_undo_${name}_${verb} AFTER ${event} ON ${table}
    BEGIN DELETE FROM conversation_move_undo WHERE token IN
      (SELECT token FROM conversation_move_prior WHERE user_id=${row}.user_id AND email_id=${row}.email_id)
      AND state='ready' ${labelChange ? `AND ${row}.label_id IN (source,destination)` : ''}; END`;
}

export const moveUndoSchema = [
  `CREATE TABLE IF NOT EXISTS conversation_move_requests (
    user_id INTEGER NOT NULL, request_id TEXT NOT NULL, intent TEXT NOT NULL,
    result TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(user_id,request_id))`,
  'CREATE INDEX IF NOT EXISTS idx_move_request_expiry ON conversation_move_requests(expires)',
  `CREATE TABLE IF NOT EXISTS conversation_move_undo (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL,
    source INTEGER REFERENCES mailbox_labels(label_id) ON DELETE CASCADE,
    destination INTEGER REFERENCES mailbox_labels(label_id) ON DELETE CASCADE)`,
  'CREATE INDEX IF NOT EXISTS idx_move_undo_expiry ON conversation_move_undo(expires)',
  `CREATE TABLE IF NOT EXISTS conversation_move_prior (
    token TEXT NOT NULL REFERENCES conversation_move_undo(token) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,email_id INTEGER NOT NULL, had_filing INTEGER NOT NULL,
    wake_at INTEGER, notified INTEGER, had_source INTEGER NOT NULL, had_destination INTEGER NOT NULL,
    PRIMARY KEY(token,email_id))`,
  'CREATE INDEX IF NOT EXISTS idx_move_prior_message ON conversation_move_prior(user_id,email_id)',
  `CREATE TABLE IF NOT EXISTS trash_recovery_prior (
    token TEXT NOT NULL REFERENCES conversation_move_undo(token) ON DELETE CASCADE,
    email_id INTEGER NOT NULL, trashed_at TEXT NOT NULL, PRIMARY KEY(token,email_id))`,
  invalidate('conversation_filing','INSERT','NEW'),
  invalidate('conversation_filing','UPDATE OF wake_at','NEW'),
  invalidate('conversation_filing','DELETE','OLD'),
  invalidate('mailbox_label_members','INSERT','NEW',true),
  invalidate('mailbox_label_members','DELETE','OLD',true)
];

// Replaying a lost response must never move a later reply or replace the
// original Undo snapshot. Keep the request receipt even if Undo is invalidated.
export async function withMoveRetry(db,userId,requestId,intent,apply) {
  if (typeof requestId!=='string' || !/^[a-f\d-]{36}$/i.test(requestId)) throw new BizError('Invalid move request.',400);
  async function replay() {
    const row=await db.prepare(`SELECT r.intent,r.result,u.state FROM conversation_move_requests r
      LEFT JOIN conversation_move_undo u ON u.token=json_extract(r.result,'$.undoToken') AND u.user_id=r.user_id AND u.expires>unixepoch()
      WHERE r.user_id=? AND r.request_id=? AND r.expires>unixepoch()`).bind(userId,requestId).first();
    if (!row) return null;
    if (row.intent!==intent) throw new BizError('This request is for a different move.',409);
    const result=JSON.parse(row.result);
    if (row.state!=='ready') { delete result.undoToken; result.alreadyProcessed=true; }
    return result;
  }
  const existing=await replay();
  if (existing) return existing;
  try {
    return await apply((result,guard='1',checks=[])=>db.prepare(`INSERT INTO conversation_move_requests(user_id,request_id,intent,result,expires)
      SELECT ?,?,?,?,unixepoch()+86400 WHERE ${guard}`).bind(userId,requestId,intent,JSON.stringify(result),...checks));
  } catch(error) {
    const existing=await replay();
    if (existing) return existing;
    throw error;
  }
}

export function expiredMoves(db) {
  return [
    db.prepare('DELETE FROM conversation_move_undo WHERE expires<=unixepoch()'),
    db.prepare('DELETE FROM conversation_move_requests WHERE expires<=unixepoch()')
  ];
}

export function captureMove(db, userId, token, source, destination, ids, guard='1', checks=[]) {
  const statements = [
    ...expiredMoves(db),
    db.prepare(`INSERT INTO conversation_move_undo(token,user_id,expires,state,source,destination)
      SELECT ?,?,unixepoch()+86400,'capturing',?,? WHERE ${guard}`).bind(token,userId,source || null,destination || null,...checks)
  ];
  for (let i=0; i<ids.length; i+=500) {
    statements.push(db.prepare(`INSERT INTO conversation_move_prior
      (token,user_id,email_id,had_filing,wake_at,notified,had_source,had_destination)
      SELECT ?1,?2,j.value,f.email_id IS NOT NULL,f.wake_at,f.notified,
        EXISTS(SELECT 1 FROM mailbox_label_members WHERE user_id=?2 AND email_id=j.value AND label_id=?3),
        EXISTS(SELECT 1 FROM mailbox_label_members WHERE user_id=?2 AND email_id=j.value AND label_id=?4)
      FROM json_each(?5) j LEFT JOIN conversation_filing f ON f.user_id=?2 AND f.email_id=j.value
      WHERE EXISTS(SELECT 1 FROM conversation_move_undo WHERE token=?1)`)
      .bind(token,userId,source,destination,JSON.stringify(ids.slice(i,i+500))));
  }
  return statements;
}

export async function undoConversationMove(db, userId, token, trash=false) {
  if (typeof token !== 'string' || !/^[a-f\d-]{36}$/i.test(token)) throw new BizError('Invalid move.',400);
  const completed=trash ? "trash-done" : "done";
  const query = sql => db.prepare(sql).bind(token,userId);
  const restoring = `FROM conversation_move_prior p JOIN conversation_move_undo u ON u.token=p.token
    WHERE u.token=?1 AND u.user_id=?2 AND u.state='restoring'`;
  const changes = await db.batch([
    query(`UPDATE conversation_move_undo SET state='restoring'
      WHERE token=?1 AND user_id=?2 AND state='ready' AND expires>unixepoch()
      AND ${trash ? '' : 'NOT'} EXISTS(SELECT 1 FROM trash_recovery_prior WHERE token=?1)
      AND NOT EXISTS (SELECT 1 FROM conversation_move_prior p WHERE p.token=?1 AND NOT EXISTS
        (SELECT 1 FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id
         WHERE e.user_id=?2 AND e.email_id=p.email_id AND e.is_del=0 AND a.is_del=0
           AND e.trashed_at IS NULL AND e.status NOT IN (6,7)))`),
    query(`DELETE FROM conversation_mutes WHERE user_id=?2 AND origin=?1
      AND EXISTS(SELECT 1 FROM conversation_move_undo WHERE token=?1 AND user_id=?2 AND state='restoring')`),
    query(`INSERT OR REPLACE INTO conversation_mutes(user_id,email_id,origin,quiet)
      SELECT ?2,p.email_id,p.origin,p.quiet FROM conversation_mute_prior p JOIN conversation_move_undo u ON u.token=p.token
      WHERE u.token=?1 AND u.user_id=?2 AND u.state='restoring' AND p.origin IS NOT NULL`),
    query(`DELETE FROM mailbox_label_members WHERE user_id=?2 AND (email_id,label_id) IN
      (SELECT p.email_id,u.destination ${restoring} AND p.had_destination=0 AND u.destination IS NOT NULL)`),
    query(`INSERT INTO mailbox_label_members(user_id,label_id,email_id)
      SELECT p.user_id,u.source,p.email_id ${restoring} AND p.had_source=1`),
    query(`DELETE FROM conversation_filing WHERE user_id=?2 AND email_id IN
      (SELECT p.email_id ${restoring} AND p.had_filing=0)`),
    query(`INSERT OR REPLACE INTO conversation_filing(user_id,email_id,wake_at,notified)
      SELECT p.user_id,p.email_id,p.wake_at,p.notified ${restoring} AND p.had_filing=1`),
    query(`INSERT INTO mobile_changes(user_id,entity,entity_id,operation)
      SELECT p.user_id,'message',p.email_id,'upsert' ${restoring}`),
    ...(trash ? [query(`UPDATE email SET trashed_at=(SELECT t.trashed_at FROM trash_recovery_prior t
      WHERE t.token=?1 AND t.email_id=email.email_id) WHERE user_id=?2 AND email_id IN
      (SELECT t.email_id FROM trash_recovery_prior t JOIN conversation_move_undo u ON u.token=t.token
       WHERE u.token=?1 AND u.user_id=?2 AND u.state='restoring')`)] : []),
    query(`UPDATE conversation_move_undo SET state='${completed}' WHERE token=?1 AND user_id=?2 AND state='restoring'`),
    query(`DELETE FROM conversation_move_prior WHERE token IN (SELECT token FROM conversation_move_undo WHERE token=?1 AND user_id=?2 AND state='${completed}')`),
    query("DELETE FROM trash_recovery_prior WHERE token IN (SELECT token FROM conversation_move_undo WHERE token=?1 AND user_id=?2 AND state='trash-done')"),
    query('SELECT state FROM conversation_move_undo WHERE token=?1 AND user_id=?2 AND expires>unixepoch()')
  ]);
  if (changes.at(-1).results[0]?.state !== completed) throw new BizError('This move can no longer be undone.',409);
  return {restored:true};
}
