export const importanceSchema = `CREATE TABLE IF NOT EXISTS mailbox_importance (
  change_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, email_id INTEGER NOT NULL,
  important INTEGER NOT NULL CHECK(important IN (0,1)), UNIQUE(user_id,email_id))`;

export const importanceJoin = 'LEFT JOIN mailbox_importance marker ON marker.email_id=e.email_id AND marker.user_id=e.user_id';
const replied = "e.type=1 AND e.status IN (1,2) AND (e.reply_to_email_id>0 OR NULLIF(e.in_reply_to,'') IS NOT NULL)";
const sentToSelf = `e.type=1 AND e.status IN (1,2) AND EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_valid(e.recipient) THEN e.recipient ELSE '[]' END) recipient
  WHERE (CASE WHEN recipient.type='object' THEN json_extract(recipient.value,'$.address')
    ELSE recipient.value END)=a.email COLLATE NOCASE)`;
export const importanceFields = `MAX(marker.change_id) AS importance_change,
  MAX(CASE WHEN ${replied} THEN 1 ELSE 0 END) AS replied,
  MAX(CASE WHEN ${sentToSelf} THEN 1 ELSE 0 END) AS sent_to_self`;
// An explicit choice always takes precedence over automatic signals.
function reason(choice,reply,direct) {
  return `CASE WHEN ${choice}=1 THEN 'user' WHEN ${choice}=0 THEN NULL
    WHEN ${reply} THEN 'reply' WHEN ${direct} THEN 'direct' END`;
}
export const importanceReason = reason('choice.important','summary.replied=1','summary.sent_to_self=1');
export const messageImportanceReason = reason('marker.important',replied,sentToSelf);
export const scheduledImportanceReason = reason("json_extract(d.data,'$.mailboxImportant')",
  "json_extract(d.data,'$.sendType')='reply' AND json_extract(d.data,'$.emailId')>0",
  "EXISTS (SELECT 1 FROM json_each(d.data,'$.receiveEmail') address WHERE address.value=a.email COLLATE NOCASE)");

export async function setImportance(db,userId,ids,important) {
  const statements=[];
  for(let offset=0;offset<ids.length;offset+=30) {
    const members=ids.slice(offset,offset+30);
    statements.push(db.prepare(`INSERT OR REPLACE INTO mailbox_importance(user_id,email_id,important)
      VALUES ${members.map(()=>'(?,?,?)').join(',')}`).bind(...members.flatMap(id=>[userId,id,important?1:0])));
  }
  await db.batch(statements);
}
