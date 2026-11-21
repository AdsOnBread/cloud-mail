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
  `CREATE TABLE IF NOT EXISTS mailbox_label_creations (
    user_id INTEGER NOT NULL, token TEXT NOT NULL, label_id INTEGER NOT NULL REFERENCES mailbox_labels(label_id) ON DELETE CASCADE,
    leaf TEXT NOT NULL,parent_id INTEGER,moved_ids TEXT,PRIMARY KEY(user_id,token))`,
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

// A blank segment after the parent's separator belongs to a different legacy
// path, e.g. "Projects/" is a standalone label alongside "Projects".
function descendant(path, root) {
	return `(substr(${path},1,length(${root})+1) = (${root} || '/') COLLATE NOCASE
    AND substr(${path},length(${root})+2,1) NOT IN ('','/'))`;
}

export async function saveLabel(db, userId, name, id, parentId = null, token) {
	if (typeof name !== 'string' || !name.trim() || (id === undefined && name.trim().length > 100))
		throw new BizError('Enter a label name of up to 100 characters.', 400);
	if (parentId !== null && (!Number.isSafeInteger(parentId) || parentId < 1))
		throw new BizError('Choose an existing parent label.',400);
	const leaf=name.trim();
	if (parentId !== null && leaf.startsWith('/')) throw new BizError('A nested label name cannot start with a slash.',400);
	const target = `destination(path,parent_path) AS MATERIALIZED (
    SELECT ?,NULL WHERE ? IS NULL UNION ALL
    SELECT name || '/' || ?,name FROM mailbox_labels WHERE user_id=? AND label_id=?
  )`;
	const args=[leaf,parentId,leaf,userId,parentId];
	try {
		if (id === undefined) {
			if (token!==undefined) {
        if (typeof token!=='string' || !/^[a-zA-Z0-9-]{8,80}$/.test(token)) throw new BizError('Invalid label request.',400);
        const [,,receipt]=await db.batch([
          db.prepare(`WITH ${target} INSERT INTO mailbox_labels(user_id,name) SELECT ?,path FROM destination
            WHERE NOT EXISTS (SELECT 1 FROM mailbox_label_creations WHERE user_id=? AND token=?)`)
            .bind(...args,userId,userId,token),
          db.prepare(`WITH ${target} INSERT INTO mailbox_label_creations(user_id,token,label_id,leaf,parent_id)
            SELECT ?,?,l.label_id,?,? FROM destination JOIN mailbox_labels l ON l.user_id=? AND l.name=destination.path
            WHERE true ON CONFLICT(user_id,token) DO NOTHING`).bind(...args,userId,token,leaf,parentId,userId),
          db.prepare(`SELECT l.label_id AS id,l.name,r.leaf,r.parent_id FROM mailbox_label_creations r JOIN mailbox_labels l
            ON l.user_id=r.user_id AND l.label_id=r.label_id WHERE r.user_id=? AND r.token=?`).bind(userId,token)
        ]);
        const row=receipt.results[0];
        if (!row) throw new BizError('Parent label not found.',404);
        if (row.leaf!==leaf || row.parent_id!==parentId) throw new BizError('This request was used for another label.',409);
        return {id:row.id,name:row.name};
      }
      const row=await db.prepare(`WITH ${target}
        INSERT INTO mailbox_labels(user_id,name) SELECT ?,path FROM destination RETURNING label_id AS id,name`)
				.bind(...args,userId).first();
			if (!row) throw new BizError('Parent label not found.',404);
			return row;
		}
		// SQLite enforces uniqueness row by row. Use transaction-local BLOB names
		// outside the TEXT name space so a branch may safely overlap its old path.
		const token=crypto.randomUUID();
		const [stage,,selected] = await db.batch([
			db.prepare(`WITH ${target},
        source(path) AS MATERIALIZED (SELECT name FROM mailbox_labels WHERE user_id=? AND label_id=?
          AND (? OR name=? OR substr(name,-length(?)-1)='/'||?)),
        move(old_path) AS MATERIALIZED (
          SELECT source.path FROM source,destination
          WHERE (parent_path IS NULL OR (parent_path != source.path COLLATE NOCASE
            AND NOT ${descendant('parent_path','source.path')}))
            AND NOT ${descendant('destination.path','source.path')}
        )
        UPDATE mailbox_labels SET name=CAST(? || substr(name,(SELECT length(old_path)+1 FROM move)) AS BLOB)
        WHERE user_id=? AND EXISTS (SELECT 1 FROM move WHERE label_id=? OR ${descendant('name','old_path')})`)
				.bind(...args,userId,id,leaf.length<=100?1:0,leaf,leaf,leaf,token,userId,id),
			db.prepare(`WITH ${target} UPDATE mailbox_labels
        SET name=(SELECT path FROM destination) || substr(CAST(name AS TEXT),length(?)+1)
        WHERE user_id=? AND typeof(name)='blob' AND substr(CAST(name AS TEXT),1,length(?))=?`)
				.bind(...args,token,userId,token,token),
			db.prepare('SELECT label_id AS id,name FROM mailbox_labels WHERE user_id=? AND label_id=?').bind(userId,id)
		]);
		const row=selected.results[0];
		if (!row) throw new BizError('Label not found.',404);
		if (!stage.meta.changes) throw new BizError(leaf.length>100 ? 'Enter a label name of up to 100 characters.' : 'Choose an existing parent outside this label.',400);
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
