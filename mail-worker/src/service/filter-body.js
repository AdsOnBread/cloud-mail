import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import emailUtils from '../utils/email-utils';
import { blankMailText } from './mail-word-schema';

export const filterBodies = sqliteTable('mail_filter_bodies', {
	emailId: integer('email_id').primaryKey(),
	body: text('body').notNull(),
});

// Supply visible text while the delivery trigger evaluates exclusions, preserving the MIME alternatives.
export function filterBodyStatement(db, row) {
	if (row.text?.trim() || !row.content || !row.userId) return null;
	return db
		.prepare(
			`INSERT OR REPLACE INTO mail_filter_bodies(email_id,body)
    SELECT email_id,? FROM email WHERE email_id=? AND user_id=? AND content=? AND ${blankMailText('text')}`,
		)
		.bind(emailUtils.htmlToText(row.content), row.emailId, row.userId, row.content);
}
