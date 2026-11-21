import BizError from '../error/biz-error.js';

export const labelSchema = [
	`CREATE TABLE IF NOT EXISTS mailbox_labels (
    label_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE, UNIQUE(user_id,name))`,
	`CREATE TABLE IF NOT EXISTS mailbox_label_members (
    user_id INTEGER NOT NULL, label_id INTEGER NOT NULL REFERENCES mailbox_labels(label_id) ON DELETE CASCADE,
    email_id INTEGER NOT NULL, PRIMARY KEY(user_id,label_id,email_id))`,
	`CREATE TABLE IF NOT EXISTS mailbox_label_colors (
      label_id INTEGER PRIMARY KEY REFERENCES mailbox_labels(label_id) ON DELETE CASCADE,
      background TEXT, foreground TEXT)`,
	`CREATE TABLE IF NOT EXISTS mailbox_custom_colors (
      change_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, background TEXT NOT NULL,
      foreground TEXT NOT NULL, UNIQUE(user_id,background,foreground))`,
	`CREATE TABLE IF NOT EXISTS mailbox_label_display (
      label_id INTEGER PRIMARY KEY REFERENCES mailbox_labels(label_id) ON DELETE CASCADE,
      sidebar TEXT NOT NULL DEFAULT 'show' CHECK(sidebar IN ('show','unread','hide')),
      messages TEXT NOT NULL DEFAULT 'show' CHECK(messages IN ('show','hide')))`,
	'CREATE INDEX IF NOT EXISTS idx_labels_for_email ON mailbox_label_members(user_id,email_id,label_id)',
];
export async function listLabels(db, userId) {
	const {results} = await db.prepare(`SELECT l.label_id AS id,l.name,c.background,c.foreground,d.sidebar,d.messages
    FROM mailbox_labels l LEFT JOIN mailbox_label_colors c ON c.label_id=l.label_id
    LEFT JOIN mailbox_label_display d ON d.label_id=l.label_id
    WHERE l.user_id=? ORDER BY l.name COLLATE NOCASE`).bind(userId).all();
	return results.map(({id,name,background,foreground,sidebar,messages}) => ({
		id, name, ...(background ? {background,foreground} : {}),
		...(sidebar && sidebar !== 'show' ? {sidebar} : {}), ...(messages === 'hide' ? {messages} : {})
	}));
}

export async function setLabelDisplay(db, userId, id, {list, mode} = {}) {
	if (!['sidebar','messages'].includes(list) || !['show','hide'].includes(mode) && !(list === 'sidebar' && mode === 'unread'))
		throw new BizError('Invalid label visibility.', 400);
	const row = await db.prepare(`INSERT INTO mailbox_label_display(label_id,${list})
    SELECT label_id,? FROM mailbox_labels WHERE user_id=? AND label_id=?
    ON CONFLICT(label_id) DO UPDATE SET ${list}=excluded.${list} RETURNING label_id AS id,${list}`)
		.bind(mode,userId,id).first();
	if (!row) throw new BizError('Label not found.',404);
	return row;
}

// Paths are the wire format used by existing clients. Resolve the destination and
// rewrite the whole branch in one statement so concurrent moves cannot split it.
export async function saveLabel(db, userId, name, id, parentId = null) {
	if (typeof name !== 'string' || !name.trim() || name.trim().length > 100)
		throw new BizError('Enter a label name of up to 100 characters.', 400);
	if (parentId !== null && (!Number.isSafeInteger(parentId) || parentId < 1))
		throw new BizError('Choose an existing parent label.',400);
	const target = `destination(path) AS MATERIALIZED (
    SELECT ? WHERE ? IS NULL
    UNION ALL SELECT name || '/' || ? FROM mailbox_labels WHERE user_id=? AND label_id=?
  )`;
	const args=[name.trim(),parentId,name.trim(),userId,parentId];
	try {
		if (id === undefined) {
			const row=await db.prepare(`WITH ${target}
        INSERT INTO mailbox_labels(user_id,name) SELECT ?,path FROM destination RETURNING label_id AS id,name`)
				.bind(...args,userId).first();
			if (!row) throw new BizError('Parent label not found.',404);
			return row;
		}
		const [write,selected] = await db.batch([
			db.prepare(`WITH ${target},
        source(path) AS MATERIALIZED (SELECT name FROM mailbox_labels WHERE user_id=? AND label_id=?),
        move(old_path,new_path) AS MATERIALIZED (
          SELECT source.path,destination.path FROM source,destination
          WHERE substr(destination.path,1,length(source.path)+1) != source.path || '/' COLLATE NOCASE
        )
        UPDATE mailbox_labels SET name=(SELECT new_path || substr(name,length(old_path)+1) FROM move)
        WHERE user_id=? AND EXISTS (SELECT 1 FROM move WHERE label_id=?
          OR substr(name,1,length(old_path)+1) = old_path || '/' COLLATE NOCASE)`)
				.bind(...args,userId,id,userId,id),
			db.prepare('SELECT label_id AS id,name FROM mailbox_labels WHERE user_id=? AND label_id=?').bind(userId,id)
		]);
		const row=selected.results[0];
		if (!row) throw new BizError('Label not found.',404);
		if (!write.meta.changes) throw new BizError('Choose an existing parent outside this label.',400);
		return row;
	} catch (error) {
		if (String(error.message).includes('UNIQUE constraint')) throw new BizError('A label with that name already exists.',409);
		throw error;
	}
}

export async function recentLabelColors(db, userId) {
	const {results} = await db.prepare('SELECT background,foreground FROM mailbox_custom_colors WHERE user_id=? ORDER BY change_id DESC LIMIT 6').bind(userId).all();
	return results;
}

export async function setLabelColor(db, userId, id, colors) {
	const {background, foreground} = colors || {};
	const reset = background === null && foreground === null;
	const valid = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
	if (!reset && !(valid(background) && valid(foreground))) throw new BizError('Choose a background and text color.', 400);
	const write = db.prepare(`INSERT INTO mailbox_label_colors(label_id,background,foreground)
    SELECT label_id,?,? FROM mailbox_labels WHERE user_id=? AND label_id=?
    ON CONFLICT(label_id) DO UPDATE SET background=excluded.background,foreground=excluded.foreground
    RETURNING label_id AS id,background,foreground`)
		.bind(background?.toLowerCase() ?? null, foreground?.toLowerCase() ?? null, userId, id);
	const statements = [write];
	if (colors.custom === true && !reset) {
		statements.push(
			db.prepare(`INSERT OR REPLACE INTO mailbox_custom_colors(user_id,background,foreground)
        SELECT user_id,?,? FROM mailbox_labels WHERE user_id=? AND label_id=?`)
				.bind(background.toLowerCase(),foreground.toLowerCase(),userId,id),
			db.prepare(`DELETE FROM mailbox_custom_colors WHERE user_id=? AND change_id NOT IN
        (SELECT change_id FROM mailbox_custom_colors WHERE user_id=? ORDER BY change_id DESC LIMIT 6)`).bind(userId,userId)
		);
	}
	const [{results:[updated]}] = await db.batch(statements);
	if (!updated) throw new BizError('Label not found.', 404);
	return updated;
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
