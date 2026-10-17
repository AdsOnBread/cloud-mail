import { or, and, eq, sql } from 'drizzle-orm';
import email from '../entity/email';

/** Literal substring search; values remain bound parameters, including LIKE metacharacters. */
export function mailSearchFilter(query) {
	const value = typeof query === 'string' ? query.trim() : '';
	if (!value) return undefined;
	const pattern = `%${value.replace(/[\\%_]/g, '\\$&')}%`;
	const contains = column => sql`${column} LIKE ${pattern} ESCAPE '\\'`;
	return or(
		...[email.name, email.sendEmail, email.recipient, email.cc, email.subject, email.text, email.content].map(contains),
		and(eq(email.type, 1), contains(email.bcc))
	);
}
