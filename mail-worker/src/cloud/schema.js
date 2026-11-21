import {scheduledTrashSchema} from './scheduled-trash-schema.js';
import {mailWordSchema} from '../service/mail-word-schema.js';
export const systemLabelSchema = `CREATE TABLE IF NOT EXISTS system_label_display (
  user_id INTEGER NOT NULL, folder TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('show','hide','unread')),
  PRIMARY KEY(user_id,folder))`;
export const signatureSchema = 'CREATE TABLE IF NOT EXISTS mail_signatures (user_id INTEGER PRIMARY KEY,version INTEGER NOT NULL,data TEXT NOT NULL)';

// Recheck after a concurrent initializer adds the same column.
export async function ensureRawSizeColumn(readColumns, addColumn) {
  return ensureEmailColumn(readColumns,addColumn,'raw_size');
}
export async function ensureEmailColumn(readColumns,addColumn,name) {
  if (!['raw_size','scheduled_draft_id'].includes(name)) throw new Error('Unknown email column');
  const exists=async()=>(await readColumns()).some(column=>column.name===name);
  if (await exists()) return;
  try { await addColumn('ALTER TABLE email ADD COLUMN '+name+' INTEGER'); }
  catch(error) { if (!(await exists())) throw error; }
}

export async function migrateCloud(db) {
  const readColumns=async()=>(await db.prepare('PRAGMA table_info(email)').all()).results;
  await ensureRawSizeColumn(readColumns,sql=>db.prepare(sql).run());
  await ensureEmailColumn(readColumns,sql=>db.prepare(sql).run(),'scheduled_draft_id');
  const columns = await readColumns();
  if (!columns.some(c => c.name === 'trashed_at')) await db.prepare('ALTER TABLE email ADD COLUMN trashed_at TEXT').run();
  await db.batch([
    ...scheduledTrashSchema.map(sql=>db.prepare(sql)),
    ...mailWordSchema().map(sql=>db.prepare(sql)),
    db.prepare(signatureSchema),
    db.prepare(systemLabelSchema),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_email_trash ON email(user_id,trashed_at,email_id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS cloud_drafts (
      draft_id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,client_id TEXT NOT NULL,
      account_id INTEGER NOT NULL,mutation_id TEXT,version INTEGER NOT NULL DEFAULT 1,data TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,client_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_cloud_drafts_user ON cloud_drafts(user_id,draft_id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS draft_files (
      attachment_id TEXT PRIMARY KEY,draft_id INTEGER NOT NULL,user_id INTEGER NOT NULL,
      key TEXT NOT NULL,filename TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,content_id TEXT)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_draft_files_owner ON draft_files(user_id,draft_id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS draft_changes (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,draft_id INTEGER NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_draft_changes_user ON draft_changes(user_id,seq)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS send_attempts (
      user_id INTEGER NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,
      draft_id INTEGER,state TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id,idempotency_key))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS connected_apps (
      grant_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,client_id TEXT NOT NULL,name TEXT NOT NULL,
      scopes TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    ...['INSERT','UPDATE'].map(event => db.prepare(`CREATE TRIGGER IF NOT EXISTS cloud_draft_${event.toLowerCase()} AFTER ${event} ON cloud_drafts BEGIN
      INSERT INTO draft_changes(user_id,draft_id) VALUES(NEW.user_id,NEW.draft_id); END`)),
  ]);
}
