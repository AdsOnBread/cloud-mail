import { parseHTML } from 'linkedom';
import BizError from '../error/biz-error';
import { mailbox,positive,pageSize,conflict } from './auth';
import { normalizeAttachment,MAX_MESSAGE_BYTES } from '../service/email-sender';
import r2Service from '../service/r2-service';
import { camel } from '../mobile/service';

const fields=['name','subject','text','content','sendType','emailId','receiveEmail','cc','bcc','ui'];
function normalize(input,previous={}) {
  const value={...previous};
  for(const key of fields) if(Object.hasOwn(input,key)) value[key]=input[key];
  for(const key of ['subject','content','text','name']) {
    value[key]??='';
    if(typeof value[key]!=='string') throw new BizError(`Invalid ${key}.`,400);
  }
  for(const key of ['receiveEmail','cc','bcc']) {
    value[key]??=[];
    if(!Array.isArray(value[key])||value[key].length>50||value[key].some(a=>typeof a!=='string'||a.length>320)) throw new BizError('Invalid draft recipients.',400);
  }
  if(value.sendType&&!['reply','forward'].includes(value.sendType)) throw new BizError('Invalid message kind.',400);
  if(new TextEncoder().encode(JSON.stringify(value)).length>MAX_MESSAGE_BYTES) throw new BizError('Draft is too large.',413);
  if(value.ui!==undefined && (!value.ui||typeof value.ui!=='object'||Array.isArray(value.ui)))throw new BizError('Invalid draft presentation metadata.',400);
  // A retry of a create can identify its own original write without claiming a later editor's revision.
  value.ui={...(value.ui||{}),editToken:typeof input.ui?.editToken==='string'&&input.ui.editToken.length<=100?input.ui.editToken:crypto.randomUUID()};
  return value;
}
export async function files(c,userId,id) {
  return (await c.env.db.prepare('SELECT attachment_id,filename,mime_type,size,content_id FROM draft_files WHERE user_id=? AND draft_id=? ORDER BY attachment_id').bind(userId,id).all()).results.map(camel);
}
function decode(row,attachments) {
  return {...JSON.parse(row.data),draftId:row.draft_id,clientId:row.client_id,accountId:row.account_id,version:row.version,state:row.state,createTime:row.created_at,updatedAt:row.updated_at,attachments:attachments.map(camel)};
}
export async function get(c,userId,id,includeDeleted=false) {
  id=positive(id);
  const [rows,attachments]=await c.env.db.batch([
    c.env.db.prepare('SELECT d.* FROM cloud_drafts d JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id WHERE d.user_id=? AND d.draft_id=? AND a.is_del=0').bind(userId,id),
    c.env.db.prepare('SELECT attachment_id,filename,mime_type,size,content_id FROM draft_files WHERE user_id=? AND draft_id=? ORDER BY attachment_id').bind(userId,id)
  ]);
  const row=rows.results[0];
  if(!row || (!includeDeleted && ['deleted','sent'].includes(row.state))) throw new BizError('Draft not found.',404);
  return decode(row,attachments.results);
}
export async function list(c,userId,p={}) {
  const limit=pageSize(p.limit),cursor=p.cursor?positive(p.cursor):0;
  const rows=(await c.env.db.prepare(`SELECT d.draft_id FROM cloud_drafts d JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id WHERE d.user_id=? AND d.state NOT IN ('deleted','sent') AND a.is_del=0 AND d.draft_id>? ORDER BY d.draft_id LIMIT ?`).bind(userId,cursor,limit+1).all()).results;
  return {drafts:await Promise.all(rows.slice(0,limit).map(r=>get(c,userId,r.draft_id))),hasMore:rows.length>limit,nextCursor:rows.length>limit?rows[limit-1].draft_id:null};
}
export async function changes(c,userId,p={}) {
  const after=Number(p.after||0);if(!Number.isSafeInteger(after)||after<0) throw new BizError('Invalid draft cursor.',400);
  const limit=pageSize(p.limit);
  const rows=(await c.env.db.prepare('SELECT seq,draft_id FROM draft_changes WHERE user_id=? AND seq>? ORDER BY seq LIMIT ?').bind(userId,after,limit+1).all()).results;
  const events=[];
  for(const row of rows.slice(0,limit)) {
    let draft;try {draft=await get(c,userId,row.draft_id);} catch(e) {if(e.code!==404)throw e;}
    events.push({seq:row.seq,draftId:row.draft_id,operation:draft?'upsert':'delete',draft:draft||null});
  }
  return {changes:events,cursor:events.at(-1)?.seq??after,hasMore:rows.length>limit};
}
async function prepareFiles(c,userId,id,attachments) {
  if(!Array.isArray(attachments)||attachments.length>20) throw new BizError('Too many draft attachments.',400);
  const existing=id?await files(c,userId,id):[];const keep=[],fresh=[];let size=0;
  try {
    for(const input of attachments) {
      if(input.attachmentId) {
        const row=existing.find(f=>f.attachmentId===input.attachmentId);
        if(!row)throw new BizError('Draft attachment not found.',404);
        if(keep.some(f=>f.attachmentId===row.attachmentId))throw new BizError('Duplicate attachment.',400);
        keep.push(row);size+=row.size;continue;
      }
      const file=await normalizeAttachment(input);
      size+=file.content.byteLength;
      if(size>MAX_MESSAGE_BYTES) throw new BizError('Draft files exceed the message size limit.',413);
      const attachmentId=crypto.randomUUID(),key=`drafts/${userId}/${attachmentId}`;
      const row={attachmentId,key,filename:file.filename,mimeType:file.type,size:file.content.byteLength,contentId:file.contentId||null};
      fresh.push(row);
      await r2Service.putObj(c,key,file.content,{contentType:file.type});
      keep.push(row);
    }
    if(keep.filter(f=>!f.contentId).length>10||keep.filter(f=>f.contentId).length>10||size>MAX_MESSAGE_BYTES)throw new BizError('Too many files or draft is too large.',413);
    return {keep,fresh};
  } catch(error) { await removeObjects(c,fresh);throw error; }
}
async function removeObjects(c,rows) { for(const row of rows) {try{await r2Service.delete(c,row.key);}catch{console.warn('draft_file_cleanup_failed');}} }
export async function save(c,userId,input,id) {
  const old=id?await get(c,userId,id):null;
  if(old && (input.version!==old.version||old.state!=='draft')) throw conflict(old);
  const accountId=input.accountId??old?.accountId;await mailbox(c,userId,accountId);
  const data=normalize(input,old?Object.fromEntries(fields.map(k=>[k,old[k]]).filter(([,v])=>v!==undefined)):{});
  if(data.emailId) {
    const source=await c.env.db.prepare('SELECT e.email_id FROM email e JOIN account a ON a.account_id=e.account_id WHERE e.email_id=? AND e.user_id=? AND a.user_id=e.user_id AND e.is_del=0 AND a.is_del=0 AND e.trashed_at IS NULL').bind(positive(data.emailId),userId).first();
    if(!source && (!old || data.emailId!==old.emailId)) throw new BizError('Original message not found.',404);
  }
  const clientId=old?.clientId||input.clientId||crypto.randomUUID();
  if(typeof clientId!=='string'||clientId.length>100||!clientId)throw new BizError('Invalid draft import identifier.',400);
  if(!id) {
    const exists=await c.env.db.prepare('SELECT draft_id FROM cloud_drafts WHERE user_id=? AND client_id=?').bind(userId,clientId).first();
    if(exists) return get(c,userId,exists.draft_id,true);
  }
  let attachmentInput=input.attachments;
  const {document}=parseHTML('<html><body>'+data.content+'</body></html>');
  let extracted=false;
  for(const image of document.querySelectorAll('img')) {
    const source=image.getAttribute('src')||'';
    if(source.startsWith('data:image/')) {
      const match=/^data:(image\/(?:png|jpeg|gif|webp|heic|avif));base64,([\s\S]+)$/.exec(source);
      if(!match)throw new BizError('Unsupported inline image data.',400);
      if(!attachmentInput)attachmentInput=old?old.attachments:[];
      attachmentInput=[...attachmentInput];
      const existingInline=attachmentInput.find(f=>f.contentId&&typeof f.content==='string'&&f.content.replace(/^data:[^,]*;base64,/, '')===match[2]);
      const contentId=existingInline?.contentId||crypto.randomUUID();if(!existingInline)attachmentInput.push({filename:`inline-${contentId}.${match[1].split('/')[1]}`,content:match[2],contentType:match[1],contentId});
      image.setAttribute('src','cid:'+contentId);extracted=true;
    }
  }
  if(extracted)data.content=document.body.innerHTML;
  const prepared=attachmentInput===undefined?null:await prepareFiles(c,userId,id,attachmentInput);
  const mutation=crypto.randomUUID();
  const existingFiles=old?(await c.env.db.prepare('SELECT * FROM draft_files WHERE draft_id=? AND user_id=?').bind(id,userId).all()).results:[];
  const selector='SELECT draft_id FROM cloud_drafts WHERE user_id=? AND mutation_id=?';
  const statements=[old
    ? c.env.db.prepare("UPDATE cloud_drafts SET data=?,account_id=?,mutation_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_id=? AND version=? AND state='draft' RETURNING draft_id").bind(JSON.stringify(data),accountId,mutation,userId,positive(id),old.version)
    : c.env.db.prepare('INSERT INTO cloud_drafts(user_id,client_id,account_id,data,mutation_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id,client_id) DO NOTHING RETURNING draft_id').bind(userId,clientId,accountId,JSON.stringify(data),mutation)];
  if(prepared) {
    const keepIds=prepared.keep.map(f=>f.attachmentId);
    statements.push(c.env.db.prepare(`DELETE FROM draft_files WHERE draft_id IN (${selector}) ${keepIds.length?`AND attachment_id NOT IN (${keepIds.map(()=>'?').join(',')})`:''}`).bind(userId,mutation,...keepIds));
    for(const f of prepared.fresh) statements.push(c.env.db.prepare(`INSERT INTO draft_files SELECT ?,draft_id,?,?,?,?,?,? FROM cloud_drafts WHERE user_id=? AND mutation_id=?`).bind(f.attachmentId,userId,f.key,f.filename,f.mimeType,f.size,f.contentId,userId,mutation));
  }
  statements.push(c.env.db.prepare('SELECT * FROM cloud_drafts WHERE user_id=? AND mutation_id=?').bind(userId,mutation));
  statements.push(c.env.db.prepare(`SELECT attachment_id,filename,mime_type,size,content_id FROM draft_files WHERE user_id=? AND draft_id IN (${selector}) ORDER BY attachment_id`).bind(userId,userId,mutation));
  let row;
  try {
    const results=await c.env.db.batch(statements);row=results[0].results[0];
    if(!row) {
      if(old)throw conflict(await get(c,userId,id,true));
      const existing=await c.env.db.prepare('SELECT draft_id FROM cloud_drafts WHERE user_id=? AND client_id=?').bind(userId,clientId).first();
      await removeObjects(c,prepared?.fresh||[]);return get(c,userId,existing.draft_id,true);
    }
    if(prepared)await removeObjects(c,existingFiles.filter(f=>!prepared.keep.some(k=>k.attachmentId===f.attachment_id)));
    return decode(results.at(-2).results[0],results.at(-1).results);
  } catch(error) {if(!row)await removeObjects(c,prepared?.fresh||[]);throw error;}

}
export async function remove(c,userId,id,version) {
  version=positive(version,'draft revision');
  const old=await get(c,userId,id);
  const row=await c.env.db.prepare("UPDATE cloud_drafts SET state='deleted',data='{}',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_id=? AND version=? AND state='draft' RETURNING draft_id").bind(userId,positive(id),version).first();
  if(!row)throw conflict(await get(c,userId,id,true));
  await cleanFiles(c,userId,id);return {draftId:old.draftId,deleted:true};
}
export async function cleanFiles(c,userId,id) {
  const rows=(await c.env.db.prepare('SELECT key FROM draft_files WHERE draft_id=? AND user_id=?').bind(id,userId).all()).results;
  await c.env.db.prepare('DELETE FROM draft_files WHERE draft_id=? AND user_id=?').bind(id,userId).run();await removeObjects(c,rows);
}
export async function file(c,userId,attachmentId) {
  const row=await c.env.db.prepare("SELECT f.* FROM draft_files f JOIN cloud_drafts d ON d.draft_id=f.draft_id JOIN account a ON a.account_id=d.account_id AND a.user_id=d.user_id WHERE f.user_id=? AND f.attachment_id=? AND d.state NOT IN ('deleted','sent') AND a.is_del=0").bind(userId,attachmentId).first();
  if(!row)throw new BizError('Draft attachment not found.',404);
  const object=await r2Service.getObj(c,row.key);if(!object)throw new BizError('Draft file unavailable.',404);
  return {row,object};
}
export async function payload(c,userId,draft) {
  const attachments=[];let content=draft.content;
  for(const meta of draft.attachments) {
    const {object}=await file(c,userId,meta.attachmentId);
    const bytes=object.arrayBuffer?await object.arrayBuffer():await new Response(object.body||object).arrayBuffer();
    if(meta.contentId) {
      const data=base64(bytes);const source=`data:${meta.mimeType};base64,${data}`;
      content=content.replaceAll(`cid:${meta.contentId.replace(/^<|>$/g,'')}`,source).replaceAll(`/api/v1/drafts/attachments/${meta.attachmentId}/content`,source);
    } else attachments.push({filename:meta.filename,content:bytes,contentType:meta.mimeType});
  }
  return {...draft,content,attachments};
}
export function base64(bytes) {
  const array=new Uint8Array(bytes);let text='';for(let i=0;i<array.length;i+=8192)text+=String.fromCharCode(...array.subarray(i,i+8192));return btoa(text);
}

// Physical user removal also removes cloud-only files and send records.
export async function deleteUserData(c,userIds) {
  for(const userId of userIds) {
    const rows=(await c.env.db.prepare('SELECT draft_id FROM cloud_drafts WHERE user_id=?').bind(userId).all()).results;
    for(const row of rows)await cleanFiles(c,userId,row.draft_id);
    await c.env.db.batch(['cloud_drafts','draft_changes','send_attempts','connected_apps'].map(table=>c.env.db.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(userId)));
  }
}
