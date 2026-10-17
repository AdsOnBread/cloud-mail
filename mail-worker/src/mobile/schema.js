// Additive and repeatable: the existing installation initializer calls this after legacy upgrades.
export async function migrateMobile(db) {
	const columns = (await db.prepare('PRAGMA table_info(email)').all()).results;
	if (!columns.some(c => c.name === 'reply_to_email_id')) {
		await db.prepare('ALTER TABLE email ADD COLUMN reply_to_email_id INTEGER').run();
	}
	await db.batch([
		db.prepare('CREATE TABLE IF NOT EXISTS app_auth_limits (key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL)'),
		db.prepare('CREATE INDEX IF NOT EXISTS idx_app_auth_limits_bucket ON app_auth_limits(bucket)'),
		db.prepare(`CREATE TABLE IF NOT EXISTS mobile_changes (
			seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
			entity TEXT NOT NULL, entity_id INTEGER NOT NULL, operation TEXT NOT NULL,
			new_mail INTEGER NOT NULL DEFAULT 0, previous_thread_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
		db.prepare('CREATE INDEX IF NOT EXISTS idx_mobile_changes_user ON mobile_changes(user_id,seq)'),
		db.prepare(`CREATE TABLE IF NOT EXISTS mobile_thread_members (
			email_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, thread_id TEXT NOT NULL)`),
		db.prepare('CREATE INDEX IF NOT EXISTS idx_mobile_thread ON mobile_thread_members(user_id,thread_id,email_id)'),
		db.prepare(`CREATE TABLE IF NOT EXISTS mobile_thread_state (
			user_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, indexed_revision INTEGER NOT NULL DEFAULT 0)`),
		db.prepare(`INSERT OR IGNORE INTO mobile_thread_state(user_id) SELECT DISTINCT user_id FROM email WHERE user_id > 0`),
	]);
	const statements = [];
	const visible = r => `${r}.is_del=0 AND ${r}.status NOT IN (6,7) AND ${r}.user_id>0`;
	const dirty = r => `INSERT INTO mobile_thread_state(user_id,revision) VALUES (${r}.user_id,1)
		ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;`;
	for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
		const r = event === 'DELETE' ? 'OLD' : 'NEW';
		const newMail = event === 'INSERT'
			? `CASE WHEN NEW.type=0 AND NEW.status=0 AND NEW.is_del=0 THEN 1 ELSE 0 END`
			: event === 'UPDATE' ? `CASE WHEN OLD.status=6 AND NEW.status=0 AND NEW.type=0 AND NEW.is_del=0 THEN 1 ELSE 0 END` : '0';
		statements.push(db.prepare(`CREATE TRIGGER IF NOT EXISTS mobile_email_${event.toLowerCase()} AFTER ${event} ON email BEGIN
			INSERT INTO mobile_changes(user_id,entity,entity_id,operation,new_mail,previous_thread_id)
			VALUES (${r}.user_id,'message',${r}.email_id,${event === 'DELETE' ? "'delete'" : `CASE WHEN ${visible('NEW')} THEN 'upsert' ELSE 'delete' END`},${newMail},(SELECT thread_id FROM mobile_thread_members WHERE email_id=${r}.email_id));
			${dirty(r)}
			${event === 'INSERT' ? "INSERT OR IGNORE INTO mobile_thread_members(email_id,user_id,thread_id) SELECT NEW.email_id,NEW.user_id,'t-'||NEW.email_id WHERE NEW.user_id>0;" : ''}
			${event === 'DELETE' ? 'DELETE FROM mobile_thread_members WHERE email_id=OLD.email_id;' : ''}
		END`));
		statements.push(db.prepare(`CREATE TRIGGER IF NOT EXISTS mobile_account_${event.toLowerCase()} AFTER ${event} ON account BEGIN
			INSERT INTO mobile_changes(user_id,entity,entity_id,operation) VALUES (${r}.user_id,'mailbox',${r}.account_id,${event === 'DELETE' ? "'delete'" : "CASE WHEN NEW.is_del=0 THEN 'upsert' ELSE 'delete' END"});
			${dirty(r)} END`));
		statements.push(db.prepare(`CREATE TRIGGER IF NOT EXISTS mobile_star_${event.toLowerCase()} AFTER ${event} ON star BEGIN
			INSERT INTO mobile_changes(user_id,entity,entity_id,operation) VALUES (${r}.user_id,'message',${r}.email_id,'upsert'); END`));
	}
	statements.push(db.prepare(`CREATE TRIGGER IF NOT EXISTS mobile_email_owner AFTER UPDATE ON email WHEN OLD.user_id!=NEW.user_id BEGIN
		INSERT INTO mobile_changes(user_id,entity,entity_id,operation,previous_thread_id)
		VALUES (OLD.user_id,'message',OLD.email_id,'delete',(SELECT thread_id FROM mobile_thread_members WHERE email_id=OLD.email_id));
		${dirty('OLD')} END`));
	for (const event of ['INSERT', 'UPDATE']) {
		statements.push(db.prepare(`CREATE TRIGGER IF NOT EXISTS mobile_members_${event.toLowerCase()} AFTER ${event} ON mobile_thread_members
			${event === 'UPDATE' ? 'WHEN OLD.thread_id != NEW.thread_id OR OLD.user_id != NEW.user_id' : ''} BEGIN
			INSERT INTO mobile_changes(user_id,entity,entity_id,operation,previous_thread_id) VALUES (NEW.user_id,'message',NEW.email_id,'upsert',${event === 'UPDATE' ? 'OLD.thread_id' : 'NULL'}); END`));
	}
	await db.batch(statements);
}
