import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {useUserStore} from '../src/store/user';
import {draftSession,discardDrafts,saveLocalDraft,syncCloudDrafts,removeLocalDraft,sendCloudDraft,scheduleCloudDraft} from '../src/services/cloud-drafts';
import db from '../src/db/db';
import http from '../src/axios';
const state=vi.hoisted(()=>({rows:new Map(),files:new Map(),meta:new Map(),remote:new Map(),events:[],next:1,cloudNext:1,attempts:new Map()}));
vi.mock('../src/db/db',()=>{
 const backups = new Map();
 const discardUndo = {
   put:async row=>backups.set(JSON.stringify([row.operation,row.originalId]), structuredClone(row)),
   get:async key=>structuredClone(backups.get(JSON.stringify(key))),
   delete:async key=>backups.delete(JSON.stringify(key)),
   where:field=>Object.fromEntries(['equals','below'].map(op=>[op,value=>({delete:async()=>{
     for (const [key,row] of backups) if (op==='equals' ? row[field]===value : row[field]<value) backups.delete(key);
   }})])),
 };
 const table=(rows,key)=>({get:async id=>structuredClone(rows.get(id)),toArray:async()=>structuredClone([...rows.values()]),put:async row=>{rows.set(row[key],structuredClone(row));return row[key];},add:async row=>{const id=state.next++;rows.set(id,structuredClone({...row,[key]:id}));return id;},delete:async id=>rows.delete(id)});
 return {default:{value:{name:'writer@example.net',discardUndo,draft:table(state.rows,'draftId'),att:table(state.files,'draftId'),meta:table(state.meta,'key'),transaction:async(...args)=>args.at(-1)()}}};
});
vi.mock('../src/axios',()=>({default:{get:vi.fn(),post:vi.fn(),put:vi.fn(),delete:vi.fn()}}));
function event(remote){state.events.push({seq:state.events.length+1,draftId:remote.draftId,operation:'upsert',draft:structuredClone(remote)});}
const input=extra=>({accountId:1,subject:'Draft',content:'<p>Hello</p>',text:'Hello',receiveEmail:['person@example.net'],cc:[],bcc:[],attachments:[],...extra});
beforeEach(()=>{
 setActivePinia(createPinia());
 const user=useUserStore();user.user.email='writer@example.net';user.authenticatedToken='test-session';localStorage.setItem('token','test-session');
 for(const map of [state.rows,state.files,state.meta,state.remote,state.attempts])map.clear();state.events=[];state.next=1;state.cloudNext=1;
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true});vi.resetAllMocks();
 http.get.mockImplementation(async(path,options)=>{
  if(path==='/v1/drafts/changes'){const after=options.params.after;return {changes:state.events.filter(e=>e.seq>after),cursor:state.events.at(-1)?.seq||after,hasMore:false};}
  if(path.startsWith('/v1/send-attempts/'))return state.attempts.get(path.split('/').at(-1))||{state:'not_started'};
  return structuredClone(state.remote.get(Number(path.split('/').at(-1))));
 });
 http.post.mockImplementation(async(path,payload)=>{
  if(path==='/v1/drafts'){
   const existing=[...state.remote.values()].find(d=>d.clientId===payload.clientId);if(existing)return structuredClone(existing);
   const row={...structuredClone(payload),draftId:state.cloudNext++,version:1,state:'draft',attachments:[]};state.remote.set(row.draftId,row);event(row);return structuredClone(row);
  }
  const id=Number(path.split('/')[3]);const row=state.remote.get(id);const result={state:'sent',attemptId:payload.idempotencyKey,messages:[{emailId:100,subject:row.subject}]};state.attempts.set(payload.idempotencyKey,result);return result;
 });
 http.put.mockImplementation(async(path,payload)=>{const id=Number(path.split('/').at(-1)),row=state.remote.get(id);if(!row)throw {code:404};if(payload.version!==row.version)throw {code:409,current:structuredClone(row)};const updated={...row,...structuredClone(payload),version:row.version+1,attachments:[]};state.remote.set(id,updated);event(updated);return structuredClone(updated);});
 http.delete.mockImplementation(async path=>{const id=Number(path.split('/').at(-1));state.remote.delete(id);state.events.push({seq:state.events.length+1,draftId:id,operation:'delete'});return {deleted:true};});
});
describe('Cloud draft synchronization',()=>{
 it('saves offline and imports a legacy draft exactly once with its files and Bcc intact',async()=>{
  Object.defineProperty(navigator,'onLine',{value:false});const row=await saveLocalDraft(input({bcc:['hidden@example.net'],attachments:[{filename:'report.txt',content:'aGVsbG8=',contentType:'text/plain'}]}));
  expect((await db.value.draft.get(row.draftId)).syncState).toBe('offline');await syncCloudDrafts();expect(http.post).not.toHaveBeenCalled();
  Object.defineProperty(navigator,'onLine',{value:true});await syncCloudDrafts();await syncCloudDrafts();expect(http.post).toHaveBeenCalledTimes(1);expect(http.post.mock.calls[0][1]).toMatchObject({bcc:['hidden@example.net'],attachments:[{filename:'report.txt',content:'aGVsbG8='}]});expect(state.rows.size).toBe(1);
 });
 it('merges another tab’s filing-only revision into later typing without forking the draft',async()=>{
  const opened=await saveLocalDraft(input({content:'Original',mailboxStarred:false}));
  const intermediate=await saveLocalDraft({...opened,mailboxStarred:true},{starOnly:true,requireCurrent:true});
  const cleared=await saveLocalDraft({...intermediate,mailboxStarred:false},{starOnly:true,requireCurrent:true});
  const starred=await saveLocalDraft({...cleared,mailboxStarred:true},{starOnly:true,requireCurrent:true});
  await db.value.draft.put({...await db.value.draft.get(starred.draftId),cloudVersion:4,dirty:false});
  const typed=await saveLocalDraft({...intermediate,content:'Original continued'},{preserveStar:true});
  expect(typed).toMatchObject({draftId:opened.draftId,mailboxStarred:true,cloudVersion:4,content:'Original continued'});
  expect(typed.starEditBase).toBeUndefined();
 });
 it('recognizes its own cloud update after a lost response without creating a duplicate',async()=>{
  const row=await saveLocalDraft(input({name:'Alex'}));
  await syncCloudDrafts();
  await saveLocalDraft({...await db.value.draft.get(row.draftId),plainText:true,text:'Literal <text>',attachments:[]});
  const update=http.put.getMockImplementation();
  http.put.mockImplementationOnce(async(...args)=>{await update(...args);throw new Error('Response lost');});
  await expect(syncCloudDrafts()).rejects.toThrow('Response lost');
  expect((await syncCloudDrafts()).conflicts).toEqual({});
  expect([...state.rows.values()]).toMatchObject([{draftId:row.draftId,cloudVersion:2,dirty:false,plainText:true}]);
  expect(state.remote.size).toBe(1);
 });
 it.each(['create','update'])('keeps newer typing when a cloud %s response is lost',async(kind)=>{
  let local=await saveLocalDraft(input());
  if(kind==='update'){
    await syncCloudDrafts();
    local=await saveLocalDraft({...await db.value.draft.get(local.draftId),subject:'First edit'});
  }
  const method=kind==='update' ? http.put : http.post;
  const normal=method.getMockImplementation();
  method.mockImplementationOnce(async(...args)=>{await normal(...args);throw new Error('Response lost');});
  await expect(syncCloudDrafts()).rejects.toThrow('Response lost');
  await saveLocalDraft({...local,subject:'Latest typing',attachments:[]});
  expect((await syncCloudDrafts()).conflicts).toEqual({});
  expect([...state.rows.values()]).toMatchObject([{dirty:false,subject:'Latest typing'}]);
  expect([...state.remote.values()]).toMatchObject([{subject:'Latest typing'}]);
 });
 it('forks a stale second editor after the first editor loses its upload response',async()=>{
  const row=await saveLocalDraft(input());
  await syncCloudDrafts();
  const original=await db.value.draft.get(row.draftId);
  await saveLocalDraft({...original,subject:'Editor A',attachments:[]});
  const normal=http.put.getMockImplementation();
  http.put.mockImplementationOnce(async(...args)=>{await normal(...args);throw new Error('Response lost');});
  await expect(syncCloudDrafts()).rejects.toThrow('Response lost');
  await saveLocalDraft({...original,subject:'Editor B',attachments:[]});
  expect((await syncCloudDrafts()).conflicts[row.draftId]).toBeTruthy();
  expect([...state.rows.values()].map(d=>d.subject).sort()).toEqual(['Editor A','Editor B']);
 });
 it('recognizes an acknowledged inline photo after the server rewrites it as a CID attachment',async()=>{
  const row=await saveLocalDraft(input());
  await syncCloudDrafts();
  const image='data:image/png;base64,eA==';
  const local=await saveLocalDraft({...await db.value.draft.get(row.draftId),content:'<div><img src="'+image+'"></div>',attachments:[]});
  const remote=state.remote.get(local.cloudDraftId);
  Object.assign(remote,{version:2,ui:{editToken:local.editToken},content:'<div><img src="cid:photo"></div>',
    attachments:[{filename:'photo.png',attachmentId:37,mimeType:'image/png',contentId:'photo'}]});
  const get=http.get.getMockImplementation();
  http.get.mockImplementation((path,...args)=>path.includes('/attachments/37/') ? Promise.resolve(new Blob(['x'],{type:'image/png'})) : get(path,...args));
  expect((await syncCloudDrafts()).conflicts).toEqual({});
  expect([...state.rows.values()]).toMatchObject([{draftId:row.draftId,cloudVersion:2,dirty:false}]);
 });
 it('preserves both versions on conflict and points the editor at its saved copy',async()=>{
  const row=await saveLocalDraft(input());await syncCloudDrafts();const local=await db.value.draft.get(row.draftId),remote=state.remote.get(local.cloudDraftId);remote.subject='Edited on iOS';remote.version++;event(remote);
  await saveLocalDraft({...local,subject:'My browser edits',attachments:[]});const result=await syncCloudDrafts();
  expect(result.conflicts[row.draftId]).toBeTruthy();expect([...state.rows.values()].map(r=>r.subject).sort()).toEqual(['Edited on iOS','My browser edits']);
  await syncCloudDrafts();expect(state.remote.size).toBe(2);
 });
 it('keeps one draft through eight autosaves interleaved with background synchronization', async () => {
  let editor = await saveLocalDraft(input());
  await syncCloudDrafts();
  editor = await db.value.draft.get(editor.draftId);
  for (let revision = 1; revision <= 8; revision++) {
   editor = await saveLocalDraft({...editor, subject: 'Edit ' + revision});
   // A mailbox refresh can finish before the composer's own sync callback runs.
   const result = await syncCloudDrafts();
   expect(result.conflicts).toEqual({});
  }
  expect([...state.remote.values()]).toMatchObject([{subject:'Edit 8', version:9}]);
  expect([...state.rows.values()]).toMatchObject([{draftId:editor.draftId, dirty:false}]);
  expect(http.post).toHaveBeenCalledTimes(1);
 });
 it('preserves a remote edit pulled while the composer is still open', async () => {
  const first = await saveLocalDraft(input());
  await syncCloudDrafts();
  const editor = await db.value.draft.get(first.draftId);
  const remote = state.remote.get(editor.cloudDraftId);
  remote.subject = 'Changed on another device';
  remote.ui.editToken = 'another-device-edit';
  remote.version++;
  event(remote);
  await syncCloudDrafts();
  const local = await saveLocalDraft({...editor, subject:'My continued edit'});
  const {conflicts} = await syncCloudDrafts();
  expect(conflicts[local.draftId]).toBeTruthy();
  await saveLocalDraft({...local, subject:'Still typing'});
  await syncCloudDrafts();
  expect([...state.remote.values()].map(row => row.subject).sort()).toEqual(['Changed on another device','Still typing']);
 });
 it('does not mark changes typed during an upload as synchronized',async()=>{
  const row=await saveLocalDraft(input());let release;const original=http.post.getMockImplementation();http.post.mockImplementationOnce(async(...args)=>{await new Promise(resolve=>release=resolve);return original(...args);});
  const syncing=syncCloudDrafts();while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  await saveLocalDraft({...await db.value.draft.get(row.draftId),subject:'Typed during upload',attachments:[]});release();await syncing;
  expect((await db.value.draft.get(row.draftId)).dirty).toBe(true);await syncCloudDrafts();expect([...state.remote.values()][0].subject).toBe('Typed during upload');
 });
 it('restores the complete discarded reply offline after its original is deleted from the cloud',async()=>{
   const user=useUserStore(); user.user.email='writer@example.net'; user.authenticatedToken='test-session';
   localStorage.setItem('token','test-session');
   const file={filename:'note.txt',content:'aGk=',contentType:'text/plain'};
   const saved=input({sendType:'reply',emailId:42,inlineReply:true,bcc:['private@example.net'],plainText:true,attachments:[file]});
   const original=await saveLocalDraft(saved);
   await syncCloudDrafts();
   const operation=await discardDrafts([original.draftId]);
   await syncCloudDrafts();
   expect(state.remote.size).toBe(0);
   Object.defineProperty(navigator,'onLine',{value:false});
   localStorage.setItem('token','different');
   await expect(operation.restore()).rejects.toThrow('signed-in user changed');
   localStorage.setItem('token','test-session');
   const [id]=await operation.restore();
   expect(id).not.toBe(original.draftId);
   expect(await db.value.draft.get(id)).toMatchObject({sendType:'reply',emailId:42,inlineReply:true,bcc:saved.bcc,plainText:true,dirty:true});
   expect((await db.value.att.get(id)).attachments).toEqual([file]);
   await expect(operation.restore()).rejects.toThrow('no longer');
   Object.defineProperty(navigator,'onLine',{value:true});
   await syncCloudDrafts();
   expect(state.remote.size).toBe(1);
   expect([...state.remote.values()][0].clientId).not.toBe(original.clientId);
 });
 it('finishes a discard after the first upload response was lost',async()=>{
   const user=useUserStore(); user.user.email='writer@example.net'; user.authenticatedToken='discard';
   localStorage.setItem('token','discard');
   const original=await saveLocalDraft(input());
   const post=http.post.getMockImplementation();
   http.post.mockImplementationOnce(async(...args)=>{await post(...args);throw new Error('lost');});
   await expect(syncCloudDrafts()).rejects.toThrow('lost');
   const operation=await discardDrafts([original.draftId]);await syncCloudDrafts();
   expect(state.remote.size).toBe(0);expect(state.rows.size).toBe(0);
   await operation.dispose();await expect(operation.restore()).rejects.toThrow('no longer');
 });
 it('discards locally before an in-flight upload returns and does not revive the removed edit',async()=>{
   const row=await saveLocalDraft(input());
   const post=http.post.getMockImplementation();
   let release, started;
   const held=new Promise(resolve=>{release=resolve;});
   const requested=new Promise(resolve=>{started=resolve;});
   http.post.mockImplementationOnce(async(...args)=>{const result=await post(...args);started();await held;return result;});
   const first=syncCloudDrafts();await requested;
   const operation=await discardDrafts([row.draftId]);
   expect((await db.value.draft.get(row.draftId)).deleted).toBe(true);
   let finishDelete, deleting;
   const deletingSignal=new Promise(resolve=>{deleting=resolve;});
   const pauseDelete=new Promise(resolve=>{finishDelete=resolve;});
   const remove=http.delete.getMockImplementation();
   http.delete.mockImplementationOnce(async(...args)=>{deleting();await pauseDelete;return remove(...args);});
   release();await first;await deletingSignal;
   expect([...state.rows.values()].filter(value=>!value.deleted)).toHaveLength(0);
   finishDelete();await syncCloudDrafts();
   expect(state.rows.size).toBe(0);expect(state.remote.size).toBe(0);await operation.dispose();
 });
 it('keeps a newer draft when a stale unchanged editor tries to discard',async()=>{
   const original=await saveLocalDraft(input());await syncCloudDrafts();
   const latest=await saveLocalDraft({...await db.value.draft.get(original.draftId),subject:'Other edit'});
   await expect(discardDrafts([original.draftId],original)).rejects.toThrow('changed elsewhere');
   await expect(saveLocalDraft(original,{requireCurrent:true})).rejects.toThrow('changed elsewhere');
   expect(await db.value.draft.get(original.draftId)).toMatchObject({subject:'Other edit',editToken:latest.editToken});
 });
 it('rejects an account switch after the click and never flushes its offline discard using the new token',async()=>{
   const original=await saveLocalDraft(input());await syncCloudDrafts();
   const session=draftSession();
   Object.defineProperty(navigator,'onLine',{value:false});
   const operation=await discardDrafts([original.draftId],undefined,session);await syncCloudDrafts();
   localStorage.setItem('token','other-owner');
   await expect(discardDrafts([original.draftId],undefined,session)).rejects.toThrow('signed-in user changed');
   Object.defineProperty(navigator,'onLine',{value:true});
   await expect(syncCloudDrafts()).rejects.toThrow('signed-in user changed');
   expect(http.delete).not.toHaveBeenCalled();expect(state.remote.size).toBe(1);
   localStorage.setItem('token','test-session');await syncCloudDrafts();await operation.dispose();
 });
 it('preserves an uncertain delivery on another device and continues synchronizing subsequent drafts',async()=>{
   const row=await saveLocalDraft(input());await syncCloudDrafts();
   const current={...state.remote.get(1),state:'uncertain',version:2};state.remote.set(1,current);event(current);
   http.delete.mockRejectedValueOnce({code:409,current});
   const next=await saveLocalDraft(input({subject:'Later draft'}));
   const operation=await discardDrafts([row.draftId]);await syncCloudDrafts();
   expect(await db.value.draft.get(row.draftId)).toMatchObject({syncState:'uncertain'});
   expect(await db.value.draft.get(next.draftId)).toMatchObject({dirty:false});
   await expect(discardDrafts([row.draftId])).rejects.toThrow('delivery status');await operation.dispose();
 });
 it('recognizes a pre-upgrade delivery receipt when only private filing choices changed',async()=>{
   const row=await saveLocalDraft(input({mailboxStarred:true,labelIds:[3],attachments:[]}));
   const serialized=JSON.stringify([row.accountId,row.subject,row.content,row.text,row.receiveEmail,row.cc,row.bcc,[],row.sendType,row.emailId]);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized));
   const sendFingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   await db.value.draft.put({...await db.value.draft.get(row.draftId),sendAttemptId:'prior-receipt',sendFingerprint});
   state.attempts.set('prior-receipt',{state:'sent',messages:[{emailId:8}]});
   expect(await sendCloudDraft(row.draftId)).toEqual([{emailId:8}]);
   expect(await db.value.draft.toArray()).toHaveLength(0);
 });
 it('releases a rejected send receipt so a draft can still be discarded',async()=>{
   const row=await saveLocalDraft(input());await syncCloudDrafts();
   http.post.mockRejectedValueOnce({code:409,current:state.remote.get(1)});
   await expect(sendCloudDraft(row.draftId)).rejects.toMatchObject({code:409});
   expect((await db.value.draft.get(row.draftId)).sendAttemptId).toBe(null);
   const operation=await discardDrafts([row.draftId]);await syncCloudDrafts();await operation.dispose();
 });
 it('restores an independent editable draft when the reply source has since been removed',async()=>{
   const row=await saveLocalDraft(input({sendType:'reply',emailId:17,inlineReply:true}));await syncCloudDrafts();
   const operation=await discardDrafts([row.draftId]);await syncCloudDrafts();
   Object.defineProperty(navigator,'onLine',{value:false});
   const [id]=await operation.restore();await syncCloudDrafts();
   const openEditor=await db.value.draft.get(id);
   Object.defineProperty(navigator,'onLine',{value:true});
   http.post.mockRejectedValueOnce({code:404,message:'Original message not found.'});await syncCloudDrafts();
   expect(await db.value.draft.get(id)).toMatchObject({dirty:false,sendType:'',emailId:0,content:'<p>Hello</p>'});
   await saveLocalDraft({...openEditor,subject:'Typed after Undo',attachments:[]});await syncCloudDrafts();
   expect([...state.remote.values()]).toMatchObject([{subject:'Typed after Undo',sendType:'',emailId:0}]);
 });
 it('propagates discard tombstones and never recreates a remotely removed clean draft',async()=>{
  const row=await saveLocalDraft(input());await syncCloudDrafts();await removeLocalDraft(row.draftId);await syncCloudDrafts();expect(state.rows.size).toBe(0);expect(state.remote.size).toBe(0);
 });
 it('recovers a lost successful send response by checking the persisted attempt',async()=>{
  const row=await saveLocalDraft(input());await syncCloudDrafts();const original=http.post.getMockImplementation();http.post.mockImplementationOnce(async(...args)=>{await original(...args);throw new Error('Reply lost');});
  await expect(sendCloudDraft(row.draftId)).rejects.toThrow('Reply lost');expect((await db.value.draft.get(row.draftId)).sendAttemptId).toBeTruthy();
  expect(await sendCloudDraft(row.draftId)).toEqual([{emailId:100,subject:'Draft'}]);expect(state.rows.size).toBe(0);expect(http.post.mock.calls.filter(([path])=>path.endsWith('/send'))).toHaveLength(1);
 });
 it('replays a lost scheduling confirmation without uploading or sending a second draft',async()=>{
   const row=await saveLocalDraft(input());await syncCloudDrafts();
   const when=Math.floor(Date.now()/1000)+3600,original=http.post.getMockImplementation();let scheduledTimes=0;
   http.post.mockImplementation(async(path,data,...args)=>{
     if(!path.endsWith('/schedule'))return original(path,data,...args);
     const remote=state.remote.get(1);
     if(remote.state==='scheduled'){
       expect(data).toEqual({version:1,sendAt:when});
       return {draftId:1,version:2,sendAt:when};
     }
     scheduledTimes++;remote.state='scheduled';remote.version++;remote.scheduledAt=when;
     state.events.push({seq:state.events.length+1,draftId:1,operation:'delete'});
     throw new Error('Connection closed before response');
   });
   expect(await scheduleCloudDraft(row.draftId,when)).toEqual({pending:true});
   const pending=await db.value.draft.get(row.draftId);
   await expect(saveLocalDraft({...pending,subject:'Stale editor'})).rejects.toThrow('changed');
   await expect(sendCloudDraft(row.draftId)).rejects.toThrow('Scheduled');
   await syncCloudDrafts();expect(scheduledTimes).toBe(1);expect(state.rows.size).toBe(0);expect(state.remote.size).toBe(1);
 });
 it('keeps a delayed scheduling rejection visible on the editable draft',async()=>{
   const row=await saveLocalDraft(input());await syncCloudDrafts();
   http.post.mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce({code:400,message:'Choose a future send time.'});
   expect(await scheduleCloudDraft(row.draftId,Math.floor(Date.now()/1000)+20)).toEqual({pending:true});
   await syncCloudDrafts();
   const restored=await db.value.draft.get(row.draftId);
   expect(restored).toMatchObject({pendingSchedule:null,schedulingError:'Choose a future send time.',subject:'Draft'});
   const {draftSummary}=await import('../src/utils/draft-summary');
   expect(draftSummary(restored).preview).toMatch(/Scheduling failed/);
 });
 it('preserves newer edits when recovering an earlier successful send',async()=>{
  const row=await saveLocalDraft(input());await syncCloudDrafts();const original=http.post.getMockImplementation();http.post.mockImplementationOnce(async(...args)=>{await original(...args);throw new Error('Reply lost');});
  await expect(sendCloudDraft(row.draftId)).rejects.toThrow('Reply lost');
  await saveLocalDraft({...await db.value.draft.get(row.draftId),subject:'Newer unsent edits',attachments:[]});
  await expect(sendCloudDraft(row.draftId)).rejects.toThrow('newer edits are preserved');
  expect(state.rows.size).toBe(1);expect([...state.rows.values()][0]).toMatchObject({subject:'Newer unsent edits',dirty:true});expect([...state.rows.values()][0].cloudDraftId).toBeUndefined();
 });

});

it('advances the displayed date when an old draft is edited locally', async () => {
  const old = await saveLocalDraft({accountId:1,subject:'First',content:'<p>Original</p>',createTime:'2020-01-01 08:00:00',updatedAt:'2020-01-01 08:00:00'});
  const updated = await saveLocalDraft({...old, content:'<p>Edited</p>'});
  expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(old.createTime));
  const {userDraftStore} = await import('../src/store/draft.js');
  expect(userDraftStore().items[0]).toMatchObject({draftId:old.draftId,preview:'Edited'});
});
