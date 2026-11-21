// A delivered message remains a valid reply target until it is permanently removed.
export function replySource(db, userId, emailId) {
	return db
		.prepare(
			`SELECT e.email_id emailId, e.message_id messageId, e.relation
    FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id
    WHERE e.email_id=? AND e.user_id=? AND a.is_del=0 AND e.is_del=0
      AND e.status NOT IN (6,7) AND e.scheduled_draft_id IS NULL`,
		)
		.bind(Number(emailId), userId)
		.first();
}
