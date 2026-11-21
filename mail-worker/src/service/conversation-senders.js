// Count and style authors from the same visible messages as the conversation reader.
export async function conversationSenders(db, userId, threadIds) {
  const summaries = new Map();
  if (!threadIds.length) return summaries;
  const {results} = await db.prepare(`SELECT m.thread_id,
      CASE WHEN e.type=1 THEN 'me' ELSE coalesce(min(nullif(trim(e.name),'')),min(e.send_email),'') END name,
      count(*) messages, sum(e.type=0 AND e.unread=0) unread,
      min(e.email_id) first_id, max(e.email_id) last_id
    FROM json_each(?) page CROSS JOIN mobile_thread_members m ON m.thread_id=page.value AND m.user_id=?
    JOIN email e ON e.email_id=m.email_id AND e.user_id=m.user_id
    JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id AND a.is_del=0
    WHERE e.is_del=0 AND e.trashed_at IS NULL AND e.status NOT IN (6,7)
    GROUP BY m.thread_id,e.type=1,CASE WHEN e.type<>1 THEN coalesce(nullif(lower(trim(e.send_email)),''),e.name) END
    ORDER BY m.thread_id,first_id`).bind(JSON.stringify(threadIds),userId).all();
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
