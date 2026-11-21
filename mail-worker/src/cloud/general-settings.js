import BizError from '../error/biz-error';

import {defaultTextStyle,validTextStyle} from '../../../shared/mail-text-style';
import {validatedSignatures} from './signatures';

function savedStyle(value) {
  return value ? {textStyle:JSON.parse(value)} : {};
}

export async function readGeneralSettings(db, userId) {
  const row = await db.prepare('SELECT version,undo_seconds AS undoSeconds,reply_all AS replyAll,keyboard_shortcuts AS keyboardShortcuts,hover_actions AS hoverActions,text_style FROM mail_general_settings WHERE user_id=?').bind(userId).first();
  if (row) {Object.assign(row,savedStyle(row.text_style));delete row.text_style;}
  return row ? {...row, replyAll: Boolean(row.replyAll),keyboardShortcuts:Boolean(row.keyboardShortcuts),hoverActions:Boolean(row.hoverActions)} : {version: 0, undoSeconds: null, replyAll: false,keyboardShortcuts:false,hoverActions:true};
}

export async function saveGeneralSettings(db, userId, input) {
  if (!input || !Number.isSafeInteger(input.version) || input.version < 0 ||
    ![5, 10, 20, 30].includes(input.undoSeconds) || typeof input.replyAll !== 'boolean')
    throw new BizError('Choose a supported cancellation period and reply behavior.', 400);
  if (input.keyboardShortcuts !== undefined && typeof input.keyboardShortcuts !== 'boolean')
    throw new BizError('Choose whether to enable keyboard shortcuts.', 400);
  if (input.hoverActions !== undefined && typeof input.hoverActions !== 'boolean')
    throw new BizError('Choose whether to enable hover actions.', 400);
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
      db.prepare(`INSERT INTO mail_general_settings(user_id,undo_seconds,reply_all,keyboard_shortcuts,hover_actions,text_style)
        SELECT ?1,?2,?3,coalesce(?6,0),coalesce(?7,1),?8 WHERE coalesce((SELECT version FROM mail_general_settings WHERE user_id=?1),0)=?4
          AND coalesce((SELECT version FROM mail_signatures WHERE user_id=?1),0)=?5
        ON CONFLICT(user_id) DO UPDATE SET undo_seconds=excluded.undo_seconds,reply_all=excluded.reply_all,keyboard_shortcuts=coalesce(?6,keyboard_shortcuts),hover_actions=coalesce(?7,hover_actions),text_style=coalesce(?8,text_style),version=version+1
        RETURNING version,keyboard_shortcuts,hover_actions,text_style`).bind(userId, undoSeconds, Number(replyAll), version, sigVersion, shortcuts, hover, style),
      db.prepare(`INSERT INTO mail_signatures(user_id,version,data)
        SELECT ?,1,? WHERE changes()=1
        ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,version=version+1
        RETURNING version`).bind(userId, JSON.stringify(data)),
    ]);
    if (!general.results.length) throw new BizError('Settings changed elsewhere. Reload the saved settings before editing again.', 409);
    return {...savedStyle(general.results[0].text_style),version:general.results[0].version, undoSeconds, replyAll, keyboardShortcuts:Boolean(general.results[0].keyboard_shortcuts), hoverActions:Boolean(general.results[0].hover_actions), signatures:{version:signatures.results[0].version,...data}};
  }
  const row = version === 0
    ? await db.prepare('INSERT INTO mail_general_settings(user_id,undo_seconds,reply_all,keyboard_shortcuts,hover_actions,text_style) VALUES(?,?,?,coalesce(?,0),coalesce(?,1),?) ON CONFLICT(user_id) DO NOTHING RETURNING version,keyboard_shortcuts,hover_actions,text_style').bind(userId, undoSeconds, Number(replyAll), shortcuts, hover, style).first()
    : await db.prepare('UPDATE mail_general_settings SET undo_seconds=?,reply_all=?,keyboard_shortcuts=coalesce(?,keyboard_shortcuts),hover_actions=coalesce(?,hover_actions),text_style=coalesce(?,text_style),version=version+1 WHERE user_id=? AND version=? RETURNING version,keyboard_shortcuts,hover_actions,text_style').bind(undoSeconds, Number(replyAll), shortcuts, hover, style, userId, version).first();
  if (!row) throw new BizError('Settings changed elsewhere. Reload saved settings before editing again.', 409);
  return {...savedStyle(row.text_style),version: row.version, undoSeconds, replyAll, keyboardShortcuts:Boolean(row.keyboard_shortcuts),hoverActions:Boolean(row.hover_actions)};
}
