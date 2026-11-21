// Used by both "Has attachment" search and mailbox indicators. Inline images belong to the message body.
export const attachedFile = "att.user_id=e.user_id AND att.account_id=e.account_id AND att.email_id=e.email_id AND att.type=0 AND (lower(att.disposition)='attachment' OR (COALESCE(att.content_id,'')='' AND lower(COALESCE(att.disposition,''))!='inline'))";

export async function mailboxAttachments(db, userId, rows, mode) {
  const groups = new Map();
  if (!rows.length) return groups;
  const threads = mode === 'threads';
  const group = threads ? 'm.thread_id' : 'e.email_id';
  const ids = rows.map(row => threads ? row.thread_id : row.email_id);
  // Expand only this result page. Return bounded metadata even for threads with many files.
  const {results} = await db.prepare(`WITH ranked AS (
    SELECT ${group} group_id,att.att_id,att.filename,att.mime_type,att.size,
      COUNT(*) OVER (PARTITION BY ${group}) total,
      ROW_NUMBER() OVER (PARTITION BY ${group} ORDER BY e.email_id DESC,att.att_id) position
    FROM json_each(?) page
    ${threads ? 'JOIN mobile_thread_members m ON m.thread_id=page.value AND m.user_id=? JOIN email e ON e.email_id=m.email_id AND e.user_id=m.user_id' : 'JOIN email e ON e.email_id=page.value'}
    JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id AND a.is_del=0
    JOIN attachments att ON ${attachedFile}
    WHERE e.user_id=? AND e.is_del=0 AND e.status NOT IN (6,7) AND e.trashed_at IS ${mode==='trash'?'NOT NULL':'NULL'}
  ) SELECT * FROM ranked WHERE position<=3 ORDER BY group_id,position`)
    .bind(JSON.stringify(ids), ...(threads ? [userId] : []), userId).all();
  for (const file of results) {
    const summary = groups.get(file.group_id) || {attachmentCount:file.total, attachments:[]};
    summary.attachments.push({attId:file.att_id, filename:file.filename || 'Attachment', mimeType:file.mime_type, size:file.size});
    groups.set(file.group_id, summary);
  }
  return groups;
}
