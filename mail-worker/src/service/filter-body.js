import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import emailUtils from '../utils/email-utils';
import { blankMailText } from './mail-word-schema';

export const filterBodies = sqliteTable('mail_filter_bodies', {
	emailId: integer('email_id').primaryKey(),
	body: text('body').notNull(),
});

// Keep the original MIME alternatives intact. This is only searchable presentation text.
export function filterBodyStatement(db, row) {
	if (row.text?.trim() || !row.content || !row.userId) return null;
	return db
		.prepare(
			`INSERT OR REPLACE INTO mail_filter_bodies(email_id,body)
    SELECT email_id,? FROM email WHERE email_id=? AND user_id=? AND content=? AND ${blankMailText('text')}`,
		)
		.bind(emailUtils.htmlToText(row.content), row.emailId, row.userId, row.content);
}

export async function prepareFilterBodies(db, user) {
	const { results } = await db
		.prepare(
			`SELECT e.email_id AS emailId,e.user_id AS userId,e.content
    FROM email e LEFT JOIN mail_filter_bodies b ON b.email_id=e.email_id
    WHERE e.user_id=? AND e.type=0 AND e.status=0 AND e.is_del=0 AND e.trashed_at IS NULL
      AND ${blankMailText('e.text')} AND length(e.content)>0 AND b.email_id IS NULL
    ORDER BY e.email_id LIMIT 12`,
		)
		.bind(user)
		.all();
	if (results.length) await db.batch(results.map((row) => filterBodyStatement(db, row)));
	return results.length < 12;
}
