import BizError from '../error/biz-error';
import emailService from '../service/email-service';
import emailUtils from '../utils/email-utils';
import { permission,mailbox,positive,conflict } from './auth';
import * as drafts from './drafts';
import * as mail from './mail';

const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const addresses=value=>{try{return JSON.parse(value||'[]').map(v=>v.address||v).filter(Boolean);}catch{return[];}};
export async function prepare(c,userId,input,mode) {
  const value={...input};
  await mailbox(c,userId,value.accountId);
  if(mode==='reply'||mode==='forward') {
    const source=await mail.detail(c,userId,positive(input.emailId));
    if(source.trashedAt)throw new BizError('Restore the original message before replying or forwarding.',400);
    value.emailId=source.emailId;value.sendType=mode;
    value.subject=input.subject||`${mode==='reply'?'Re:':'Fwd:'} ${source.subject||''}`;
    if(mode==='reply' && !input.receiveEmail) {
      const own=new Set((await c.env.db.prepare('SELECT email FROM account WHERE user_id=?').bind(userId).all()).results.map(r=>r.email.toLowerCase()));
      const seen=new Set();const unique=list=>list.filter(a=>{const k=a.toLowerCase();if(own.has(k)||seen.has(k))return false;seen.add(k);return true;});
      const sender=source.type===1?addresses(source.recipient):[source.sendEmail];
      value.receiveEmail=unique([...sender,...(input.replyAll?addresses(source.recipient):[])]);
      value.cc=input.replyAll?unique(addresses(source.cc)):[];value.bcc=[];
    }
    let originalHTML=source.content||escape(source.text);
    for(const file of source.attList.filter(f=>f.contentId)) {
      const {object}=await mail.attachment(c,userId,file.attId);
      const data=`data:${file.mimeType};base64,${drafts.base64(await new Response(object.body||object).arrayBuffer())}`;
      originalHTML=originalHTML.replaceAll(`cid:${file.contentId.replace(/^<|>$/g,'')}`,data);
      // Stored image URLs end in an authorized attachment key. Replace only exact sources.
      const {document}=await import('linkedom').then(m=>m.parseHTML('<html><body>'+originalHTML+'</body></html>'));
      for(const image of document.querySelectorAll('img'))if((image.getAttribute('src')||'').endsWith(file.key))image.setAttribute('src',data);
      originalHTML=document.body.innerHTML;
    }
    if(mode==='forward') {
      const quote=`<blockquote><p>From: ${escape(source.sendEmail)}<br>Subject: ${escape(source.subject)}</p>${originalHTML}</blockquote>`;
      value.content=(input.content||`<div>${escape(input.text).replaceAll('\n','<br>')}</div>`)+quote;
      value.text=(input.text||'')+'\n\n'+(source.text||emailUtils.htmlToText(source.content));
      if(input.includeAttachments!==false) {
        value.attachments=[...(input.attachments||[])];
        for(const file of source.attList.filter(f=>!f.contentId)) {
          const {object}=await mail.attachment(c,userId,file.attId);
          value.attachments.push({filename:file.filename,content:drafts.base64(await new Response(object.body||object).arrayBuffer()),contentType:file.mimeType});
        }
      }
    }
  }
  value.content??=`<div>${escape(value.text).replaceAll('\n','<br>')}</div>`;
  return value;
}
function canonical(value) {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
export async function send(c,userId,input,{draftId,mode}={}) {
  await permission(c,userId,'email:send');
  const key=input.idempotencyKey;
  if(typeof key!=='string'||key.length<8||key.length>128)throw new BizError('Supply an idempotency key of 8 to 128 characters.',400);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical({draftId: draftId||null,mode:mode||null,input}))))),b=>b.toString(16).padStart(2,'0')).join('');
  const prior=await c.env.db.prepare('SELECT * FROM send_attempts WHERE user_id=? AND idempotency_key=?').bind(userId,key).first();
  if(prior) return replay(prior,hash);
  let draft,payload;
  if(draftId) {
    draft=await drafts.get(c,userId,positive(draftId));
    if(input.version!==draft.version||draft.state!=='draft')throw conflict(draft);
    payload=await drafts.payload(c,userId,draft);
  } else payload=await prepare(c,userId,input,mode);
  // The unique attempt and draft claim are committed together, before any delivery can occur.
  const statements=[c.env.db.prepare(`INSERT OR IGNORE INTO send_attempts(user_id,idempotency_key,request_hash,draft_id,state)
    SELECT ?,?,?,?,'prepared' ${draft?"WHERE EXISTS(SELECT 1 FROM cloud_drafts WHERE user_id=? AND draft_id=? AND version=? AND state='draft')":''}`)
    .bind(userId,key,hash,draft?.draftId||null,...(draft?[userId,draft.draftId,draft.version]:[]))];
  if(draft)statements.push(c.env.db.prepare(`UPDATE cloud_drafts SET state='sending',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_id=? AND version=? AND state='draft'
    AND EXISTS(SELECT 1 FROM send_attempts WHERE user_id=? AND idempotency_key=? AND request_hash=?)`).bind(userId,draft.draftId,draft.version,userId,key,hash));
  await c.env.db.batch(statements);
  const attempt=await c.env.db.prepare("UPDATE send_attempts SET state='dispatching' WHERE user_id=? AND idempotency_key=? AND state='prepared' AND request_hash=? RETURNING *").bind(userId,key,hash).first();
  if(!attempt) {
    const existing=await c.env.db.prepare('SELECT * FROM send_attempts WHERE user_id=? AND idempotency_key=?').bind(userId,key).first();
    if(existing)return replay(existing,hash);
    throw conflict(await drafts.get(c,userId,draft.draftId,true));
  }
  let dispatched=false;
  try {
    const messages=await emailService.send(c,payload,userId,{beforeDispatch:()=>{dispatched=true;}});
    const result={state:'sent',attemptId:key,messages};
    await c.env.db.batch([
      c.env.db.prepare("UPDATE send_attempts SET state='sent',result=? WHERE user_id=? AND idempotency_key=?").bind(JSON.stringify(result),userId,key),
      ...(draft?[c.env.db.prepare("UPDATE cloud_drafts SET state='sent',data='{}',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_id=?").bind(userId,draft.draftId)]:[])
    ]);
    if(draft)await drafts.cleanFiles(c,userId,draft.draftId);
    console.log(JSON.stringify({event:'send_attempt',attemptId:key,userId,state:'sent'}));
    return result;
  } catch(error) {
    // Known preflight/provider rejections are safe; network/unknown errors may follow delivery.
    const known=!dispatched || error.definitelyRejected===true;
    const state=known?'failed':'uncertain';
    const result={state,attemptId:key,message:known?error.message:'Delivery may have occurred. Check Sent and provider activity before sending another copy.'};
    await c.env.db.batch([
      c.env.db.prepare('UPDATE send_attempts SET state=?,result=? WHERE user_id=? AND idempotency_key=?').bind(state,JSON.stringify(result),userId,key),
      ...(draft?[c.env.db.prepare('UPDATE cloud_drafts SET state=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_id=?').bind(known?'draft':'uncertain',userId,draft.draftId)]:[])
    ]);
    console.log(JSON.stringify({event:'send_attempt',attemptId:key,userId,state}));
    return result;
  }
}
function replay(row,hash) {
  if(row.request_hash!==hash)throw new BizError('This idempotency key was already used for different content.',409);
  return row.result?JSON.parse(row.result):{state:'uncertain',attemptId:row.idempotency_key,message:'This send was started. Check Sent and provider activity; it will not be automatically repeated.'};
}
