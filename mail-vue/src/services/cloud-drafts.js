import { draftSummary, newestDraft } from '@/utils/draft-summary';
import { useUserStore } from '@/store/user';
import db from '@/db/db.js';
import http from '@/axios/index.js';
import { userDraftStore } from '@/store/draft.js';
function sessionAPI(database) {
  const token=localStorage.getItem('token');
  const check=()=>{if(db.value!==database||localStorage.getItem('token')!==token)throw new Error('The signed-in user changed. Draft synchronization stopped.');};
  const call=async(method,path,payload,options={})=>{
    check();const config={...options,headers:{...options.headers,Authorization:token||''}};
    const result=await (['get','delete'].includes(method)?http[method](path,config):http[method](path,payload,config));check();return result;
  };
  return {get:(path,options)=>call('get',path,null,options),delete:(path,options)=>call('delete',path,null,options),post:(path,payload,options)=>call('post',path,payload,options),put:(path,payload,options)=>call('put',path,payload,options)};
}
const locks=new WeakMap();
const apiError=e=>e.response?.data||e;
const fingerprint=row=>JSON.stringify([row.accountId,row.subject,row.content,row.text,row.receiveEmail,row.cc,row.bcc,(row.attachments||[]).map(f=>[f.filename,f.contentType||f.mimeType,String(f.content||'').replace(/^data:[^,]*;base64,/,''),f.contentId||'']).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),row.sendType,row.emailId]);
async function signature(row) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint(row)))),b=>b.toString(16).padStart(2,'0')).join('');}
const strip=row=>{const copy={...row};for(const key of ['draftId','cloudDraftId','cloudVersion','dirty','clientId','syncState','localRevision','sendAttemptId','sendFingerprint','ownerEmail','editToken','conflictCopy','attachments'])delete copy[key];return copy;};
async function withFiles(database,row) {return {...row,attachments:(await database.att.get(row.draftId))?.attachments||[]};}
async function put(database,row,attachments) {
  const {attachments:ignored,...metadata}=row;
  await database.transaction('rw',database.draft,database.att,async()=>{await database.draft.put(metadata);await database.att.put({draftId:row.draftId,attachments});});
}
async function cloudRow(database,remote,localId,api) {
  let row=localId?await database.draft.get(localId):null;
  const attachments=[];
  for(const f of remote.attachments||[]) {
    const response=await api.get(`/v1/drafts/attachments/${f.attachmentId}/content`,{responseType:'blob',noMsg:true});
    const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(response);});
    attachments.push({...f,content,contentType:f.mimeType});
  }
  let content=remote.content||'';
  for(const f of attachments.filter(f=>f.contentId))content=content.replaceAll(`cid:${f.contentId.replace(/^<|>$/g,'')}`,f.content);
  const value={...remote,...(remote.ui||{}),content,attachments,draftId:row?.draftId,cloudDraftId:remote.draftId,cloudVersion:remote.version,dirty:false,sendAttemptId:row?.sendAttemptId,sendFingerprint:row?.sendFingerprint,syncState:remote.state==='draft'?'saved':remote.state};
  if(!value.draftId) {delete value.draftId;value.draftId=await database.draft.add({...value,attachments:undefined});}
  await put(database,value,attachments);return value;
}
export async function saveLocalDraft(input) {
  const database=db.value;
  if(input.ownerEmail&&input.ownerEmail!==useUserStore().user.email)throw new Error('The signed-in user changed. Your previous draft was not moved.');
  const current=input.draftId?await database.draft.get(input.draftId):null;
  const row={...input,updatedAt:new Date().toISOString(),sendAttemptId:current?.sendAttemptId,sendFingerprint:current?.sendFingerprint,clientId:current?.clientId||input.clientId||crypto.randomUUID(),dirty:true,editToken:crypto.randomUUID(),syncState:navigator.onLine?'saving':'offline',localRevision:(current?.localRevision||0)+1};
  // Retain the revision the composer actually edited; stale editors must conflict on the server.
  row.cloudVersion=input.cloudVersion??current?.cloudVersion;
  row.cloudDraftId=input.cloudDraftId??current?.cloudDraftId;
  if(!row.draftId) {delete row.draftId;row.draftId=await database.draft.add({...row,attachments:undefined});}
  await put(database,row,input.attachments||[]);
  if (db.value === database) {
    const store=userDraftStore();
    store.items=[draftSummary(row), ...store.items.filter(item=>item.draftId!==row.draftId)].sort(newestDraft);
  }
  return row;
}
async function push(database,row,api) {
  const value=await withFiles(database,row),version=row.localRevision;
  try {
    // IDs belong to a particular cloud draft; send binary data when importing a conflict copy.
    const attachments=value.attachments.map(({attachmentId,...f})=>f);
    const payload={...strip(value),accountId:value.accountId,clientId:value.clientId,version:value.cloudVersion,attachments,ui:{inlineReply:value.inlineReply||false,replyRecipientNames:value.replyRecipientNames||{},localRevision:value.localRevision,editToken:value.editToken}};
    let remote=await (row.cloudDraftId?api.put(`/v1/drafts/${row.cloudDraftId}`,payload,{noMsg:true}):api.post('/v1/drafts',payload,{noMsg:true}));
    if(!row.cloudDraftId && remote.state==='draft' && remote.ui?.editToken!==value.editToken)throw {code:409,current:remote};
    const latest=await database.draft.get(row.draftId);if(!latest)return;
    if(['deleted','sent'].includes(remote.state)) {
      if(latest.localRevision!==version)throw {code:409,current:remote};
      await database.draft.delete(row.draftId);await database.att.delete(row.draftId);return;
    }
    await database.draft.put({...latest,cloudDraftId:remote.draftId,cloudVersion:remote.version,updatedAt:latest.localRevision===version ? (remote.updatedAt || latest.updatedAt) : latest.updatedAt,dirty:latest.localRevision!==version,syncState:latest.localRevision===version?(latest.conflictCopy?'conflict':'saved'):'saving'});
  } catch(raw) {
    const error=apiError(raw);
    if(error.code===409||(error.code===404&&row.cloudDraftId)) {
      const current=await database.draft.get(row.draftId);if(!current)return;
      const {draftId,cloudDraftId,cloudVersion,...copy}=await withFiles(database,current);
      const newRow={...copy,clientId:crypto.randomUUID(),editToken:crypto.randomUUID(),subject:copy.subject||'',syncState:'conflict',conflictCopy:true,dirty:true};
      newRow.draftId=await database.draft.add({...newRow,attachments:undefined});await put(database,newRow,newRow.attachments||[]);
      if(error.current?.state==='draft')await cloudRow(database,error.current,row.draftId,api);
      else {await database.draft.delete(row.draftId);await database.att.delete(row.draftId);}
      return {forkId:newRow.draftId};
    }
    const latest=await database.draft.get(row.draftId);
    if(latest)await database.draft.put({...latest,syncState:'offline'});
    throw raw;
  }
}
export function syncCloudDrafts() {
  const database=db.value;
  if(locks.has(database))return locks.get(database);
  const api=sessionAPI(database);
  const task=(async()=>{
    const conflicts={};
    if(!navigator.onLine)return {conflicts};
    for(const row of await database.draft.toArray()) {
      if(row.deleted) {
        if(row.cloudDraftId) {try {await api.delete(`/v1/drafts/${row.cloudDraftId}`,{params:{version:row.cloudVersion},noMsg:true});}catch(e){const error=apiError(e);if(error.code===409){await database.draft.put({...row,deleted:false,syncState:'conflict'});if(error.current)await cloudRow(database,error.current,row.draftId,api);throw e;}if(error.code!==404)throw e;}}
        await database.draft.delete(row.draftId);await database.att.delete(row.draftId);continue;
      }
      // Pre-cloud rows have no dirty flag: adopt them with a persisted import UUID first.
      if(!row.cloudDraftId&&!row.clientId) {row.clientId=crypto.randomUUID();row.editToken=crypto.randomUUID();row.dirty=true;await database.draft.put(row);}
      if(row.dirty){const result=await push(database,row,api);if(result?.forkId)conflicts[row.draftId]=result.forkId;}
    }
    // Replay a separate durable cursor, independent of the mailbox synchronization cursor.
    let cursor=(await database.meta.get('draftCursor'))?.value||0,more=true;
    while(more) {
      const page=await api.get('/v1/drafts/changes',{params:{after:cursor,limit:100},noMsg:true});
      for(const event of page.changes) {
        const local=(await database.draft.toArray()).find(r=>r.cloudDraftId===event.draftId);
        if(local?.dirty)continue; // Keep the cursor behind pending edits: next push handles any conflict.
        if(event.operation==='delete') {if(local){await database.draft.delete(local.draftId);await database.att.delete(local.draftId);}}
        else if(!local||local.cloudVersion!==event.draft.version)await cloudRow(database,event.draft,local?.draftId,api);
      }
      cursor=page.cursor;await database.meta.put({key:'draftCursor',value:cursor});more=page.hasMore;
    }
    userDraftStore().refreshList++;return {conflicts};
  })().finally(()=>locks.delete(database));
  locks.set(database,task);return task;
}
export async function removeLocalDraft(id,{sent=false,database:providedDatabase}={}) {
  const database=providedDatabase||db.value,row=await database.draft.get(id);if(!row)return;
  if(sent||!row.cloudDraftId) {await database.draft.delete(id);await database.att.delete(id);}
  else {await database.draft.put({...row,deleted:true,dirty:false});await syncCloudDrafts();}
  userDraftStore().refreshList++;
}
export async function sendCloudDraft(id) {
  const database=db.value,api=sessionAPI(database);
  const before=await database.draft.get(id);
  if(before?.sendAttemptId) {
    const attempt=await api.get(`/v1/send-attempts/${before.sendAttemptId}`,{noMsg:true});
    if(attempt.state==='sent'){
      if(before.sendFingerprint && await signature(await withFiles(database,before))!==before.sendFingerprint) {
        const {draftId,cloudDraftId,cloudVersion,sendAttemptId,sendFingerprint,...copy}=await withFiles(database,before);
        const newRow={...copy,clientId:crypto.randomUUID(),editToken:crypto.randomUUID(),dirty:true,conflictCopy:true,syncState:'conflict'};
        newRow.draftId=await database.draft.add({...newRow,attachments:undefined});await put(database,newRow,newRow.attachments||[]);
        await removeLocalDraft(id,{sent:true,database});throw new Error('The original message was sent. Your newer edits are preserved in a separate draft.');
      }
      await removeLocalDraft(id,{sent:true,database});return attempt.messages;
    }
    if(attempt.state==='uncertain')throw new Error(attempt.message||'Delivery is uncertain. Check Sent before sending another copy.');
    if(attempt.state==='failed')await database.draft.put({...before,sendAttemptId:null});
  }
  const synced=await syncCloudDrafts();if(synced?.conflicts?.[id])throw new Error('Both versions were saved in Drafts. Review the saved copy before sending.');const row=await database.draft.get(id);
  if(!row||row.dirty||!row.cloudDraftId)throw new Error('Your edits were preserved in Drafts. Open the saved draft before sending.');
  const sendAttemptId=row.sendAttemptId||crypto.randomUUID();await database.draft.put({...row,sendAttemptId,sendFingerprint:await signature(await withFiles(database,row)),syncState:'sending'});
  const result=await api.post(`/v1/drafts/${row.cloudDraftId}/send`,{version:row.cloudVersion,idempotencyKey:sendAttemptId},{noMsg:true});
  if(result.state!=='sent') {
    const current=await api.get(`/v1/drafts/${row.cloudDraftId}`,{noMsg:true});
    await database.draft.put({...row,cloudVersion:current.version,sendAttemptId:result.state==='failed'?null:sendAttemptId,syncState:result.state});
    throw new Error(result.message||'Delivery is uncertain. Check Sent before sending another copy.');
  }
  await removeLocalDraft(id,{sent:true,database});return result.messages;
}
export function startDraftSync() {
  const sync=()=>{if(document.visibilityState!=='hidden')syncCloudDrafts().catch(()=>{});};
  sync();const timer=setInterval(sync,60000);window.addEventListener('online',sync);document.addEventListener('visibilitychange',sync);
  return ()=>{clearInterval(timer);window.removeEventListener('online',sync);document.removeEventListener('visibilitychange',sync);};
}
