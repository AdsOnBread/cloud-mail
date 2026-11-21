import {readGeneralSettings} from './general-settings';
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
    if(source.scheduledDraftId)throw new BizError('Restore this unsent message to Drafts to edit it.',400);
    value.emailId=source.emailId;value.sendType=mode;
    value.subject=input.subject??`${mode==='reply'?'Re:':'Fwd:'} ${source.subject||''}`;
    const defaultRecipients = input.receiveEmail === undefined &&
      [input.cc,input.bcc].every(list => list === undefined || (Array.isArray(list) && list.length === 0));
    if(mode==='reply' && defaultRecipients) {
      const own=new Set((await c.env.db.prepare('SELECT email FROM account WHERE user_id=?').bind(userId).all()).results.map(r=>r.email.toLowerCase()));
      const seen=new Set();const unique=list=>list.filter(a=>{const k=a.toLowerCase();if(own.has(k)||seen.has(k))return false;seen.add(k);return true;});
      const sender=source.type===1?addresses(source.recipient):[source.sendEmail];
      value.receiveEmail=unique([...sender,...(input.replyAll?addresses(source.recipient):[])]);
      const copyOnly = source.type === 1 && sender.length === 0;
      const cc = addresses(source.cc);
      value.cc = input.replyAll || copyOnly ? unique(cc) : [];
      value.bcc = copyOnly && !cc.length && input.reuseBlindRecipients === true ? unique(addresses(source.bcc)) : [];
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
export async function send(c,userId,input,{draftId,mode,scheduled=false}={}) {
  await permission(c,userId,'email:send');
  const key=input.idempotencyKey;
  if(!scheduled && typeof key==='string' && key.startsWith('cloudmail.schedule/'))throw new BizError('Choose another idempotency key.',400);
  if(typeof key!=='string'||key.length<8||key.length>128)throw new BizError('Supply an idempotency key of 8 to 128 characters.',400);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical({draftId: draftId||null,mode:mode||null,input}))))),b=>b.toString(16).padStart(2,'0')).join('');
  const prior=await c.env.db.prepare('SELECT * FROM send_attempts WHERE user_id=? AND idempotency_key=?').bind(userId,key).first();
  if(prior) return replay(prior,hash);
  const undoSeconds = input.undoSeconds;
  if (undoSeconds !== undefined && (!draftId || scheduled || ![5, 10, 20, 30].includes(undoSeconds)))
    throw new BizError('Choose a supported cancellation period.', 400);
  const sourceState=scheduled?'scheduled':'draft';
  let draft,payload;
  if(draftId) {
    draft=await drafts.get(c,userId,positive(draftId),scheduled);
    if(input.version!==draft.version||draft.state!==sourceState)throw conflict(draft);
    if (!undoSeconds) payload=await drafts.payload(c,userId,draft);
  } else payload=await prepare(c,userId,input,mode);
  const holdSeconds = undoSeconds && ((await readGeneralSettings(c.env.db, userId)).undoSeconds ?? undoSeconds);
  const hold = holdSeconds ? {state:'holding', attemptId:key, draftId:draft.draftId,
    version:draft.version + 1, undoUntil:Date.now() + holdSeconds * 1000} : null;
  // Keep the durable receipt and the exact draft revision in the same transaction.
  const statements=[c.env.db.prepare(`INSERT OR IGNORE INTO send_attempts(user_id,idempotency_key,request_hash,draft_id,state,result)
    SELECT ?,?,?,?,?,? ${draft?"WHERE EXISTS(SELECT 1 FROM cloud_drafts WHERE user_id=? AND draft_id=? AND version=? AND state=?)":''}`)
    .bind(userId,key,hash,draft?.draftId||null,hold?'holding':'prepared',hold?JSON.stringify(hold):null,...(draft?[userId,draft.draftId,draft.version,sourceState]:[]))];
  if(draft)statements.push(c.env.db.prepare(`UPDATE cloud_drafts SET state='sending',version=version+1,updated_at=CURRENT_TIMESTAMP,
    data=CASE WHEN ? THEN json_set(data,'$.undoSendKey',?) ELSE data END WHERE user_id=? AND draft_id=? AND version=? AND state=?
    AND EXISTS(SELECT 1 FROM send_attempts WHERE user_id=? AND idempotency_key=? AND request_hash=?)`)
    .bind(hold?1:0,key,userId,draft.draftId,draft.version,sourceState,userId,key,hash));
  await c.env.db.batch(statements);
  if (hold) {
    const receipt = await c.env.db.prepare('SELECT * FROM send_attempts WHERE user_id=? AND idempotency_key=?').bind(userId,key).first();
    if (receipt) return replay(receipt,hash);
    throw conflict(await drafts.get(c,userId,draft.draftId,true));
  }
  const attempt=await c.env.db.prepare("UPDATE send_attempts SET state='dispatching' WHERE user_id=? AND idempotency_key=? AND state='prepared' AND request_hash=? RETURNING *").bind(userId,key,hash).first();
  if(!attempt) {
    const existing=await c.env.db.prepare('SELECT * FROM send_attempts WHERE user_id=? AND idempotency_key=?').bind(userId,key).first();
    if(existing)return replay(existing,hash);
    throw conflict(await drafts.get(c,userId,draft.draftId,true));
  }
  return dispatch(c,userId,key,draft,scheduled,async () => payload);
}

