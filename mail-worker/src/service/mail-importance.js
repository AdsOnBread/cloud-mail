export const importanceSchema = `CREATE TABLE IF NOT EXISTS mailbox_importance (
  change_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, email_id INTEGER NOT NULL,
  important INTEGER NOT NULL CHECK(important IN (0,1)), UNIQUE(user_id,email_id))`;

export const importanceJoin = 'LEFT JOIN mailbox_importance marker ON marker.email_id=e.email_id AND marker.user_id=e.user_id';
export const importanceFields = `MAX(marker.change_id) AS importance_change,
  MAX(CASE WHEN e.type=1 AND e.status IN (1,2)
    AND (e.reply_to_email_id>0 OR NULLIF(e.in_reply_to,'') IS NOT NULL) THEN 1 ELSE 0 END) AS replied,
  MAX(CASE WHEN e.type=1 AND e.status IN (1,2) AND EXISTS (
    SELECT 1 FROM json_each(CASE WHEN json_valid(e.recipient) THEN e.recipient ELSE '[]' END) recipient
    WHERE (CASE WHEN recipient.type='object' THEN json_extract(recipient.value,'$.address')
      ELSE recipient.value END)=a.email COLLATE NOCASE) THEN 1 ELSE 0 END) AS sent_to_self`;
// An explicit choice always takes precedence over the automatic reply signal.
export const importanceReason = `CASE WHEN choice.important=1 THEN 'user'
  WHEN choice.important IS NULL AND summary.replied=1 THEN 'reply'
  WHEN choice.important IS NULL AND summary.sent_to_self=1 THEN 'direct' ELSE NULL END`;

export async function setImportance(db,userId,ids,important) {
  const statements=[];
  for(let offset=0;offset<ids.length;offset+=30) {
    const members=ids.slice(offset,offset+30);
    statements.push(db.prepare(`INSERT OR REPLACE INTO mailbox_importance(user_id,email_id,important)
      VALUES ${members.map(()=>'(?,?,?)').join(',')}`).bind(...members.flatMap(id=>[userId,id,important?1:0])));
  }
  await db.batch(statements);
}
