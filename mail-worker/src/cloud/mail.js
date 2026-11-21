import {prepareExcludedSearch} from '../service/mail-word-index';
import { mailboxAttachments } from '../service/mailbox-attachments';
import {maxPeople,maxPersonTerm} from '../../../shared/mail-search-people';
import {peopleSuggestions} from '../../../shared/mail-people-suggestions';
import { addMailFilters,addPeopleFilter } from '../service/mail-search-filters';
import { ensureThreads } from '../mobile/threads';
import { filedConversations, inboxMember } from '../service/conversation-filing';
import emailUtils from '../utils/email-utils';
import BizError from '../error/biz-error';
import { camel } from '../mobile/service';
import { positive, pageSize } from './auth';
import emailService from '../service/email-service';
import r2Service from '../service/r2-service';

export const owned = 'e.user_id=? AND a.user_id=e.user_id AND a.is_del=0 AND e.is_del=0 AND e.status NOT IN (6,7)';
// Undelivered drafts retain their draft grant even while presented in the Trash mailbox.
function visibleMail(c) {
  return c.mailScopes && !c.mailScopes.includes('mail:drafts') ? owned+' AND e.scheduled_draft_id IS NULL' : owned;
}
// A small address-only projection keeps autocomplete independent of message bodies and attachments.
export async function searchPeople(c,userId,params) {
  const {field,accountId,folder}=params;
  if (folder==='compose' && field==='any') {
    const term=params.q?.trim().slice(0,maxPersonTerm), mailbox=positive(accountId);
    if (!term) return [];
    const projection=`SELECT e.email_id,e.name,e.send_email sendEmail,e.type,e.recipient,e.cc,
      CASE WHEN e.type=1 THEN e.bcc ELSE '' END bcc
      FROM candidates c JOIN email e ON e.email_id=c.id JOIN account a ON a.account_id=e.account_id
      WHERE ${visibleMail(c)} AND e.account_id=? AND e.trashed_at IS NULL ORDER BY e.email_id DESC`;
    const read=async (ids,args)=>(await c.env.db.prepare(`WITH candidates(id) AS MATERIALIZED (${ids}) ${projection}`)
      .bind(...args,userId,mailbox).all()).results;
    const recent=await read('SELECT email_id FROM email WHERE user_id=? AND account_id=? ORDER BY email_id DESC LIMIT 96',[userId,mailbox]);
    const limit=8+maxPeople, matches=peopleSuggestions(recent,'any',term,limit);
    const tokens=term.match(/[\p{L}\p{M}\p{N}]+/gu);
    if (matches.length>=limit || !tokens || term.length<2) return matches;
    // Search older indexed headers. Subject-only matches are rejected by peopleSuggestions.
    // Bound the FTS hits before reading addresses, including for common prefixes.
    const prefix='headers : "'+tokens.join(' ')+'"*';
    const older=await read('SELECT rowid FROM mail_word_index WHERE mail_word_index MATCH ? AND rowid<? ORDER BY rowid DESC LIMIT 192',
      [prefix,recent.at(-1)?.email_id ?? Number.MAX_SAFE_INTEGER]);
    return peopleSuggestions([...recent,...older],'any',term,limit);
  }
  if (!['from','to'].includes(field) || !['trash','scheduled'].includes(folder)) throw new BizError('Invalid people filter.',400);
  const filters=[visibleMail(c)], args=[userId], term=params.q?.trim().slice(0,maxPersonTerm) || '';
  if (accountId) { filters.push('e.account_id=?'); args.push(positive(accountId)); }
  const to=['e.recipient','e.cc',"CASE WHEN e.type=1 THEN e.bcc ELSE '' END"];
  addPeopleFilter({[field]:term}, field, field==='from' ? ['e.send_email','e.name'] : to, filters, args, true);
  const projection=field==='from' ? 'e.name,e.send_email sendEmail' : `e.type,e.recipient,e.cc,${to[2]} bcc`;
  const query=`SELECT ${projection} FROM email e JOIN account a ON a.account_id=e.account_id WHERE ${filters.join(' AND ')}`;
  const read=async condition=>(await c.env.db.prepare(query+condition+' ORDER BY e.email_id DESC LIMIT 80').bind(...args).all()).results;
  let recent;
  if (folder==='scheduled') {
    const sender="COALESCE(NULLIF(json_extract(d.data,'$.name'),''),NULLIF(a.name,''),a.email)";
    const draftColumns=field==='from' ? ['a.email',sender] : ['receiveEmail','cc','bcc'].map(key=>`json_extract(d.data,'$.${key}')`);
    const project=field==='from' ? `${sender} senderName,a.email senderEmail` :
      `d.draft_id draftId,${draftColumns[0]} recipients,${draftColumns[1]} cc,${draftColumns[2]} bcc`;
    const conditions=["d.user_id=?", "json_extract(d.data,'$.scheduledAt') IS NOT NULL"], values=[userId];
    if (accountId) {conditions.push('d.account_id=?');values.push(positive(accountId));}
    addPeopleFilter({[field]:term},field,draftColumns,conditions,values,true);
    recent=(await c.env.db.prepare(`SELECT ${project} FROM cloud_drafts d JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id AND a.is_del=0
      WHERE ${conditions.join(' AND ')} ORDER BY d.updated_at DESC,d.draft_id LIMIT 100`).bind(...values).all()).results;
  } else recent=await read(' AND e.trashed_at IS NOT NULL');
  const limit=8+maxPeople; // Allow the picker to omit contacts it already has selected.
  let suggestions=peopleSuggestions(recent,field,term,limit);
  if (suggestions.length<limit) {
    const other=await read(' AND e.trashed_at IS NULL');
    suggestions=peopleSuggestions([...recent,...other],field,term,limit);
  }
  return suggestions;
}
const messageLabels = `(SELECT json_group_array(label_id) FROM mailbox_label_members
  WHERE user_id=e.user_id AND email_id=e.email_id)`;