async function dispatch(c,userId,key,draft,scheduled,loadPayload,claim) {
  let dispatched=false;
  try {
    const payload = await loadPayload();
    const messages=await emailService.send(c,payload,userId,{beforeDispatch:async ()=>{
      if (claim && !await claim()) throw new Error('Another request completed this preparation.');
      dispatched=true;
    }});
    const result={state:'sent',attemptId:key,messages};
    const filing = [];
    if (draft) {
      // The queue claim fences further edits. Read the choices committed before that claim.
      const sender = `FROM cloud_drafts d JOIN email e ON e.user_id=d.user_id AND e.account_id=d.account_id
        WHERE d.user_id=? AND d.draft_id=? AND d.state='sending' AND e.email_id=? AND e.type=1`;
      const ids = [userId,draft.draftId,messages[0].emailId];
      if (scheduled) {
        // Commit placement with the send receipt. Normal mailbox indexing resolves its conversation.
        filing.push(c.env.db.prepare(`INSERT OR IGNORE INTO scheduled_inbox_deliveries(user_id,email_id,wake_at)
          SELECT d.user_id,e.email_id,coalesce(json_extract(d.data,'$.scheduledWakeAt'),0) ${sender} AND json_extract(d.data,'$.scheduledInbox')=1`).bind(...ids));
      }
      if (scheduled || draft.labelIds?.length) {
        filing.push(c.env.db.prepare(`INSERT OR IGNORE INTO mailbox_label_members(user_id,label_id,email_id)
          SELECT d.user_id,l.label_id,e.email_id FROM cloud_drafts d
          JOIN email e ON e.user_id=d.user_id AND e.account_id=d.account_id
          JOIN mailbox_labels l ON l.user_id=d.user_id AND l.label_id IN (SELECT value FROM json_each(d.data,'$.labelIds'))
          WHERE d.user_id=? AND d.draft_id=? AND d.state='sending' AND e.email_id=? AND e.type=1`).bind(...ids));
      }
      filing.push(
        c.env.db.prepare(`INSERT INTO star(user_id,email_id) SELECT d.user_id,e.email_id ${sender}
          AND json_extract(d.data,'$.mailboxStarred')=1
          AND NOT EXISTS (SELECT 1 FROM star s WHERE s.user_id=d.user_id AND s.email_id=e.email_id)`).bind(...ids),
        c.env.db.prepare(`INSERT OR REPLACE INTO mailbox_importance(user_id,email_id,important)
          SELECT d.user_id,e.email_id,json_extract(d.data,'$.mailboxImportant') ${sender}
          AND json_extract(d.data,'$.mailboxImportant') IS NOT NULL`).bind(...ids)
      );
    }
    await c.env.db.batch([
      ...filing,
      c.env.db.prepare("UPDATE send_attempts SET state='sent',result=? WHERE user_id=? AND idempotency_key=?").bind(JSON.stringify(result),userId,key),
      ...(draft?[c.env.db.prepare("UPDATE cloud_drafts SET state='sent',data='{}',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_id=?").bind(userId,draft.draftId)]:[])
    ]);
    if(draft)await drafts.cleanFiles(c,userId,draft.draftId).catch(()=>console.warn('sent_draft_cleanup_failed'));
    console.log(JSON.stringify({event:'send_attempt',attemptId:key,userId,state:'sent'}));
    return result;
  } catch(error) {
    // Competing or interrupted preparations never own delivery. Only the caller
    // that wins the same atomic claim may record a definitive preflight failure.
    if (claim && !dispatched && !await claim()) return;
    // Known preflight/provider rejections are safe; network/unknown errors may follow delivery.
    const known=!dispatched || error.definitelyRejected===true;
    const state=known?'failed':'uncertain';
    const result={state,attemptId:key,message:known?error.message:'Delivery may have occurred. Check Sent and provider activity before sending another copy.'};
    await c.env.db.batch([
      c.env.db.prepare('UPDATE send_attempts SET state=?,result=? WHERE user_id=? AND idempotency_key=?').bind(state,JSON.stringify(result),userId,key),
      ...(draft?[c.env.db.prepare(`UPDATE cloud_drafts SET state=?,data=CASE WHEN ? THEN json_set(data,'$.scheduleError',?) WHEN json_extract(data,'$.undoSendKey') IS NOT NULL THEN json_set(json_remove(data,'$.undoSendKey'),'$.deliveryError',?) ELSE data END,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_id=? AND state='sending'`).bind(known?(scheduled?'schedule_failed':'draft'):'uncertain',scheduled?1:0,result.message,result.message,userId,draft.draftId)]:[])
    ]);
    console.log(JSON.stringify({event:'send_attempt',attemptId:key,userId,state}));
    return result;
  }
}
function replay(row,hash) {
  if(row.request_hash!==hash)throw new BizError('This idempotency key was already used for different content.',409);
  return row.result?JSON.parse(row.result):{state:'uncertain',attemptId:row.idempotency_key,message:'This send was started. Check Sent and provider activity; it will not be automatically repeated.'};
}

