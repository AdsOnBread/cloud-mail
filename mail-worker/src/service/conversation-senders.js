// Count and style authors from the same visible messages as the conversation reader.
export async function conversationSenders(db, userId, threadIds) {
  const summaries = new Map();
  if (!threadIds.length) return summaries;
  const {results} = await db.prepare(`WITH members AS (
      SELECT m.thread_id,e.email_id,e.type,e.unread,e.name,e.send_email,
        max(e.type=1) OVER (PARTITION BY m.thread_id,lower(trim(e.send_email)),
          coalesce(nullif(e.message_id,''),nullif(e.resend_email_id,''),e.email_id)) authored
      FROM json_each(?) page CROSS JOIN mobile_thread_members m ON m.thread_id=page.value AND m.user_id=?
      CROSS JOIN email e ON e.email_id=m.email_id AND e.user_id=m.user_id
      CROSS JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id AND a.is_del=0
      WHERE e.is_del=0 AND e.trashed_at IS NULL AND e.status NOT IN (6,7)
    ) SELECT thread_id,
      CASE WHEN authored THEN 'me' ELSE coalesce(min(nullif(trim(name),'')),min(send_email),'') END name,
      count(*) messages, sum(type=0 AND unread=0) unread,
      min(email_id) first_id, max(email_id) last_id
    FROM members GROUP BY thread_id,authored,CASE WHEN NOT authored THEN coalesce(nullif(lower(trim(send_email)),''),name) END
    ORDER BY thread_id,first_id`).bind(JSON.stringify(threadIds),userId).all();
  for (const row of results) {
    let summary = summaries.get(row.thread_id);
    if (!summary) {
      summary = { messageCount: 0, senders: [] };
      summaries.set(row.thread_id, summary);
    }
    summary.messageCount += row.messages;
    if (row.name) summary.senders.push({name:row.name, unread:Boolean(row.unread), lastId:row.last_id});
  }
  return summaries;
}
