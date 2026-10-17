import { getTableColumns, sql } from 'drizzle-orm';
import email from '../entity/email';

export const EMAIL_LIST_TEXT_LEN = 300;

/** Remove line breaks and tabs, and collapse consecutive spaces and whitespace between tags */
function sqlStripWhitespace(column) {
	return sql`trim(replace(replace(replace(replace(replace(replace(
		coalesce(${column}, ''),
		char(13), ''),
		char(10), ''),
		char(9), ' '),
		'  ', ' '),
		'  ', ' '),
		'> <', '><'))`;
}

/** Full query: all fields */
export const emailListColumns = {
	...getTableColumns(email),
	bcc: sql`CASE WHEN ${email.type}=1 THEN ${email.bcc} ELSE '[]' END`.as('bcc'),
};

/** Summary query: prefer text and only read compact HTML as a fallback; omit content from responses */
export const emailBriefColumns = {
	emailId: email.emailId,
	accountId: email.accountId,
	userId: email.userId,
	sendEmail: email.sendEmail,
	name: email.name,
	subject: email.subject,
	code: email.code,
	recipient: email.recipient,
	cc: email.cc,
	bcc: sql`CASE WHEN ${email.type}=1 THEN ${email.bcc} ELSE '[]' END`.as('bcc'),
	toEmail: email.toEmail,
	type: email.type,
	status: email.status,
	message: email.message,
	unread: email.unread,
	createTime: email.createTime,
	isDel: email.isDel,
	content: sql`CASE WHEN trim(coalesce(${email.text}, '')) != '' THEN NULL ELSE ${sqlStripWhitespace(email.content)} END`.as('content'),
	text: sql`substr(coalesce(${email.text}, ''), 1, ${EMAIL_LIST_TEXT_LEN})`.as('text'),
};
