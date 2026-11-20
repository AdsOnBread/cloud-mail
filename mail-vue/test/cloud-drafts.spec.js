import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {saveLocalDraft,syncCloudDrafts,removeLocalDraft,sendCloudDraft} from '../src/services/cloud-drafts';
import db from '../src/db/db';
import http from '../src/axios';
const state=vi.hoisted(()=>({rows:new Map(),files:new Map(),meta:new Map(),remote:new Map(),events:[],next:1,cloudNext:1,attempts:new Map()}));
vi.mock('../src/db/db',()=>{
 const table=(rows,key)=>({get:async id=>structuredClone(rows.get(id)),toArray:async()=>structuredClone([...rows.values()]),put:async row=>{rows.set(row[key],structuredClone(row));return row[key];},add:async row=>{const id=state.next++;rows.set(id,structuredClone({...row,[key]:id}));return id;},delete:async id=>rows.delete(id)});
 return {default:{value:{draft:table(state.rows,'draftId'),att:table(state.files,'draftId'),meta:table(state.meta,'key'),transaction:async(...args)=>args.at(-1)()}}};
});
vi.mock('../src/axios',()=>({default:{get:vi.fn(),post:vi.fn(),put:vi.fn(),delete:vi.fn()}}));
function event(remote){state.events.push({seq:state.events.length+1,draftId:remote.draftId,operation:'upsert',draft:structuredClone(remote)});}
const input=extra=>({accountId:1,subject:'Draft',content:'<p>Hello</p>',text:'Hello',receiveEmail:['person@example.net'],cc:[],bcc:[],attachments:[],...extra});
beforeEach(()=>{
 setActivePinia(createPinia());for(const map of [state.rows,state.files,state.meta,state.remote,state.attempts])map.clear();state.events=[];state.next=1;state.cloudNext=1;
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
 it('preserves both versions on conflict and points the editor at its saved copy',async()=>{
  const row=await saveLocalDraft(input());await syncCloudDrafts();const local=await db.value.draft.get(row.draftId),remote=state.remote.get(local.cloudDraftId);remote.subject='Edited on iOS';remote.version++;event(remote);
  await saveLocalDraft({...local,subject:'My browser edits',attachments:[]});const result=await syncCloudDrafts();
  expect(result.conflicts[row.draftId]).toBeTruthy();expect([...state.rows.values()].map(r=>r.subject).sort()).toEqual(['Edited on iOS','My browser edits']);
  await syncCloudDrafts();expect(state.remote.size).toBe(2);
 });
 it('does not mark changes typed during an upload as synchronized',async()=>{
  const row=await saveLocalDraft(input());let release;const original=http.post.getMockImplementation();http.post.mockImplementationOnce(async(...args)=>{await new Promise(resolve=>release=resolve);return original(...args);});
  const syncing=syncCloudDrafts();while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  await saveLocalDraft({...await db.value.draft.get(row.draftId),subject:'Typed during upload',attachments:[]});release();await syncing;
  expect((await db.value.draft.get(row.draftId)).dirty).toBe(true);await syncCloudDrafts();expect([...state.remote.values()][0].subject).toBe('Typed during upload');
 });
 it('propagates discard tombstones and never recreates a remotely removed clean draft',async()=>{
  const row=await saveLocalDraft(input());await syncCloudDrafts();await removeLocalDraft(row.draftId);await syncCloudDrafts();expect(state.rows.size).toBe(0);expect(state.remote.size).toBe(0);
 });
 it('recovers a lost successful send response by checking the persisted attempt',async()=>{
  const row=await saveLocalDraft(input());await syncCloudDrafts();const original=http.post.getMockImplementation();http.post.mockImplementationOnce(async(...args)=>{await original(...args);throw new Error('Reply lost');});
  await expect(sendCloudDraft(row.draftId)).rejects.toThrow('Reply lost');expect((await db.value.draft.get(row.draftId)).sendAttemptId).toBeTruthy();
  expect(await sendCloudDraft(row.draftId)).toEqual([{emailId:100,subject:'Draft'}]);expect(state.rows.size).toBe(0);expect(http.post.mock.calls.filter(([path])=>path.endsWith('/send'))).toHaveLength(1);
 });
 it('preserves newer edits when recovering an earlier successful send',async()=>{
  const row=await saveLocalDraft(input());await syncCloudDrafts();const original=http.post.getMockImplementation();http.post.mockImplementationOnce(async(...args)=>{await original(...args);throw new Error('Reply lost');});
  await expect(sendCloudDraft(row.draftId)).rejects.toThrow('Reply lost');
  await saveLocalDraft({...await db.value.draft.get(row.draftId),subject:'Newer unsent edits',attachments:[]});
  await expect(sendCloudDraft(row.draftId)).rejects.toThrow('newer edits are preserved');
  expect(state.rows.size).toBe(1);expect([...state.rows.values()][0]).toMatchObject({subject:'Newer unsent edits',dirty:true});expect([...state.rows.values()][0].cloudDraftId).toBeUndefined();
 });

});
