import BizError from '../error/biz-error';

import {validatedSignatures} from './signatures';

export async function readGeneralSettings(db, userId) {
  const row = await db.prepare('SELECT version,undo_seconds AS undoSeconds,reply_all AS replyAll,keyboard_shortcuts AS keyboardShortcuts FROM mail_general_settings WHERE user_id=?').bind(userId).first();
  return row ? {...row, replyAll: Boolean(row.replyAll),keyboardShortcuts:Boolean(row.keyboardShortcuts)} : {version: 0, undoSeconds: null, replyAll: false,keyboardShortcuts:false};
}

export async function saveGeneralSettings(db, userId, input) {
  if (!input || !Number.isSafeInteger(input.version) || input.version < 0 ||
    ![5, 10, 20, 30].includes(input.undoSeconds) || typeof input.replyAll !== 'boolean')
    throw new BizError('Choose a supported cancellation period and reply behavior.', 400);
  if (input.keyboardShortcuts !== undefined && typeof input.keyboardShortcuts !== 'boolean')
    throw new BizError('Choose whether to enable keyboard shortcuts.', 400);
  // Clients predating this preference omit the field. Preserve their saved value.
  const shortcuts = input.keyboardShortcuts === undefined ? null : Number(input.keyboardShortcuts);
  const {version, undoSeconds, replyAll} = input;
  if (input.signatures !== undefined) {
    // Both version checks run before either write, inside the same D1 transaction.
    const data = validatedSignatures(input.signatures);
    const sigVersion = input.signatures.version;
    const [general, signatures] = await db.batch([
      db.prepare(`INSERT INTO mail_general_settings(user_id,undo_seconds,reply_all,keyboard_shortcuts)
        SELECT ?1,?2,?3,coalesce(?6,0) WHERE coalesce((SELECT version FROM mail_general_settings WHERE user_id=?1),0)=?4
          AND coalesce((SELECT version FROM mail_signatures WHERE user_id=?1),0)=?5
        ON CONFLICT(user_id) DO UPDATE SET undo_seconds=excluded.undo_seconds,reply_all=excluded.reply_all,keyboard_shortcuts=coalesce(?6,keyboard_shortcuts),version=version+1
        RETURNING version,keyboard_shortcuts`).bind(userId, undoSeconds, Number(replyAll), version, sigVersion, shortcuts),
      db.prepare(`INSERT INTO mail_signatures(user_id,version,data)
        SELECT ?,1,? WHERE changes()=1
        ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,version=version+1
        RETURNING version`).bind(userId, JSON.stringify(data)),
    ]);
    if (!general.results.length) throw new BizError('Settings changed elsewhere. Reload the saved settings before editing again.', 409);
    return {version:general.results[0].version, undoSeconds, replyAll, keyboardShortcuts:Boolean(general.results[0].keyboard_shortcuts), signatures:{version:signatures.results[0].version,...data}};
  }
  const row = version === 0
    ? await db.prepare('INSERT INTO mail_general_settings(user_id,undo_seconds,reply_all,keyboard_shortcuts) VALUES(?,?,?,coalesce(?,0)) ON CONFLICT(user_id) DO NOTHING RETURNING version,keyboard_shortcuts').bind(userId, undoSeconds, Number(replyAll), shortcuts).first()
    : await db.prepare('UPDATE mail_general_settings SET undo_seconds=?,reply_all=?,keyboard_shortcuts=coalesce(?,keyboard_shortcuts),version=version+1 WHERE user_id=? AND version=? RETURNING version,keyboard_shortcuts').bind(undoSeconds, Number(replyAll), shortcuts, userId, version).first();
  if (!row) throw new BizError('Settings changed elsewhere. Reload saved settings before editing again.', 409);
  return {version: row.version, undoSeconds, replyAll, keyboardShortcuts:Boolean(row.keyboard_shortcuts)};
}
