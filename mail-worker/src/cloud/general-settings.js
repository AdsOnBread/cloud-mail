import BizError from '../error/biz-error';

import {defaultTextStyle,validTextStyle} from '../../../shared/mail-text-style';
import {validatedSignatures} from './signatures';

const fields='version,undo_seconds,reply_all,keyboard_shortcuts,hover_actions,text_style,advanced_toolbar';
function preferences(row) {
  return {
    version:row?.version ?? 0, undoSeconds:row?.undo_seconds ?? null, replyAll:Boolean(row?.reply_all),
    keyboardShortcuts:Boolean(row?.keyboard_shortcuts), hoverActions:row ? Boolean(row.hover_actions) : true,
    advancedToolbar:Boolean(row?.advanced_toolbar), ...(row?.text_style ? {textStyle:JSON.parse(row.text_style)} : {}),
  };
}
export async function readGeneralSettings(db, userId) {
  return preferences(await db.prepare(`SELECT ${fields} FROM mail_general_settings WHERE user_id=?`).bind(userId).first());
}

export async function saveGeneralSettings(db, userId, input) {
  if (!input || !Number.isSafeInteger(input.version) || input.version < 0 ||
    ![5, 10, 20, 30].includes(input.undoSeconds) || typeof input.replyAll !== 'boolean')
    throw new BizError('Choose a supported cancellation period and reply behavior.', 400);
  if (input.keyboardShortcuts !== undefined && typeof input.keyboardShortcuts !== 'boolean')
    throw new BizError('Choose whether to enable keyboard shortcuts.', 400);
  if (input.hoverActions !== undefined && typeof input.hoverActions !== 'boolean')
    throw new BizError('Choose whether to enable hover actions.', 400);
  if (input.advancedToolbar !== undefined && typeof input.advancedToolbar !== 'boolean')
    throw new BizError('Choose a supported toolbar layout.',400);
  const toolbar=input.advancedToolbar===undefined ? null : Number(input.advancedToolbar);
  // Clients predating this preference omit the field. Preserve their saved value.
  const shortcuts = input.keyboardShortcuts === undefined ? null : Number(input.keyboardShortcuts);
  const hover = input.hoverActions === undefined ? null : Number(input.hoverActions);
  let style=null;
  if (input.textStyle!==undefined) {
    if (!validTextStyle(input.textStyle)) throw new BizError('Choose a supported default text style.',400);
    const {font,size,color}=input.textStyle;
    style=font===defaultTextStyle.font && size===defaultTextStyle.size && color==='' ? '' : JSON.stringify({font,size,color});
  }
  const {version, undoSeconds, replyAll} = input;
  if (input.signatures !== undefined) {
    // Both version checks run before either write, inside the same D1 transaction.
    const data = validatedSignatures(input.signatures);
    const sigVersion = input.signatures.version;
    const [general, signatures] = await db.batch([
      db.prepare(`INSERT INTO mail_general_settings(user_id,undo_seconds,reply_all,keyboard_shortcuts,hover_actions,text_style,advanced_toolbar)
        SELECT ?1,?2,?3,coalesce(?6,0),coalesce(?7,1),?8,coalesce(?9,0) WHERE coalesce((SELECT version FROM mail_general_settings WHERE user_id=?1),0)=?4
          AND coalesce((SELECT version FROM mail_signatures WHERE user_id=?1),0)=?5
        ON CONFLICT(user_id) DO UPDATE SET undo_seconds=excluded.undo_seconds,reply_all=excluded.reply_all,keyboard_shortcuts=coalesce(?6,keyboard_shortcuts),hover_actions=coalesce(?7,hover_actions),text_style=coalesce(?8,text_style),advanced_toolbar=coalesce(?9,advanced_toolbar),version=version+1
        RETURNING ${fields}`).bind(userId, undoSeconds, Number(replyAll), version, sigVersion, shortcuts, hover, style, toolbar),
      db.prepare(`INSERT INTO mail_signatures(user_id,version,data)
        SELECT ?,1,? WHERE changes()=1
        ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,version=version+1
        RETURNING version`).bind(userId, JSON.stringify(data)),
    ]);
    if (!general.results.length) throw new BizError('Settings changed elsewhere. Reload the saved settings before editing again.', 409);
    return {...preferences(general.results[0]),signatures:{version:signatures.results[0].version,...data}};
  }
  const row = version === 0
    ? await db.prepare(`INSERT INTO mail_general_settings(user_id,undo_seconds,reply_all,keyboard_shortcuts,hover_actions,text_style,advanced_toolbar) VALUES(?,?,?,coalesce(?,0),coalesce(?,1),?,coalesce(?,0)) ON CONFLICT(user_id) DO NOTHING RETURNING ${fields}`).bind(userId, undoSeconds, Number(replyAll), shortcuts, hover, style, toolbar).first()
    : await db.prepare(`UPDATE mail_general_settings SET undo_seconds=?,reply_all=?,keyboard_shortcuts=coalesce(?,keyboard_shortcuts),hover_actions=coalesce(?,hover_actions),text_style=coalesce(?,text_style),advanced_toolbar=coalesce(?,advanced_toolbar),version=version+1 WHERE user_id=? AND version=? RETURNING ${fields}`).bind(undoSeconds, Number(replyAll), shortcuts, hover, style, toolbar, userId, version).first();
  if (!row) throw new BizError('Settings changed elsewhere. Reload saved settings before editing again.', 409);
  return preferences(row);
}
