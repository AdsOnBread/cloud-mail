import { attachedFile } from "./mailbox-attachments";

// Both the conversation and message lists use "e" for the owned, visible email.
export function addMailFilters(params, filters, args, {conversation = false} = {}) {
	for (const [field, columns] of Object.entries({
		from: ['e.send_email', 'e.name'],
		to: ['e.recipient', 'e.cc', "CASE WHEN e.type=1 THEN e.bcc ELSE '' END"],
		subject: ['e.subject'],
	})) {
		const value = params[field]?.trim();
		if (!value) continue;
		// instr treats wildcard characters in names and addresses literally.
		filters.push('(' + columns.map((column) => `instr(lower(${column}),lower(?))>0`).join(' OR ') + ')');
		args.push(...columns.map(() => value.slice(0, 200)));
	}
	if (String(params.hasAttachment) === '1')
		filters.push(conversation
      ? `EXISTS (SELECT 1 FROM mobile_thread_members fm JOIN email e ON e.email_id=fm.email_id AND e.user_id=fm.user_id
          JOIN account fa ON fa.account_id=e.account_id AND fa.user_id=e.user_id AND fa.is_del=0
          JOIN attachments att ON ${attachedFile} WHERE fm.user_id=m.user_id AND fm.thread_id=m.thread_id
          AND e.is_del=0 AND e.trashed_at IS NULL AND e.status NOT IN (6,7))`
      : `EXISTS (SELECT 1 FROM attachments att WHERE ${attachedFile})`);
	if (String(params.isUnread) === '1') filters.push('e.type=0 AND e.unread=0');
	const days = Number(params.days);
	if ([1, 7, 30, 365].includes(days)) {
		filters.push("e.create_time>=datetime('now',?)");
		args.push('-' + days + ' days');
	}
}
