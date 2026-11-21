import BizError from '../error/biz-error';

import {categoryFolders} from '../service/inbox-categories';

const folders=new Set(['star','snoozed','important','send','scheduled','draft','all','archived','trash','purchases',...categoryFolders,...categoryFolders.map(id=>'messages-'+id)]);

export async function systemLabels(db,userId) {
  const {results}=await db.prepare('SELECT folder,mode FROM system_label_display WHERE user_id=?').bind(userId).all();
  return Object.fromEntries(results.map(({folder,mode})=>[folder,mode]));
}
export async function setSystemLabel(db,userId,folder,mode) {
  if (!folders.has(folder) || !['show','hide','unread'].includes(mode) ||
      (mode==='unread' && !['scheduled','draft'].includes(folder))) throw new BizError('Invalid folder visibility.',400);
  await db.prepare(`INSERT INTO system_label_display(user_id,folder,mode) VALUES(?,?,?)
    ON CONFLICT(user_id,folder) DO UPDATE SET mode=excluded.mode`).bind(userId,folder,mode).run();
  return {folder,mode};
}
