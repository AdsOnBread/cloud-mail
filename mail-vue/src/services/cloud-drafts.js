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
const strip=row=>{const copy={...row};for(const key of ['draftId','cloudDraftId','cloudVersion','dirty','clientId','syncState','localRevision','sendAttemptId','sendFingerprint','pendingSchedule','schedulingError','ownerEmail','editToken','conflictCopy','hasFiles','attachments'])delete copy[key];return copy;};
async function withFiles(database,row) {return {...row,attachments:(await database.att.get(row.draftId))?.attachments||[]};}
async function put(database,row,attachments) {
  const {attachments:ignored,...metadata}=row;
  metadata.hasFiles=attachments.some(file=>!file.contentId);
  await database.transaction('rw',database.draft,database.att,async()=>{await database.draft.put(metadata);await database.att.put({draftId:row.draftId,attachments});});
}
// Called inside a draft/attachment transaction so an interrupted save cannot leave a partial draft.
async function writeDraft(database, row) {
  const {attachments = [], ...metadata} = row;
  metadata.hasFiles=attachments.some(file=>!file.contentId);
  if (row.draftId) await database.draft.put(metadata);
  else {
    delete metadata.draftId;
    row.draftId = await database.draft.add(metadata);
  }
  await database.att.put({draftId:row.draftId, attachments});
  return row;
}
async function downloadDraft(remote, api) {
  const attachments=[];
  for(const f of remote.attachments||[]) {
    const response=await api.get(`/v1/drafts/attachments/${f.attachmentId}/content`,{responseType:'blob',noMsg:true});
    const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(response);});
    attachments.push({...f,content,contentType:f.mimeType});
  }
  let content=remote.content||'';
  for(const f of attachments.filter(f=>f.contentId))content=content.replaceAll(`cid:${f.contentId.replace(/^<|>$/g,'')}`,f.content);
  return {...remote, ...(remote.ui || {}), content, attachments, draftId:undefined,
    cloudDraftId:remote.draftId, cloudVersion:remote.version, dirty:false,
    syncState:remote.state === 'draft' ? 'saved' : remote.state};
}
async function cloudRow(database, remote, localId, api) {
  const value = await downloadDraft(remote, api);
  await database.transaction('rw', database.draft, database.att, async () => {
    const current = localId ? await database.draft.get(localId) : null;
    if (localId && (!current || current.dirty || current.deleted || current.pendingSchedule || current.cloudVersion >= remote.version)) return;
    await writeDraft(database, {...value, draftId:localId, sendAttemptId:current?.sendAttemptId, sendFingerprint:current?.sendFingerprint});
  });
}
export async function saveLocalDraft(input) {
  const database=db.value;
  if(input.ownerEmail&&input.ownerEmail!==useUserStore().user.email)throw new Error('The signed-in user changed. Your previous draft was not moved.');
  const row = await database.transaction('rw', database.draft, database.att, async () => {
    const current = input.draftId ? await database.draft.get(input.draftId) : null;
    if(current?.pendingSchedule || (!current && input.cloudDraftId && input.draftId))throw new Error('This draft has changed. Check Scheduled or reopen it from Drafts.');
    // A background upload can advance the cloud version of precisely the edit still in the composer.
    // A different edit token means the editor must keep its own base version for conflict detection.
    const sameEdit = current && input.editToken && input.editToken === current.editToken;
    return writeDraft(database, {
      ...input, updatedAt:new Date().toISOString(), dirty:true, editToken:crypto.randomUUID(),
      clientId:current?.clientId || input.clientId || crypto.randomUUID(),
      cloudVersion:sameEdit ? current.cloudVersion : input.cloudVersion ?? current?.cloudVersion,
      cloudDraftId:sameEdit ? current.cloudDraftId : input.cloudDraftId ?? current?.cloudDraftId,
      conflictCopy:current?.conflictCopy, sendAttemptId:current?.sendAttemptId, sendFingerprint:current?.sendFingerprint,
      syncState:navigator.onLine ? 'saving' : 'offline', localRevision:(current?.localRevision || 0) + 1,
    });
  });
  if (db.value === database) {
    const store=userDraftStore();
    store.items=[draftSummary(row), ...store.items.filter(item=>item.draftId!==row.draftId)].sort(newestDraft);
  }
  return row;
}
async function push(database,row,api) {
  const value=await withFiles(database,row);
  try {
    // IDs belong to a particular cloud draft; send binary data when importing a conflict copy.
    const attachments=value.attachments.map(({attachmentId,...f})=>f);
    const payload={...strip(value),accountId:value.accountId,clientId:value.clientId,version:value.cloudVersion,attachments,ui:{inlineReply:value.inlineReply||false,replyRecipientNames:value.replyRecipientNames||{},localRevision:value.localRevision,editToken:value.editToken}};
    let remote=await (row.cloudDraftId?api.put(`/v1/drafts/${row.cloudDraftId}`,payload,{noMsg:true}):api.post('/v1/drafts',payload,{noMsg:true}));
    if(!row.cloudDraftId && remote.state==='draft' && remote.ui?.editToken!==value.editToken)throw {code:409,current:remote};
    await database.transaction('rw', database.draft, database.att, async () => {
      const latest = await database.draft.get(row.draftId);
      if (!latest) return;
      const acknowledged = latest.editToken === row.editToken;
      if (['deleted','sent'].includes(remote.state)) {
        if (!acknowledged) throw {code:409, current:remote};
        await database.draft.delete(row.draftId);
        await database.att.delete(row.draftId);
        return;
      }
      await database.draft.put({...latest, cloudDraftId:remote.draftId, cloudVersion:remote.version,
        updatedAt:acknowledged ? remote.updatedAt || latest.updatedAt : latest.updatedAt,
        dirty:!acknowledged, syncState:acknowledged ? (latest.conflictCopy ? 'conflict' : 'saved') : 'saving'});
    });
  } catch(raw) {
    const error=apiError(raw);
    if(error.code===409||(error.code===404&&row.cloudDraftId)) {
      const other = error.current?.state === 'draft' ? await downloadDraft(error.current, api) : null;
      return database.transaction('rw', database.draft, database.att, async () => {
        const current = await database.draft.get(row.draftId);
        if (!current) return;
        // Keep the open editor attached to its local copy, including any edits made during the upload.
        const {cloudDraftId, cloudVersion, sendAttemptId, sendFingerprint, ...copy} = current;
        await database.draft.put({...copy, clientId:crypto.randomUUID(), syncState:'conflict', conflictCopy:true, dirty:true});
        if (other) await writeDraft(database, other);
        return {forkId:row.draftId};
      });
    }
    await database.transaction('rw', database.draft, async () => {
      const latest = await database.draft.get(row.draftId);
      if (latest) await database.draft.put({...latest, syncState:'offline'});
    });
    throw raw;
  }
}
export function syncCloudDrafts() {
  const database=db.value;
  if(locks.has(database))return locks.get(database);
  const api=sessionAPI(database);
  const sync=async()=>{
    const conflicts={};
    if(!navigator.onLine)return {conflicts};
    for(const row of await database.draft.toArray()) {
      if(row.pendingSchedule) {
        await reconcileSchedule(database,api,row);
        continue;
      }
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
        if(local?.dirty || local?.pendingSchedule)continue; // The local revision is reconciled before subsequent changes.
        if(event.operation==='delete') {
          if(local)await database.transaction('rw',database.draft,database.att,async()=>{
            const latest=await database.draft.get(local.draftId);
            if(!latest || latest.pendingSchedule || latest.dirty || latest.cloudVersion!==local.cloudVersion)return;
            await database.draft.delete(local.draftId);await database.att.delete(local.draftId);
          });
        }
        else if(!local||local.cloudVersion!==event.draft.version)await cloudRow(database,event.draft,local?.draftId,api);
      }
      cursor=page.cursor;await database.meta.put({key:'draftCursor',value:cursor});more=page.hasMore;
    }
    userDraftStore().refreshList++;return {conflicts};
  };
  // Tabs share IndexedDB. Only one should upload edits and import cloud changes at a time.
  const task = (navigator.locks ? navigator.locks.request('cloudmail-draft-sync:' + database.name, sync) : sync())
    .finally(() => locks.delete(database));
  locks.set(database,task);return task;
}
export async function removeLocalDraft(id,{sent=false,database:providedDatabase}={}) {
  const database=providedDatabase||db.value,row=await database.draft.get(id);if(!row)return;
  if(row.pendingSchedule)throw new Error('Wait for scheduling confirmation before discarding this draft.');
  if(sent||!row.cloudDraftId) {await database.draft.delete(id);await database.att.delete(id);}
  else {await database.draft.put({...row,deleted:true,dirty:false});await syncCloudDrafts();}
  userDraftStore().refreshList++;
}
async function reconcileSchedule(database,api,row) {
  const {sendAt,version}=row.pendingSchedule;
  const path=`/v1/drafts/${row.cloudDraftId}/schedule`;
  try {
    await api.post(path,{version,sendAt},{noMsg:true});
  } catch(raw) {
    const err=apiError(raw), code=Number(err.code);
    // The server returns its current revision on conflict, including a completed send.
    const accepted=err.current && (err.current.state==='sent' || err.current.scheduledAt===sendAt);
    if(!accepted) {
      if(![400,403,404,409,413].includes(code))return {pending:true};
      await database.transaction('rw',database.draft,async()=>{
        const latest=await database.draft.get(row.draftId);
        if(latest?.pendingSchedule?.version===version)await database.draft.put({...latest,pendingSchedule:null,schedulingError:err.message||'Could not schedule this draft.',syncState:'saved'});
      });
      return {error:err.message||'Could not schedule this draft.'};
    }
  }
  await database.transaction('rw',database.draft,database.att,async()=>{
    const latest=await database.draft.get(row.draftId);
    if(latest?.pendingSchedule?.version===version) {
      await database.draft.delete(row.draftId);
      await database.att.delete(row.draftId);
    }
  });
  userDraftStore().refreshList++;
  userDraftStore().scheduledRevision++;
  return {pending:false};
}
export async function scheduleCloudDraft(id,sendAt) {
  const database=db.value,api=sessionAPI(database);
  const synced=await syncCloudDrafts();
  const row=await database.transaction('rw',database.draft,async()=>{
    const current=await database.draft.get(id);
    if(synced.conflicts[id] || !current || current.dirty || !current.cloudDraftId || current.sendAttemptId || current.pendingSchedule)
      throw new Error('Open the current saved draft before scheduling this message.');
    const pending={...current,schedulingError:null,pendingSchedule:{version:current.cloudVersion,sendAt},syncState:'scheduling'};
    await database.draft.put(pending);
    return pending;
  });
  const result=await reconcileSchedule(database,api,row);
  if(result.error)throw new Error(result.error);
  return result;
}
export async function sendCloudDraft(id) {
  const database=db.value,api=sessionAPI(database);
  const before=await database.draft.get(id);
  if(before?.pendingSchedule)throw new Error('Check Scheduled before sending this message.');
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
