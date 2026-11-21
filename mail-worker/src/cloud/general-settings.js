import BizError from '../error/biz-error';

export async function readGeneralSettings(db, userId) {
  const row = await db.prepare('SELECT version,undo_seconds AS undoSeconds,reply_all AS replyAll FROM mail_general_settings WHERE user_id=?').bind(userId).first();
  return row ? {...row, replyAll: Boolean(row.replyAll)} : {version: 0, undoSeconds: null, replyAll: false};
}

export async function saveGeneralSettings(db, userId, input) {
  if (!input || !Number.isSafeInteger(input.version) || input.version < 0 ||
    ![5, 10, 20, 30].includes(input.undoSeconds) || typeof input.replyAll !== 'boolean')
    throw new BizError('Choose a supported cancellation period and reply behavior.', 400);
  const {version, undoSeconds, replyAll} = input;
  const args = [userId, undoSeconds, Number(replyAll)];
  const row = version === 0
    ? await db.prepare('INSERT INTO mail_general_settings(user_id,undo_seconds,reply_all) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING RETURNING version').bind(...args).first()
    : await db.prepare('UPDATE mail_general_settings SET undo_seconds=?,reply_all=?,version=version+1 WHERE user_id=? AND version=? RETURNING version').bind(undoSeconds, Number(replyAll), userId, version).first();
  if (!row) throw new BizError('Settings changed elsewhere. Reload saved settings before editing again.', 409);
  return {version: row.version, undoSeconds, replyAll};
}
