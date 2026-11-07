import emailUtils from '../utils/email-utils';
import BizError from '../error/biz-error';
import { camel } from '../mobile/service';
import { positive, pageSize } from './auth';
import emailService from '../service/email-service';
import r2Service from '../service/r2-service';

export const owned = 'e.user_id=? AND a.user_id=e.user_id AND a.is_del=0 AND e.is_del=0 AND e.status NOT IN (6,7)';
export async function list(c,userId,p={}) {
  const filters=[owned]; const args=[userId];
  const folder=p.folder||'inbox';
  if(!['inbox','sent','all','starred','trash'].includes(folder)) throw new BizError('Invalid folder.',400);
  filters.push(folder==='trash'?'e.trashed_at IS NOT NULL':'e.trashed_at IS NULL');
  if(folder==='inbox') filters.push('e.type=0 AND e.status=0');
  if(folder==='sent') filters.push('e.type=1');
  if(folder==='starred') filters.push('s.star_id IS NOT NULL');
  if(p.accountId) {filters.push('e.account_id=?');args.push(positive(p.accountId));}
  if(p.cursor) {filters.push('e.email_id<?');args.push(positive(p.cursor));}
  if(p.q?.trim()) {
    const term='%'+p.q.trim().slice(0,200).replace(/[\\%_]/g,'\\$&')+'%';
    filters.push(`(e.name LIKE ? ESCAPE '\\' OR e.subject LIKE ? ESCAPE '\\' OR e.send_email LIKE ? ESCAPE '\\' OR e.text LIKE ? ESCAPE '\\' OR e.content LIKE ? ESCAPE '\\' OR e.recipient LIKE ? ESCAPE '\\' OR e.cc LIKE ? ESCAPE '\\' OR (e.type=1 AND e.bcc LIKE ? ESCAPE '\\'))`);
    args.push(...Array(8).fill(term));
  }
  const limit=pageSize(p.limit);
  const rows=(await c.env.db.prepare(`SELECT e.email_id,e.account_id,e.subject,e.send_email,e.name,e.type,e.status,e.unread,e.create_time,e.trashed_at,
    e.recipient,e.cc,CASE WHEN e.type=1 THEN e.bcc ELSE '[]' END bcc,SUBSTR(COALESCE(e.text,''),1,180) preview
    FROM email e JOIN account a ON a.account_id=e.account_id LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id
    WHERE ${filters.join(' AND ')} ORDER BY e.email_id DESC LIMIT ?`).bind(...args,limit+1).all()).results;
  return {messages:rows.slice(0,limit).map(camel),hasMore:rows.length>limit,nextCursor:rows.length>limit?rows[limit-1].email_id:null};
}
export async function detail(c,userId,emailId) {
  const row=await c.env.db.prepare(`SELECT e.*,CASE WHEN s.star_id IS NULL THEN 0 ELSE 1 END is_star FROM email e JOIN account a ON a.account_id=e.account_id
    LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id WHERE ${owned} AND e.email_id=?`).bind(userId,positive(emailId)).first();
  if(!row) throw new BizError('Message not found.',404);
  if(row.type!==1) row.bcc='[]';
  const files=(await c.env.db.prepare('SELECT * FROM attachments WHERE email_id=? AND user_id=?').bind(row.email_id,userId).all()).results;
  return {...camel(row),text:row.text||emailUtils.htmlToText(row.content||''),attList:files.map(camel)};
}
export async function attachment(c,userId,id) {
  const row=await c.env.db.prepare(`SELECT att.* FROM attachments att JOIN email e ON e.email_id=att.email_id JOIN account a ON a.account_id=e.account_id
    WHERE ${owned} AND att.user_id=? AND att.att_id=?`).bind(userId,userId,positive(id)).first();
  if(!row) throw new BizError('Attachment not found.',404);
  const object=await r2Service.getObj(c,row.key);
  if(!object) throw new BizError('Attachment unavailable.',404);
  return {row,object};
}
export async function trash(c,userId,ids,action='trash') {
  if(!Array.isArray(ids)||!ids.length||ids.length>100) throw new BizError('Choose 1 to 100 messages.',400);
  ids=[...new Set(ids.map(id=>positive(id)))];
  const placeholders=ids.map(()=>'?').join(',');
  const rows=(await c.env.db.prepare(`SELECT e.email_id,e.trashed_at FROM email e JOIN account a ON a.account_id=e.account_id
    WHERE ${owned} AND e.email_id IN (${placeholders})`).bind(userId,...ids).all()).results;
  if(rows.length!==ids.length) throw new BizError('Message not found.',404);
  if(action==='purge') {
    if(rows.some(r=>!r.trashed_at)) throw new BizError('Only messages in Trash can be permanently deleted.',400);
    await emailService.physicsDelete(c,{emailIds:ids.join(',')});
  } else {
    await c.env.db.prepare(`UPDATE email SET trashed_at=${action==='restore'?'NULL':'COALESCE(trashed_at,CURRENT_TIMESTAMP)'} WHERE user_id=? AND email_id IN (${placeholders})`).bind(userId,...ids).run();
  }
  return {messageCount:ids.length};
}
export async function purgeExpired(c) {
  for(;;) {
    const rows=(await c.env.db.prepare("SELECT email_id FROM email WHERE trashed_at IS NOT NULL AND trashed_at<=datetime('now','-30 days') LIMIT 80").all()).results;
    if(!rows.length) break;
    await emailService.physicsDelete(c,{emailIds:rows.map(r=>r.email_id).join(',')});
  }
}
export function fileResponse(object,row) {
  return new Response(object.body||object,{headers:{'Content-Type':row.mime_type||'application/octet-stream',
    'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.filename||'attachment')}`,
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
