import { normalizedSubject, referenceIds, threadColumns } from '../mobile/threads';
import { owned } from './mail';

const visible = `FROM email e JOIN account a ON a.account_id=e.account_id
  JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
  WHERE ${owned} AND e.trashed_at IS NULL`;

// Find active threads that could join or split when the selected rows reappear.
// The regular index already covers all explicit links among active messages.
export async function relatedActiveMail(db,userId,restored) {
  const tokens=new Set();
  for (const row of restored) {
    for (const field of [row.message_id,row.in_reply_to,row.relation]) for (const id of referenceIds(field)) tokens.add(id);
  }
  const ids=JSON.stringify(restored.map(row=>row.email_id));
  const parents=JSON.stringify(restored.map(row=>row.reply_to_email_id).filter(Boolean));
  const explicit=await db.prepare(`SELECT DISTINCT m.thread_id ${visible} AND (
    e.email_id IN (SELECT value FROM json_each(?)) OR e.reply_to_email_id IN (SELECT value FROM json_each(?)) OR
    EXISTS (SELECT 1 FROM json_each(?) t WHERE instr(e.message_id,t.value)>0 OR instr(e.in_reply_to,t.value)>0 OR instr(e.relation,t.value)>0))`)
    .bind(userId,parents,ids,JSON.stringify([...tokens])).all();

  const result=[], loaded=new Set(), checkedSubjects=new Set();
  let frontier=restored;
  let pending=explicit.results.map(row=>row.thread_id);
  do {
    const subjects=new Set(frontier.map(row=>normalizedSubject(row.subject)).filter(s=>s && !checkedSubjects.has(s)));
    for (const subject of subjects) checkedSubjects.add(subject);
    if (subjects.size) {
      // Only transfer matching spellings. Normalize candidate strings with the same
      // Unicode and reply-prefix rules as groupThreads, including non-ASCII case folds.
      const words=[...new Set([...subjects].map(s=>(s.match(/[a-z0-9]+/g)||[]).sort((a,b)=>b.length-a.length)[0]).filter(Boolean))];
      const names=await db.prepare(`SELECT DISTINCT e.subject ${visible} AND
        (length(e.subject)<>length(CAST(e.subject AS BLOB)) OR
         EXISTS (SELECT 1 FROM json_each(?) t WHERE instr(lower(e.subject),t.value)>0) OR ?)`)
        .bind(userId,JSON.stringify(words),Number([...subjects].some(s=>!/[a-z0-9]/.test(s)))).all();
      const variants=names.results.map(row=>row.subject).filter(name=>subjects.has(normalizedSubject(name)));
      if (variants.length) {
        const matched=await db.prepare(`SELECT DISTINCT m.thread_id ${visible} AND e.subject IN (SELECT value FROM json_each(?))`)
          .bind(userId,JSON.stringify(variants)).all();
        for (const row of matched.results) pending.push(row.thread_id);
      }
    }
    const next=[...new Set(pending)].filter(id=>!loaded.has(id));
    if (!next.length) break;
    for (const id of next) loaded.add(id);
    const rows=await db.prepare(`SELECT ${threadColumns},e.trashed_at,e.type,e.status ${visible}
      AND m.thread_id IN (SELECT value FROM json_each(?)) ORDER BY e.email_id`).bind(userId,JSON.stringify(next)).all();
    frontier=rows.results;
    for (const row of frontier) result.push(row);
    pending=[];
  } while (frontier.length);
  return result;
}
