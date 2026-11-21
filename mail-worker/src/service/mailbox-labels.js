import BizError from '../error/biz-error.js';

export const labelSchema = [
	`CREATE TABLE IF NOT EXISTS mailbox_labels (
    label_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE, UNIQUE(user_id,name))`,
	`CREATE TABLE IF NOT EXISTS mailbox_label_members (
    user_id INTEGER NOT NULL, label_id INTEGER NOT NULL REFERENCES mailbox_labels(label_id) ON DELETE CASCADE,
    email_id INTEGER NOT NULL, PRIMARY KEY(user_id,label_id,email_id))`,
	'CREATE INDEX IF NOT EXISTS idx_labels_for_email ON mailbox_label_members(user_id,email_id,label_id)',
];
export function listLabels(db, userId) {
	return db
		.prepare('SELECT label_id AS id,name FROM mailbox_labels WHERE user_id=? ORDER BY name COLLATE NOCASE')
		.bind(userId)
		.all()
		.then((result) => result.results);
}
export async function saveLabel(db, userId, name, id) {
	if (typeof name !== 'string' || !name.trim() || name.trim().length > 100)
		throw new BizError('Enter a label name of up to 100 characters.', 400);
	try {
		const row =
			id === undefined
				? await db
						.prepare('INSERT INTO mailbox_labels(user_id,name) VALUES(?,?) RETURNING label_id AS id,name')
						.bind(userId, name.trim())
						.first()
				: await db
						.prepare('UPDATE mailbox_labels SET name=? WHERE label_id=? AND user_id=? RETURNING label_id AS id,name')
						.bind(name.trim(), id, userId)
						.first();
		if (!row) throw new BizError('Label not found.', 404);
		return row;
	} catch (error) {
		if (String(error.message).includes('UNIQUE constraint')) throw new BizError('A label with that name already exists.', 409);
		throw error;
	}
}
export async function removeLabel(db, userId, id) {
	const result = await db.prepare('DELETE FROM mailbox_labels WHERE user_id=? AND label_id=? RETURNING label_id').bind(userId, id).first();
	if (!result) throw new BizError('Label not found.', 404);
}

export async function changeLabels(db, userId, ids, add, remove) {
	if (
		![add, remove].every((list) => Array.isArray(list) && list.length <= 50 && list.every((id) => Number.isSafeInteger(id) && id > 0)) ||
		(!add.length && !remove.length) ||
		add.some((id) => remove.includes(id))
	)
		throw new BizError('Invalid label selection.', 400);
	const labels = new Set((await listLabels(db, userId)).map((label) => label.id));
	if ([...add, ...remove].some((id) => !labels.has(id))) throw new BizError('Label not found.', 404);
	const statements = [];
	for (let i = 0; i < ids.length; i += 40) {
		const chunk = ids.slice(i, i + 40),
			placeholders = chunk.map(() => '?').join(',');
		if (add.length)
			statements.push(
				db
					.prepare(
						`INSERT OR IGNORE INTO mailbox_label_members(user_id,label_id,email_id)
      SELECT l.user_id,l.label_id,e.email_id FROM mailbox_labels l JOIN email e ON e.user_id=l.user_id
      WHERE l.user_id=? AND l.label_id IN (${add.map(() => '?')}) AND e.email_id IN (${placeholders})`,
					)
					.bind(userId, ...add, ...chunk),
			);
		if (remove.length)
			statements.push(
				db
					.prepare(
						`DELETE FROM mailbox_label_members WHERE user_id=? AND label_id IN (${remove.map(() => '?')})
      AND email_id IN (${placeholders})`,
					)
					.bind(userId, ...remove, ...chunk),
			);
	}
	await db.batch(statements);
}
