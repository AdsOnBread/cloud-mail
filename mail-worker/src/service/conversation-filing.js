import { moveUndoSchema } from './conversation-move-undo.js';
import { importanceSchema } from './mail-importance.js';
import { categorySchema } from './inbox-categories.js';
import { labelSchema } from './mailbox-labels.js';
// A filing follows the latest received message. A new reply therefore reopens the thread.
export const scheduledInboxSchema = `CREATE TABLE IF NOT EXISTS scheduled_inbox_deliveries (
  user_id INTEGER NOT NULL, email_id INTEGER NOT NULL REFERENCES email(email_id) ON DELETE CASCADE, wake_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,email_id))`;
export async function ensureDeliveredWakeColumn(readColumns,execute) {
  const hasColumn=async()=>(await readColumns()).some(column=>column.name==='wake_at');
  if (await hasColumn()) return;
  try { await execute('ALTER TABLE scheduled_inbox_deliveries ADD COLUMN wake_at INTEGER NOT NULL DEFAULT 0'); }
  catch (error) { if (!(await hasColumn())) throw error; }
}
export function filingSchema(tables = new Set(['email','cloud_drafts'])) {
	const statements = [
		...labelSchema, categorySchema, importanceSchema, scheduledInboxSchema,
		`CREATE TABLE IF NOT EXISTS conversation_filing (
			user_id INTEGER NOT NULL, email_id INTEGER NOT NULL, wake_at INTEGER, notified INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (user_id,email_id))`,
		'CREATE INDEX IF NOT EXISTS idx_filing_wake ON conversation_filing(user_id,notified,wake_at)',
    ...moveUndoSchema
	];
	if (tables.has('cloud_drafts')) statements.push("CREATE INDEX IF NOT EXISTS idx_due_drafts ON cloud_drafts(json_extract(data,'$.scheduledAt'),draft_id) WHERE state='scheduled'");
    if (tables.has('cloud_drafts')) statements.push("CREATE INDEX IF NOT EXISTS idx_queued_wake ON cloud_drafts(user_id,json_extract(data,'$.scheduledWakeAt')) WHERE json_extract(data,'$.scheduledAt') IS NOT NULL");
    if (tables.has('cloud_drafts')) statements.push("CREATE INDEX IF NOT EXISTS idx_sending_drafts ON cloud_drafts(updated_at) WHERE state='sending'");
    if (tables.has('cloud_drafts')) statements.push(`CREATE INDEX IF NOT EXISTS idx_reply_draft_activity
		ON cloud_drafts(user_id,json_extract(data,'$.emailId'),updated_at)
		WHERE state='draft' AND json_extract(data,'$.sendType')='reply'`);
	if (tables.has('email')) statements.push(`CREATE TRIGGER IF NOT EXISTS move_undo_trash_change AFTER UPDATE OF trashed_at ON email
    WHEN OLD.trashed_at IS NOT NEW.trashed_at BEGIN DELETE FROM conversation_move_undo WHERE state='ready' AND token IN
    (SELECT token FROM conversation_move_prior WHERE user_id=OLD.user_id AND email_id=OLD.email_id); END`);
	if (tables.has('email')) statements.push(`CREATE TRIGGER IF NOT EXISTS filing_cleanup AFTER DELETE ON email BEGIN
		DELETE FROM conversation_filing WHERE email_id=OLD.email_id AND user_id=OLD.user_id; END`);
	if (tables.has('email')) statements.push('CREATE TRIGGER IF NOT EXISTS label_member_cleanup AFTER DELETE ON email BEGIN DELETE FROM mailbox_label_members WHERE email_id=OLD.email_id AND user_id=OLD.user_id; END');
    if (tables.has('email')) statements.push('CREATE TRIGGER IF NOT EXISTS category_cleanup AFTER DELETE ON email BEGIN DELETE FROM mailbox_categories WHERE email_id=OLD.email_id AND user_id=OLD.user_id; END');
    if (tables.has('email')) statements.push('CREATE TRIGGER IF NOT EXISTS importance_cleanup AFTER DELETE ON email BEGIN DELETE FROM mailbox_importance WHERE email_id=OLD.email_id AND user_id=OLD.user_id; END');
	return statements;
}

// Bind the signed-in user first. Only threads that have a filing need their anchor recomputed.
export const filedConversations = `filing_anchors AS (
  SELECT m.thread_id,m.user_id,
    COALESCE(MAX(CASE WHEN e.type=0 AND e.status=0 THEN e.email_id END),MIN(e.email_id)) AS anchor
  FROM mobile_thread_members m JOIN email e ON e.email_id=m.email_id AND e.user_id=m.user_id
  JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id
  WHERE m.user_id=? AND a.is_del=0 AND e.is_del=0 AND e.trashed_at IS NULL AND e.status NOT IN (6,7)
    AND (m.user_id,m.thread_id) IN (SELECT member.user_id,member.thread_id FROM conversation_filing old
      JOIN mobile_thread_members member ON old.user_id=member.user_id AND old.email_id=member.email_id WHERE old.user_id=?)
  GROUP BY m.user_id,m.thread_id),
  filed AS (SELECT a.thread_id,f.email_id,f.wake_at,f.notified FROM filing_anchors a
    JOIN conversation_filing f ON f.user_id=a.user_id AND f.email_id=a.anchor)`;

export const inboxMember = `((e.type=0 AND e.status=0 OR e.email_id=f.email_id AND f.wake_at<=unixepoch())
  AND (f.email_id IS NULL OR f.wake_at<=unixepoch()))`;