function messageFields(row) {
  const {label_ids,...message}=row;
  return label_ids ? {...camel(message),labelIds:JSON.parse(label_ids)} : camel(message);
}
export async function list(c,userId,p={}) {
  const filters=[visibleMail(c)]; const args=[userId];
  const folder=p.folder||'inbox';
  if(!['inbox','sent','all','starred','trash'].includes(folder)) throw new BizError('Invalid folder.',400);
  filters.push(folder==='trash'?'e.trashed_at IS NOT NULL':'e.trashed_at IS NULL');
  if(folder==='inbox') { await ensureThreads(c.env.db,userId); args.unshift(userId,userId); filters.push(inboxMember); }
  if(folder==='sent') filters.push('e.type=1');
  if(folder==='starred') filters.push('s.star_id IS NOT NULL');
  if(p.accountId) {filters.push('e.account_id=?');args.push(positive(p.accountId));}
  if(p.cursor) {filters.push('e.email_id<?');args.push(positive(p.cursor));}
  if (!(await prepareExcludedSearch(c.env.db,userId,p.accountId,p.excluded))) return {preparingSearch:true};
  addMailFilters(p,filters,args);
  if(p.q?.trim()) {
    const term='%'+p.q.trim().slice(0,200).replace(/[\\%_]/g,'\\$&')+'%';
    filters.push(`(e.name LIKE ? ESCAPE '\\' OR e.subject LIKE ? ESCAPE '\\' OR e.send_email LIKE ? ESCAPE '\\' OR e.text LIKE ? ESCAPE '\\' OR e.content LIKE ? ESCAPE '\\' OR e.recipient LIKE ? ESCAPE '\\' OR e.cc LIKE ? ESCAPE '\\' OR (e.type=1 AND e.bcc LIKE ? ESCAPE '\\'))`);
    args.push(...Array(8).fill(term));
  }
  const limit=pageSize(p.limit);
  const rows=(await c.env.db.prepare(`${folder==='inbox' ? `WITH ${filedConversations}` : ''} SELECT e.email_id,e.account_id,e.subject,e.send_email,e.name,e.type,e.status,e.unread,e.create_time,e.trashed_at,
    ${folder==='trash' ? 'e.scheduled_draft_id,'+messageLabels+' AS label_ids,' : ''} e.recipient,e.cc,CASE WHEN e.type=1 THEN e.bcc ELSE '[]' END bcc,SUBSTR(COALESCE(e.text,''),1,180) preview
    FROM email e JOIN account a ON a.account_id=e.account_id LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id
    ${folder==='inbox' ? 'JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id LEFT JOIN filed f ON f.thread_id=m.thread_id' : ''}
    WHERE ${filters.join(' AND ')} ORDER BY e.email_id DESC LIMIT ?`).bind(...args,limit+1).all()).results;
  const page=rows.slice(0,limit);
  const files=folder==='trash' ? await mailboxAttachments(c.env.db,userId,page,'trash') : new Map();
  return {messages:page.map(row=>({...messageFields(row),...files.get(row.email_id)})),hasMore:rows.length>limit,nextCursor:rows.length>limit?rows[limit-1].email_id:null};
}
export async function detail(c,userId,emailId) {
  const row=await c.env.db.prepare(`SELECT e.*,CASE WHEN e.trashed_at IS NOT NULL THEN ${messageLabels} END AS label_ids,CASE WHEN s.star_id IS NULL THEN 0 ELSE 1 END is_star FROM email e JOIN account a ON a.account_id=e.account_id
    LEFT JOIN star s ON s.email_id=e.email_id AND s.user_id=e.user_id WHERE ${visibleMail(c)} AND e.email_id=?`).bind(userId,positive(emailId)).first();
  if(!row) throw new BizError('Message not found.',404);
  if(row.type!==1) row.bcc='[]';
  const files=(await c.env.db.prepare('SELECT * FROM attachments WHERE email_id=? AND user_id=?').bind(row.email_id,userId).all()).results;
  return {...messageFields(row),text:row.text||emailUtils.htmlToText(row.content||''),attList:files.map(camel)};
}
export async function attachment(c,userId,id,textSample=false) {
  const row=await c.env.db.prepare(`SELECT att.* FROM attachments att JOIN email e ON e.email_id=att.email_id JOIN account a ON a.account_id=e.account_id
    WHERE ${visibleMail(c)} AND att.user_id=? AND att.att_id=?`).bind(userId,userId,positive(id)).first();
  if(!row) throw new BizError('Attachment not found.',404);
  const object=await r2Service.getObj(c,row.key,textSample ? 1024 : undefined);
  if(!object) throw new BizError('Attachment unavailable.',404);
  return {row,object};
}
export async function trash(c,userId,ids,action='trash') {
  if(!Array.isArray(ids)||!ids.length||ids.length>100) throw new BizError('Choose 1 to 100 messages.',400);
  ids=[...new Set(ids.map(id=>positive(id)))];
  const placeholders=ids.map(()=>'?').join(',');
  const rows=(await c.env.db.prepare(`SELECT e.email_id,e.trashed_at FROM email e JOIN account a ON a.account_id=e.account_id
    WHERE ${visibleMail(c)} AND e.email_id IN (${placeholders})`).bind(userId,...ids).all()).results;
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
  await c.env.db.prepare("DELETE FROM scheduled_trash_operations WHERE created_at<=datetime('now','-30 days')").run();
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
