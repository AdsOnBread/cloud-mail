import {watch} from 'vue';
import {draftSearchBytes,referencedAttachments} from "../components/message-composer/files";
import { draftEditBase, draftFilingFingerprint, draftRecipientNames } from '@/utils/recipients';
import { draftSummary, newestDraft } from '@/utils/draft-summary';
import { useUserStore } from '@/store/user';
import db from '@/db/db.js';
import http from '@/axios/index.js';
import { userDraftStore } from '@/store/draft.js';
export function draftSession(database = db.value) {
  const token=localStorage.getItem('token');
  const owner = useUserStore().user.email;
  const check = () => {
    if (!owner || !token || database.name !== owner || db.value !== database ||
        useUserStore().user.email !== owner || useUserStore().authenticatedToken !== token ||
        localStorage.getItem('token') !== token) throw new Error('The signed-in user changed. Draft synchronization stopped.');
  };
  return {database, owner, token, check};
}
function sessionAPI(database) {
  const {check, token} = draftSession(database);
  const call=async(method,path,payload,options={})=>{
    check();const config={...options,headers:{...options.headers,Authorization:token||''}};
    try { return await (['get','delete'].includes(method)?http[method](path,config):http[method](path,payload,config)); } finally { check(); }
  };
  return {get:(path,options)=>call('get',path,null,options),delete:(path,options)=>call('delete',path,null,options),post:(path,payload,options)=>call('post',path,payload,options),put:(path,payload,options)=>call('put',path,payload,options)};
}
const locks=new WeakMap();
function syncAfterLocalChange(database) {
  const sync = () => { if (db.value === database) syncCloudDrafts().catch(() => {}); };
  if (locks.has(database)) locks.get(database).then(sync, sync);
  else sync();
}
function matchesEditor(current, expected) {
  if (current.editToken || expected.editToken) return current.editToken === expected.editToken;
  return current.cloudVersion === expected.cloudVersion && current.localRevision === expected.localRevision;
}
const apiError=e=>e.response?.data||e;
const fingerprint=(row, legacy=false)=>JSON.stringify([row.accountId,row.subject,row.content,row.text,row.receiveEmail,row.cc,row.bcc,(row.attachments||[]).map(f=>[f.filename,f.contentType||f.mimeType,String(f.content||'').replace(/^data:[^,]*;base64,/,''),f.contentId||'']).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),row.sendType,row.emailId,...(row.plainText?[true]:[]),...(legacy?[]:draftRecipientNames(row))]);
// The server stores pasted photos as CID attachments. Compare the restored image
// in the HTML once, while retaining separately attached files in the comparison.
function savedFingerprint(row) {
  const template=document.createElement('template');
  template.innerHTML=row.content || '';
  const photos=new Set(Array.from(template.content.querySelectorAll('img[src]'), image=>image.getAttribute('src')));
  const attachments=referencedAttachments(row).filter(file=>!file.contentId || !photos.has(file.content));
  // Filing participates in draft conflicts but never changes a delivery receipt.
  return JSON.stringify([fingerprint({...row, content:template.innerHTML, attachments}),draftFilingFingerprint(row)]);
}
async function signature(row,legacy=false) {return (legacy?'':'v2:')+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint(row,legacy)))),b=>b.toString(16).padStart(2,'0')).join('');}
const strip=row=>{const copy={...row};for(const key of ['draftId','cloudDraftId','cloudVersion','dirty','clientId','uploadIntent','uploadId','syncState','localRevision','sendAttemptId','sendFingerprint','pendingSchedule','schedulingError','ownerEmail','editToken','starEditBase','conflictCopy','restoredFromDiscard','detachedReply','hasFiles','sizeBytes','attachments'])delete copy[key];return copy;};
async function withFiles(database,row) {return {...row,attachments:(await database.att.get(row.draftId))?.attachments||[]};}
async function put(database,row,attachments) {
  const {attachments:ignored,...metadata}=row;
  metadata.hasFiles=attachments.some(file=>!file.contentId);
  metadata.sizeBytes=draftSearchBytes(metadata,attachments);
  await database.transaction('rw',database.draft,database.att,async()=>{await database.draft.put(metadata);await database.att.put({draftId:row.draftId,attachments});});
}
// Called inside a draft/attachment transaction so an interrupted save cannot leave a partial draft.
async function writeDraft(database, row) {
  const {attachments = [], ...metadata} = row;
  metadata.hasFiles=attachments.some(file=>!file.contentId);
  metadata.sizeBytes=draftSearchBytes(metadata,attachments);
  if (row.draftId) await database.draft.put(metadata);
  else {
    delete metadata.draftId;
    row.draftId = await database.draft.add(metadata);
  }
  await database.att.put({draftId:row.draftId, attachments});
  return {...row,hasFiles:metadata.hasFiles,sizeBytes:metadata.sizeBytes};
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
    cloudDraftId:remote.draftId, cloudVersion:remote.version, dirty:false, uploadIntent:undefined,
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
export async function saveLocalDraft(input, {requireCurrent = false, session, starOnly = false, preserveStar = false} = {}) {
  const database=db.value;
  session?.check();
  if(input.ownerEmail&&input.ownerEmail!==useUserStore().user.email)throw new Error('The signed-in user changed. Your previous draft was not moved.');
  const row = await database.transaction('rw', database.draft, database.att, async () => {
    const current = input.draftId ? await database.draft.get(input.draftId) : null;
    if(current?.deleted || current?.pendingSchedule || (!current && input.draftId))throw new Error('This draft has changed. Check Scheduled or reopen it from Drafts.');
    if (current && requireCurrent && !matchesEditor(current, input)) throw new Error('The draft changed elsewhere. Reopen it before changing it.');
    // A background upload can advance the cloud version of precisely the edit still in the composer.
    // A different edit token means the editor must keep its own base version for conflict detection.
    const sameEdit = current && ((input.editToken && input.editToken === current.editToken) ||
      current.starEditBase === draftEditBase(input));
    if (!sameEdit && input.clientId && current?.clientId && input.clientId !== current.clientId)
      throw new Error('The draft changed elsewhere. Reopen it before changing it.');
    return writeDraft(database, {
      ...input,
      attachments:starOnly ? input.attachments : referencedAttachments(input),
      // A filing-only edit keeps its content ancestor across tabs and cloud uploads.
      starEditBase:starOnly && current ? current.starEditBase || draftEditBase(current) : undefined,
      ...(preserveStar && current ? {mailboxStarred:Boolean(current.mailboxStarred)} : {}),
      ...(current?.detachedReply ? {detachedReply:true, emailId:0, sendType:'', inlineReply:false, trashSource:0} : {}),
      restoredFromDiscard:current?.restoredFromDiscard, updatedAt:new Date().toISOString(), dirty:true, editToken:crypto.randomUUID(),
      clientId:current?.clientId || input.clientId || crypto.randomUUID(),
      cloudVersion:sameEdit ? current.cloudVersion : input.cloudVersion ?? current?.cloudVersion,
      cloudDraftId:sameEdit ? current.cloudDraftId : input.cloudDraftId ?? current?.cloudDraftId,
      uploadIntent:sameEdit ? current.uploadIntent : undefined, conflictCopy:current?.conflictCopy, sendAttemptId:current?.sendAttemptId, sendFingerprint:current?.sendFingerprint,
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
  // Every edit attempted from this base revision shares a private nonce. It lets
  // us identify our own earlier write even if the author has kept typing offline.
  const uploadId = await database.transaction('rw', database.draft, async () => {
    const current=await database.draft.get(row.draftId);
    if (!current || current.deleted || current.editToken !== row.editToken) return;
    const base=row.cloudVersion || 0;
    if(current.uploadIntent?.base===base) return current.uploadIntent.id;
    const intent={base,id:crypto.randomUUID()};
    await database.draft.put({...current,uploadIntent:intent});
    return intent.id;
  });
  if (!uploadId) return;
  try {
    // IDs belong to a particular cloud draft; send binary data when importing a conflict copy.
    const attachments=referencedAttachments(value).map(({attachmentId,...f})=>f);
    const payload={...strip(value),composeStarred:value.mailboxStarred == null ? undefined : Boolean(value.mailboxStarred),accountId:value.accountId,clientId:value.clientId,version:value.cloudVersion,attachments,ui:{uploadId,...(value.trashSource ? {trashSource:value.trashSource} : {}),inlineReply:value.inlineReply||false,replyRecipientNames:value.replyRecipientNames||{},localRevision:value.localRevision,editToken:value.editToken,starEditBase:value.starEditBase}};
    let remote=await (row.cloudDraftId?api.put(`/v1/drafts/${row.cloudDraftId}`,payload,{noMsg:true}):api.post('/v1/drafts',payload,{noMsg:true}));
    if(!row.cloudDraftId && remote.state==='draft' && remote.ui?.editToken!==value.editToken)throw {code:409,current:remote};
    await database.transaction('rw', database.draft, database.att, async () => {
      const latest = await database.draft.get(row.draftId);
      if (!latest || latest.deleted) return;
      const acknowledged = latest.editToken === row.editToken;
      if (!acknowledged && latest.uploadIntent?.id !== uploadId) return;
      if ((remote.state==='trashed' || remote.undoSendKey) && remote.ui?.editToken!==row.editToken) throw {code:409,current:remote};
      if (remote.undoSendKey || ['deleted','sent','trashed'].includes(remote.state)) {
        if (!acknowledged) throw {code:409, current:remote};
        await database.draft.delete(row.draftId);
        await database.att.delete(row.draftId);
        return;
      }
      await database.draft.put({...latest, uploadIntent:undefined, cloudDraftId:remote.draftId, cloudVersion:remote.version,
        updatedAt:acknowledged ? remote.updatedAt || latest.updatedAt : latest.updatedAt,
        dirty:!acknowledged, syncState:acknowledged ? (latest.conflictCopy ? 'conflict' : 'saved') : 'saving'});
    });
  } catch(raw) {
    const error=apiError(raw);
    if (error.code === 404 && error.message === 'Original message not found.' &&
        !row.cloudDraftId && row.emailId &&
        (row.restoredFromDiscard || row.sendType === 'reply' && row.trashSource === row.emailId)) {
      const independent = await database.transaction('rw', database.draft, async () => {
        const latest = await database.draft.get(row.draftId);
        if (!latest || latest.deleted || latest.editToken !== row.editToken) return;
        // The missing source was rejected before a cloud write. Keep the edit token
        // so the already-open editor can adopt the successful independent upload.
        const next = {...latest, detachedReply:true, emailId:0, sendType:'', inlineReply:false, trashSource:0};
        await database.draft.put(next);
        return next;
      });
      return independent ? push(database, independent, api) : undefined;
    }
    if(error.code===409||(error.code===404&&row.cloudDraftId)) {
      const other = error.current?.state === 'draft' ? await downloadDraft(error.current, api) : null;
      const result = await database.transaction('rw', database.draft, database.att, async () => {
        const current = await database.draft.get(row.draftId);
        if (!current || current.deleted || (current.editToken !== row.editToken && current.uploadIntent?.id !== uploadId)) return;
        const sameDraft = row.cloudDraftId ? other?.cloudDraftId === row.cloudDraftId : other?.clientId === row.clientId;
        const nextVersion = (row.cloudVersion || 0) + 1;
        if (other && sameDraft && other.cloudVersion === nextVersion) {
          const exact = row.editToken && other.editToken === row.editToken &&
            (other.name || '') === (value.name || '') && savedFingerprint(other) === savedFingerprint(value);
          const ownEarlierEdit = other.uploadId === uploadId && other.editToken !== row.editToken;
          if (exact || ownEarlierEdit) {
            const dirty = current.editToken !== other.editToken;
            const recovered = {...current, uploadIntent:undefined, cloudDraftId:other.cloudDraftId, cloudVersion:nextVersion,
              dirty, syncState:dirty ? 'saving' : current.conflictCopy ? 'conflict' : 'saved'};
            await database.draft.put(recovered);
            return dirty ? {retry:recovered} : {};
          }
        }
        // Keep the open editor attached to its local copy, including any edits made during the upload.
        const {cloudDraftId, cloudVersion, uploadIntent, sendAttemptId, sendFingerprint, ...copy} = current;
        await database.draft.put({...copy, clientId:crypto.randomUUID(), syncState:'conflict', conflictCopy:true, dirty:true});
        if (other) await writeDraft(database, other);
        return {forkId:row.draftId};
      });
      return result?.retry ? push(database,result.retry,api) : result;
    }
    await database.transaction('rw', database.draft, async () => {
      const latest = await database.draft.get(row.draftId);
      if (latest && !latest.deleted) await database.draft.put({...latest, syncState:'offline'});
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
    await database.discardUndo.where('expires').below(Date.now()).delete();
    if(!navigator.onLine)return {conflicts};
    for(const row of await database.draft.toArray()) {
      if(row.pendingSchedule) {
        await reconcileSchedule(database,api,row);
        continue;
      }
      if(row.deleted) {
        await finishDiscard(database, row, api);
        continue;
      }
      // Pre-cloud rows have no dirty flag: adopt them with a persisted import UUID first.
      if (!row.cloudDraftId && !row.clientId) {
        const adopted = await database.transaction('rw', database.draft, async () => {
          const current = await database.draft.get(row.draftId);
          if (!current || current.deleted) return;
          if (!current.clientId) {
            Object.assign(current, {clientId:crypto.randomUUID(), editToken:crypto.randomUUID(), dirty:true});
            await database.draft.put(current);
          }
          return current;
        });
        if (!adopted) continue;
        Object.assign(row, adopted);
      }
      if(row.dirty){const result=await push(database,row,api);if(result?.forkId)conflicts[row.draftId]=result.forkId;}
    }
    // Replay a separate durable cursor, independent of the mailbox synchronization cursor.
    let cursor=(await database.meta.get('draftCursor'))?.value||0,more=true;
    while(more) {
      const page=await api.get('/v1/drafts/changes',{params:{after:cursor,limit:100},noMsg:true});
      for(const event of page.changes) {
        const local = (await database.draft.toArray()).find(row =>
          row.cloudDraftId === event.draftId ||
          (row.deleted && !row.cloudDraftId && row.clientId && row.clientId === event.draft?.clientId));
        if(local?.deleted || local?.dirty || local?.pendingSchedule)continue; // The local revision is reconciled before subsequent changes.
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
// Resolve a lost first upload by its idempotent import key. Only delete an
// acknowledged base version or the immediately following write carrying our nonce.
async function finishDiscard(database, row, api) {
  let cloudId = row.cloudDraftId;
  let version = row.cloudVersion;
  if (!cloudId && row.uploadIntent) {
    const remote = await api.post('/v1/drafts', {
      clientId:row.clientId, accountId:row.accountId, ui:{uploadId:row.uploadIntent.id},
    }, {noMsg:true});
    if (remote.version === 1 && remote.ui?.uploadId === row.uploadIntent.id && remote.state === 'draft') {
      cloudId = remote.draftId;
      version = remote.version;
    } else if (!['sent','deleted','trashed'].includes(remote.state) && !remote.scheduledAt && !remote.undoSendKey) {
      const value = await downloadDraft(remote, api);
      await put(database, {...value, draftId:row.draftId}, value.attachments);
      return;
    }
  }
  if (cloudId) {
    try {
      await api.delete('/v1/drafts/' + cloudId, {params:{version},noMsg:true});
    } catch (raw) {
      const error = apiError(raw), remote = error.current;
      if (Number(error.code) === 409 && remote && !['sent','deleted','trashed'].includes(remote.state) && !remote.scheduledAt && !remote.undoSendKey) {
        if (remote.state === 'draft' && row.uploadIntent && remote.version === version + 1 && remote.ui?.uploadId === row.uploadIntent.id) {
          await database.draft.put({...row, cloudDraftId:cloudId, cloudVersion:remote.version, uploadIntent:undefined});
          return finishDiscard(database, await database.draft.get(row.draftId), api);
        }
        const value = await downloadDraft(remote, api);
        await put(database, {...value, draftId:row.draftId}, value.attachments);
        return;
      }
      if (Number(error.code) !== 404 && !(Number(error.code) === 409 && remote && (remote.scheduledAt || remote.undoSendKey || ['sent','deleted','trashed'].includes(remote.state)))) throw raw;
    }
  }
  await database.transaction('rw', database.draft, database.att, async () => {
    await database.draft.delete(row.draftId);
    await database.att.delete(row.draftId);
  });
}

export async function discardDrafts(ids, expectedEditor, session = draftSession()) {
  const {database, owner, check:checkOwner} = session;
  const operation = crypto.randomUUID(), originals = [...new Set(ids)];
  const editors=new Map([].concat(expectedEditor || []).map(editor=>[editor.draftId,editor]));
  const expires = Date.now() + 86400000;
  checkOwner();
  // A definite failure or stale, never-started operation is safe to discard.
  // Never assume an in-flight delivery failed simply because its receipt is not present yet.
  const resolvedAttempts = new Map();
  for (const id of originals) {
    const row = await database.draft.get(id);
    if (!row?.sendAttemptId) continue;
    const api = sessionAPI(database);
    const attempt = await api.get('/v1/send-attempts/' + row.sendAttemptId, {noMsg:true});
    if (['failed','canceled'].includes(attempt.state)) resolvedAttempts.set(id, row.sendAttemptId);
    if (attempt.state === 'not_started' && row.cloudDraftId) {
      const remote = await api.get('/v1/drafts/' + row.cloudDraftId, {noMsg:true});
      if (remote.state === 'draft' && remote.version !== row.cloudVersion) resolvedAttempts.set(id, row.sendAttemptId);
    }
  }
  await database.transaction('rw', database.draft, database.att, database.discardUndo, async () => {
    checkOwner();
    for (const id of originals) {
      const row = await database.draft.get(id);
      if (!row || row.deleted) throw new Error('This draft is no longer available.');
      if (editors.has(id) && !matchesEditor(row, editors.get(id)))
        throw new Error('The draft changed elsewhere. Reopen it before changing it.');
      if (row.pendingSchedule || (row.sendAttemptId && resolvedAttempts.get(id) !== row.sendAttemptId) ||
          (!resolvedAttempts.has(id) && ['sending','uncertain'].includes(row.syncState)))
        throw new Error('Check the delivery status before discarding this draft.');
      const saved = await withFiles(database, row);
      await database.discardUndo.put({operation, originalId:id, expires, saved});
      await database.draft.put({...row, deleted:true, dirty:false});
    }
    checkOwner();
  });
  checkOwner();
  userDraftStore().refreshList++;
  syncAfterLocalChange(database);
  return {
    count:originals.length,
    dispose:() => database.discardUndo.where('operation').equals(operation).delete(),
    async restore() {
      checkOwner();
      const restored = await database.transaction('rw', database.draft, database.att, database.discardUndo, async () => {
        const result = [];
        for (const originalId of originals) {
          const backup = await database.discardUndo.get([operation, originalId]);
          if (!backup) throw new Error('This draft can no longer be restored.');
          const saved = backup.saved;
          const recovered = await writeDraft(database, {...strip(saved), attachments:saved.attachments,
            clientId:crypto.randomUUID(), editToken:crypto.randomUUID(), dirty:true,
            localRevision:1, restoredFromDiscard:true, ownerEmail:owner, syncState:navigator.onLine ? 'saving' : 'offline'});
          result.push(recovered.draftId);
          await database.discardUndo.delete([operation, originalId]);
        }
        checkOwner();
        return result;
      });
      checkOwner();
      userDraftStore().refreshList++;
      syncAfterLocalChange(database);
      return restored;
    },
  };
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
  let scheduled;
  try {
    scheduled=await api.post(path,{version,sendAt},{noMsg:true});
    const user = useUserStore();
    if (scheduled.lastSchedule && database === db.value && database.name === user.user.email &&
        scheduled.lastSchedule.version > (user.user.lastSchedule?.version || 0)) {
      user.user.lastSchedule = scheduled.lastSchedule;
    }

  } catch(raw) {
    const err=apiError(raw), code=Number(err.code);
    // The server returns its current revision on conflict, including a completed send.
    const accepted=err.current && (err.current.state==='sent' || err.current.scheduledAt===sendAt);
    if (accepted && err.current.state === 'scheduled' && err.current.version === version + 1)
      scheduled={draftId:row.cloudDraftId,version:err.current.version,sendAt};
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
  return {pending:false, scheduled:scheduled?.draftId === row.cloudDraftId && scheduled.version === version + 1 ?
    {...scheduled, accountId:row.accountId} : null};
}
async function syncForDelivery(database, id, editToken) {
  // A sync already pulling cloud changes has passed its local-upload step.
  // If we joined that pass, upload the exact revision the sender confirmed.
  const joined = locks.has(database);
  const result = await syncCloudDrafts();
  if (!joined || result.conflicts[id] || db.value !== database) return result;
  const draft = await database.draft.get(id);
  if (draft?.dirty && !draft.deleted && draft.editToken === editToken && db.value === database)
    return syncCloudDrafts();
  return result;
}

export async function scheduleCloudDraft(id,sendAt,editToken) {
  const database=db.value,api=sessionAPI(database);
  editToken ??= (await database.draft.get(id))?.editToken;
  const synced=await syncForDelivery(database,id,editToken);
  const row=await database.transaction('rw',database.draft,async()=>{
    const current=await database.draft.get(id);
    if(synced.conflicts[id] || !current || current.editToken !== editToken || current.deleted || current.dirty || !current.cloudDraftId || current.sendAttemptId || current.pendingSchedule)
      throw new Error('Open the current saved draft before scheduling this message.');
    const pending={...current,schedulingError:null,pendingSchedule:{version:current.cloudVersion,sendAt},syncState:'scheduling'};
    await database.draft.put(pending);
    return pending;
  });
  const result=await reconcileSchedule(database,api,row);
  if(result.error)throw new Error(result.error);
  return result;
}
export async function cancelScheduledReceipt(receipt, session) {
  session.check();
  await sessionAPI(session.database).post('/v1/scheduled/' + receipt.draftId + '/cancel', {version:receipt.version}, {noMsg:true});
  session.check();
  userDraftStore().scheduledRevision++;
  return restoredReceipt(receipt,session);
}

function restoredReceipt(receipt, session) {
  return {
    async localDraft() {
      session.check();
      // A pull started before Cancel may already have fetched the previous cursor page.
      const joined = locks.has(session.database);
      await syncCloudDrafts();
      session.check();
      const find = () => session.database.draft.where('cloudDraftId').equals(receipt.draftId).first();
      let row = await find();
      if (joined && (!row || row.cloudVersion < receipt.version + 1)) {
        await syncCloudDrafts();
        session.check();
        row = await find();
      }
      return row && row.cloudVersion >= receipt.version + 1 ? row : null;
    },
  };
}

async function finishSentAttempt(database, id, attemptId, messages) {
  let outcome;
  // Hash outside IndexedDB. If an editor changed the draft while hashing,
  // compare its new content before deciding whether it needs a separate copy.
  do {
    const snapshot = await database.transaction('r', database.draft, database.att, async () => {
      const row = await database.draft.get(id);
      if (row?.sendAttemptId === attemptId) return withFiles(database, row);
    });
    if (!snapshot) return messages;
    const changed = snapshot.sendFingerprint && await signature(snapshot,!snapshot.sendFingerprint.startsWith('v2:')) !== snapshot.sendFingerprint;
    outcome = await database.transaction('rw', database.draft, database.att, async () => {
      const current = await database.draft.get(id);
      if (current?.sendAttemptId !== attemptId) return 'finished';
      if (!matchesEditor(current, snapshot)) return 'retry';
      const keep = !current.deleted && changed;
      if (keep) {
        // The editor holding this unsent revision can keep autosaving to its
        // local ID. Give the copy a new cloud identity and keep its files in place.
        const {cloudDraftId, cloudVersion, sendAttemptId, sendFingerprint, uploadIntent, ...copy} = current;
        await database.draft.put({...copy, clientId:crypto.randomUUID(), dirty:true, conflictCopy:true, syncState:'conflict'});
        return 'preserved';
      }
      await database.draft.delete(id);
      await database.att.delete(id);
      return 'finished';
    });
  } while (outcome === 'retry');
  userDraftStore().refreshList++;
  if (outcome === 'preserved') {
    throw Object.assign(new Error('The original message was sent. Your newer edits are preserved in a separate draft.'), {sentMessages:messages});
  }
  return messages;
}

async function updateSendAttempt(database, id, attemptId, state, version, basis) {
  return database.transaction('rw', database.draft, async () => {
    const current = await database.draft.get(id);
    if (!current || current.deleted || current.sendAttemptId !== attemptId) return;
    const cleared = ['failed','not_started','canceled'].includes(state);
    const next = {...current,
      sendAttemptId:cleared ? null : attemptId, sendFingerprint:cleared ? null : current.sendFingerprint,
      syncState:cleared ? (current.dirty ? 'saving' : 'saved') : state};
    if (version != null && current.editToken === basis.editToken && current.cloudVersion === basis.cloudVersion) next.cloudVersion = version;
    await database.draft.put(next);
    return next;
  });
}

const tracking = new Set();
const trackingKey=(session,id)=>JSON.stringify([session.owner,session.token,id]);
const receiptKey = key => 'ordinary-send/' + key;
async function recoverDeliveries(database, follow) {
  if (!follow || !navigator.onLine) return;
  const session=draftSession(database),api=sessionAPI(database);
  session.check();
  const entries=await database.meta.where('key').startsWith('ordinary-send/').toArray();
  let awaitingAdmission=false;
  for (const entry of entries) {
    if (tracking.has(trackingKey(session,entry.attemptId))) continue;
    const receipt=await api.get('/v1/send-attempts/'+entry.attemptId,{noMsg:true});
    if (receipt.state==='not_started') {
      awaitingAdmission ||= Date.now()-entry.createdAt<120000;
      // Never dispatch on startup. The original request could still be in flight.
      if (Date.now()-entry.createdAt>86400000) await database.meta.delete(entry.key);
      continue;
    }
    if (receipt.state==='canceled') {
      await updateSendAttempt(database,entry.localId,entry.attemptId,'canceled');
      await database.meta.delete(entry.key);
      continue;
    }
    session.check();
    follow(heldDelivery({...receipt,undoUntil:receipt.undoUntil || 0},database,api,entry.localId),[],entry.replyTo,entry.subject,receipt.state!=='holding' || receipt.remainingMs===0);
  }
  return awaitingAdmission;
}

function heldDelivery(receipt, database, api, id) {
  const session=draftSession(database);
  const ownerKey=trackingKey(session,receipt.attemptId);
  const path='/v1/send-attempts/'+encodeURIComponent(receipt.attemptId);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  return {
    state:'holding', begin:()=>{
      if(tracking.has(ownerKey)) return false;
      tracking.add(ownerKey);
      return true;
    },end:()=>tracking.delete(ownerKey),delay: Math.max(0,receipt.state==='holding' ? receipt.remainingMs ?? receipt.undoUntil-Date.now() : 0),
    async cancel() {
      try { await api.post(path+'/undo',{}, {noMsg:true}); }
      catch(error) {
        const status=await api.get(path,{noMsg:true});
        if(status.state!=='canceled') throw error;
      }
      await database.meta.delete(receiptKey(receipt.attemptId));
      await updateSendAttempt(database,id,receipt.attemptId,'canceled');
      return restoredReceipt(receipt,session);
    },
    async finish() {
      // The server owns dispatch. Polling only updates this mailbox's confirmation.
      for (;;) {
        session.check();
        const status=await api.post(path+'/finish',{}, {noMsg:true});
        if (status.state==='sent') {
          try { return await finishSentAttempt(database,id,receipt.attemptId,status.messages); }
          finally { await database.meta.delete(receiptKey(receipt.attemptId)); }
        }
        if (status.state==='canceled') {
          await updateSendAttempt(database,id,receipt.attemptId,'canceled');
          await database.meta.delete(receiptKey(receipt.attemptId));
          return null;
        }
        if (status.state==='failed') {
          await updateSendAttempt(database,id,receipt.attemptId,'failed');
          await syncCloudDrafts();
          await database.meta.delete(receiptKey(receipt.attemptId));
          throw new Error(status.message || 'Delivery failed. Your message is in Drafts.');
        }
        if (!['sending','holding'].includes(status.state)) {
          if(status.state==='uncertain' && status.message) {
            await syncCloudDrafts();
            await database.meta.delete(receiptKey(receipt.attemptId));
          }
          throw new Error(status.message || 'Delivery has not been confirmed. Check Sent before retrying.');
        }
        await wait(1000);
      }
    },
  };
}

export async function sendCloudDraft(id, editToken, undoSeconds) {
  const database=db.value,api=sessionAPI(database);
  const before=await database.draft.get(id);
  editToken ??= before?.editToken;
  if (before?.editToken !== editToken) throw new Error('Reopen the current draft before sending.');
  if(before?.pendingSchedule)throw new Error('Check Scheduled before sending this message.');
  if(before?.sendAttemptId) {
    const attempt=await api.get(`/v1/send-attempts/${before.sendAttemptId}`,{noMsg:true});
    if (attempt.state === 'sent') {
      await database.meta.delete(receiptKey(before.sendAttemptId));
      return finishSentAttempt(database,id,before.sendAttemptId,attempt.messages);
    }
    if (attempt.state === 'uncertain') throw new Error(attempt.message || 'Delivery is uncertain. Check Sent before sending another copy.');
    if (['holding','sending'].includes(attempt.state)) return heldDelivery(attempt,database,api,id);
    if (['failed','canceled'].includes(attempt.state)) {
      await database.meta.delete(receiptKey(before.sendAttemptId));
      const latest = await updateSendAttempt(database, id, before.sendAttemptId, attempt.state);
      if (!latest || latest.editToken !== editToken) throw new Error('Reopen the current draft before sending.');
    }
  }
  const synced=await syncForDelivery(database,id,editToken);if(synced?.conflicts?.[id])throw new Error('Both versions were saved in Drafts. Review the saved copy before sending.');const row=await database.draft.get(id);
  if(!row||row.editToken!==editToken||row.deleted||row.dirty||!row.cloudDraftId)throw new Error('Your edits were preserved in Drafts. Open the saved draft before sending.');
  const sendFingerprint = await signature(await withFiles(database, row));
  const sendAttemptId = await database.transaction('rw', database.draft, database.meta, async () => {
    const current = await database.draft.get(id);
    if (!current || current.deleted || current.dirty || current.pendingSchedule ||
        current.cloudVersion !== row.cloudVersion || current.editToken !== row.editToken)
      throw new Error('Reopen the current draft before sending.');
    const attempt = current.sendAttemptId || crypto.randomUUID();
    if (undoSeconds && !await database.meta.get(receiptKey(attempt))) {
      await database.meta.put({key:receiptKey(attempt), attemptId:attempt, localId:id, createdAt:Date.now(),
        undoSeconds,subject:row.subject,replyTo:row.sendType==='reply' ? row.emailId : 0});
    }
    await database.draft.put({...current, sendAttemptId:attempt, sendFingerprint, syncState:'sending'});
    return attempt;
  });
  let result;
  try {
    result = await api.post(`/v1/drafts/${row.cloudDraftId}/send`, {version:row.cloudVersion,idempotencyKey:sendAttemptId,...(undoSeconds ? {undoSeconds} : {})},{noMsg:true});
  } catch (raw) {
    if (undoSeconds) {
      const receipt=await api.get('/v1/send-attempts/'+sendAttemptId,{noMsg:true}).catch(()=>null);
      if (['holding','sending'].includes(receipt?.state)) {
        await updateSendAttempt(database,id,sendAttemptId,'holding');
        userDraftStore().refreshList++;
        return heldDelivery(receipt,database,api,id);
      }
      if (receipt?.state==='sent') result=receipt;
    }
    if (!result && [400,403,404,409,413].includes(Number(apiError(raw).code))) {
      const receipt = await api.get('/v1/send-attempts/' + sendAttemptId, {noMsg:true});
      if (['failed','not_started'].includes(receipt.state)) {
        await updateSendAttempt(database,id,sendAttemptId,receipt.state);
        await database.meta.delete(receiptKey(sendAttemptId));
      }
    }
    if(!result) throw raw;
  }
  if(['holding','sending'].includes(result.state)) {
    await updateSendAttempt(database,id,sendAttemptId,'holding');
    userDraftStore().refreshList++;
    return heldDelivery(result,database,api,id);
  }
  if(result.state!=='sent') {
    const current=await api.get(`/v1/drafts/${row.cloudDraftId}`,{noMsg:true});
    await updateSendAttempt(database, id, sendAttemptId, result.state, current.version, row);
    throw new Error(result.message||'Delivery is uncertain. Check Sent before sending another copy.');
  }
  await database.meta.delete(receiptKey(sendAttemptId));
  return finishSentAttempt(database,id,sendAttemptId,result.messages);
}
export function startDraftSync(follow) {
  const checking=new Set();
  let retry,stopped=false;
  const recover=()=>{
    if(document.visibilityState==='hidden' || stopped) return;
    const identity=useUserStore().authenticatedToken;
    if (identity && !checking.has(identity) && follow) {
      checking.add(identity);
      recoverDeliveries(db.value,follow).then(pending=>{
        if (pending && !stopped) {clearTimeout(retry);retry=setTimeout(recover,500);}
      }).catch(()=>{}).finally(()=>checking.delete(identity));
    }
  };
  const sync=()=>{
    if(document.visibilityState==='hidden') return;
    syncCloudDrafts().catch(()=>{});
    recover();
  };
  const stop=watch([db,()=>useUserStore().authenticatedToken],sync);
  sync();const timer=setInterval(sync,60000);window.addEventListener('online',sync);document.addEventListener('visibilitychange',sync);
  return ()=>{stopped=true;clearTimeout(retry);stop();clearInterval(timer);window.removeEventListener('online',sync);document.removeEventListener('visibilitychange',sync);};
}