// Both the request's background task and the minute timer may wake up for a
// message. Only the caller that claims the held receipt may contact the provider.
export async function dispatchHeld(c,userId,key) {
  const due="user_id=? AND idempotency_key=? AND state='holding' AND json_extract(result,'$.undoUntil')<=?";
  const attempt=await c.env.db.prepare('SELECT draft_id FROM send_attempts WHERE '+due).bind(userId,key,Date.now()).first();
  if (!attempt) return;
  const draft={draftId:attempt.draft_id};
  const claim=()=>c.env.db.prepare("UPDATE send_attempts SET state='dispatching',result=? WHERE "+due+" RETURNING draft_id")
    .bind(JSON.stringify({state:'sending',attemptId:key,startedAt:Date.now()}),userId,key,Date.now()).first();
  return dispatch(c,userId,key,draft,false,async () => {
    await permission(c,userId,'email:send');
    Object.assign(draft,await drafts.get(c,userId,draft.draftId,true));
    if (draft.state !== 'sending' || draft.undoSendKey !== key) throw new BizError('This delivery changed.',409);
    return drafts.payload(c,userId,draft);
  },claim);
}

export async function recoverHeld(c) {
  // A terminated request after the provider fence is ambiguous. Surface it
  // for inspection without dispatching again, even if the browser never returns.
  const db=c.env.db, cutoff=Date.now()-15*60000;
  const stale=await db.prepare(`SELECT d.user_id,d.draft_id,a.idempotency_key FROM cloud_drafts d
    JOIN send_attempts a ON a.user_id=d.user_id AND a.idempotency_key=json_extract(d.data,'$.undoSendKey')
    WHERE d.state='sending' AND a.state='dispatching' AND json_extract(a.result,'$.startedAt')<? LIMIT 20`).bind(cutoff).all();
  for (const row of stale.results) {
    const receipt={state:'uncertain',attemptId:row.idempotency_key,message:'Delivery could not be confirmed. Check Sent before sending another copy.'};
    await db.batch([
      db.prepare("UPDATE send_attempts SET state='uncertain',result=? WHERE user_id=? AND idempotency_key=? AND state='dispatching'")
        .bind(JSON.stringify(receipt),row.user_id,row.idempotency_key),
      db.prepare(`UPDATE cloud_drafts SET state='uncertain',data=json_set(json_remove(data,'$.undoSendKey'),'$.deliveryError',?),
        version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_id=? AND state='sending' AND json_extract(data,'$.undoSendKey')=?`)
        .bind(receipt.message,row.user_id,row.draft_id,row.idempotency_key),
    ]);
  }
  const {results} = await c.env.db.prepare(`SELECT d.user_id, a.idempotency_key FROM cloud_drafts d
    JOIN send_attempts a ON a.user_id=d.user_id AND a.idempotency_key=json_extract(d.data,'$.undoSendKey')
    WHERE d.state='sending' AND a.state='holding' AND json_extract(a.result,'$.undoUntil')<=?
    ORDER BY d.updated_at LIMIT 20`).bind(Date.now()).all();
  for (const row of results) await dispatchHeld(c,row.user_id,row.idempotency_key);
}

export async function undoSend(c,userId,key) {
  const now = Date.now();
  const db = c.env.db;
  await db.batch([
    db.prepare(`UPDATE send_attempts SET state='canceled',result=json_set(result,'$.state','canceled')
      WHERE user_id=? AND idempotency_key=? AND state='holding' AND json_extract(result,'$.undoUntil')>?`).bind(userId,key,now),
    db.prepare(`UPDATE cloud_drafts SET state='draft',data=json_remove(data,'$.undoSendKey'),version=version+1,updated_at=CURRENT_TIMESTAMP
      WHERE user_id=? AND state='sending' AND json_extract(data,'$.undoSendKey')=? AND draft_id=(
        SELECT draft_id FROM send_attempts WHERE user_id=? AND idempotency_key=? AND state='canceled')`).bind(userId,key,userId,key),
  ]);
  const receipt = await db.prepare('SELECT result,state FROM send_attempts WHERE user_id=? AND idempotency_key=?').bind(userId,key).first();
  if (!receipt || receipt.state !== 'canceled') throw new BizError('The cancellation period has ended. Check Sent for this message.',409);
  return JSON.parse(receipt.result);
}
