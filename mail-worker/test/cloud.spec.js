import {readContact,setContact} from '../src/cloud/contacts';
import {saveFilter,previewFilter,listFilters,deleteFilter} from '../src/cloud/message-filters';
import {env,createExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {dbInit} from '../src/init/init';
import * as drafts from '../src/cloud/drafts';
import * as mail from '../src/cloud/mail';
import emailService from '../src/service/email-service';
import {send,prepare,undoSend,dispatchHeld,recoverHeld} from '../src/cloud/send';
import * as mobile from '../src/mobile/service';
import settingService from '../src/service/setting-service';
import cryptoUtils from '../src/utils/crypto-utils';
import worker from '../src/index';
import loginService from '../src/service/login-service';
import {parseHTML} from 'linkedom';
const bindings=()=>({...env,app_access_secret:'test-installation-secret',init_secret:'test-init',mcp_public_url:'https://mail.example.com/mcp'});
const c=()=>({env:bindings(),get:k=>k==='user'?{userId:1,email:'admin@example.com'}:undefined,set:()=>{},req:{header:()=>undefined},text:s=>s});
const message=async(extra={})=>{const row={user_id:1,account_id:1,subject:'Original',send_email:'outside@example.net',recipient:'[{"address":"admin@example.com"},{"address":"copy@example.net"}]',cc:'[{"address":"cc@example.net"}]',bcc:'[{"address":"hidden@example.net"}]',text:'Original body',content:'<p>Original body</p>',message_id:'<original@example.net>',...extra};return env.db.prepare(`INSERT INTO email(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')}) RETURNING *`).bind(...Object.values(row)).first();};
const draft=extra=>drafts.save(c(),1,{clientId:crypto.randomUUID(),accountId:1,subject:'Draft',content:'<p>Hello</p>',text:'Hello',receiveEmail:['person@example.com'],...extra});
beforeEach(async()=>{
 vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
 await dbInit.init(c());const pwd=await cryptoUtils.hashPassword('test-password');
 await env.db.prepare('INSERT INTO user(user_id,email,password,salt) VALUES(1,?,?,?),(2,?,?,?)').bind('admin@example.com',pwd.hash,pwd.salt,'person@example.com',pwd.hash,pwd.salt).run();
 await env.db.prepare("INSERT INTO account(account_id,email,user_id) VALUES(1,'admin@example.com',1),(2,'person@example.com',2),(3,'alias@example.com',1)").run();
 await env.db.prepare('UPDATE setting SET send=0').run();await settingService.refresh(c());
});
afterEach(()=>vi.restoreAllMocks());
it('keeps saved contacts with the sending mailbox and includes their names in autocomplete',async()=>{
  const person={accountId:1,email:'Person@Example.net',name:'Casey Rivera',saved:true};
  const search={accountId:1,field:'any',folder:'compose',q:'Rivera'};
  await setContact(c(),1,person);
  expect(await readContact(c(),1,{...person,email:'person@example.net'})).toEqual({email:person.email,name:person.name});
  expect(await mail.searchPeople(c(),1,search)).toEqual([{email:person.email,name:person.name}]);
  expect(await mail.searchPeople(c(),1,{...search,accountId:3})).toEqual([]);
  expect(await mail.searchPeople(c(),2,search)).toEqual([]);
  await expect(setContact(c(),2,person)).rejects.toThrow('Mailbox not found');
  await setContact(c(),1,{...person,saved:false});
  expect(await readContact(c(),1,person)).toBeNull();
  expect(await mail.searchPeople(c(),1,search)).toEqual([]);
  await setContact(c(),1,person);
  await setContact(c(),1,{...person,accountId:3});
  await env.db.prepare('DELETE FROM account WHERE account_id=3').run();
  expect(await env.db.prepare('SELECT email FROM mailbox_contacts WHERE account_id=3').first()).toBeNull();
  expect(await readContact(c(),1,person)).toBeTruthy();
  await drafts.deleteUserData(c(),[1]);
  expect(await readContact(c(),1,person)).toBeNull();
});
describe('Incoming mail filters',()=>{
 const db=env.db;
 const create=(criteria,actions,extra={})=>saveFilter(db,1,crypto.randomUUID(),{version:0,criteria,actions,...extra});
 it('previews and files existing mail only on request, then files future received copies across owned aliases',async()=>{
   const original=await message(), label=await db.prepare("INSERT INTO mailbox_labels(user_id,name) VALUES(1,'Team') RETURNING label_id").first();
   const criteria={from:'outside@example.net',subject:'Origi',words:'Original body',excluded:'unrelated',to:'copy@example.net'};
   expect(await previewFilter(db,1,criteria)).toEqual({conversations:1});
   const actions={read:true,star:true,archive:true,category:'updates',important:false,labelId:label.label_id};
   const r=await create(criteria,actions);
   expect((await db.prepare('SELECT unread FROM email WHERE email_id=?').bind(original.email_id).first()).unread).toBe(0);
   await message({account_id:2,user_id:2});await message({type:1});const alias=await message({account_id:3});
   const changed=await saveFilter(db,1,r.id,{version:r.version,criteria,actions,applyExisting:true});
   expect(changed.version).toBe(2);
   const rows=(await db.prepare('SELECT email_id FROM email WHERE unread=1 ORDER BY email_id').all()).results;
   expect(rows.map(r=>r.email_id)).toEqual([original.email_id,alias.email_id]);
   for (const table of ['star','conversation_filing','mailbox_categories','mailbox_importance','mailbox_label_members'])
     expect((await db.prepare('SELECT email_id FROM '+table+' ORDER BY email_id').all()).results).toEqual(rows);
   expect(await previewFilter(db,1,{to:'hidden@example.net'})).toEqual({conversations:0});
   expect((await listFilters(db,2))).toEqual([]);
   await expect(deleteFilter(db,2,r.id,2)).rejects.toMatchObject({code:409});
   await expect(saveFilter(db,1,r.id,{version:1,criteria,actions})).rejects.toMatchObject({code:409});
   await deleteFilter(db,1,r.id,2);
   const after=await message();expect((await db.prepare('SELECT unread FROM email WHERE email_id=?').bind(after.email_id).first()).unread).toBe(0);
 });
 it('waits for completed mail and real attachments, and never files hidden, sent, or unrelated messages',async()=>{
   await create({hasAttachment:true},{read:true,star:true});
   const incoming=await message({status:6,is_del:1}),local=await message({status:6,is_del:1}),sent=await message({type:1});
   const file=(id,disposition)=>db.prepare("INSERT INTO attachments(user_id,email_id,account_id,key,type,disposition) VALUES(1,?,1,'k',0,?)").bind(id,disposition).run();
   await file(incoming.email_id,'attachment');await file(local.email_id,'inline');await file(sent.email_id,'attachment');
   expect((await db.prepare('SELECT count(*) n FROM star').first()).n).toBe(0);
   await emailService.completeReceive(c(),0,incoming.email_id);await file(local.email_id,'attachment');await file(local.email_id,'attachment');await emailService.completeReceive(c(),0,local.email_id);
   expect((await db.prepare('SELECT email_id FROM star ORDER BY email_id').all()).results).toEqual([{email_id:incoming.email_id},{email_id:local.email_id}]);
   expect((await db.prepare('SELECT count(*) n FROM mail_filter_hits').first()).n).toBe(0);
 });
 it('matches partial addresses, visible HTML text and thread counts without indexing markup',async()=>{
   const html={text:'',content:'<p>Project <b>invoice</b></p><script>invisible</script>'};
   const original=await message(html);await message({...html,in_reply_to:original.message_id,message_id:'<followup@example.net>'});
   expect(await previewFilter(db,1,{from:'@example.net',to:'copy@',words:'invoice',excluded:'invisible'})).toEqual({conversations:1});
   await create({from:'outside@',words:'invoice',excluded:'invisible'},{archive:true},{applyExisting:true});
   const arrived=await message({...html,status:6,is_del:1});await emailService.completeReceive(c(),0,arrived.email_id);
   expect((await db.prepare('SELECT count(*) n FROM conversation_filing').first()).n).toBe(3);
   expect((await db.prepare('SELECT count(*) n FROM mail_filter_bodies').first()).n).toBe(0);
   expect((await db.prepare("SELECT count(*) n FROM mobile_changes WHERE entity_id=? AND entity='message' AND operation='upsert'").bind(arrived.email_id).first()).n).toBeGreaterThan(1);
 });
 it('converts recipient and whole-word exclusions without widening or narrowing the search',async()=>{
   await message({name:'Émile',recipient:'robin@example.net',text:'A partial report'});
   expect(await previewFilter(db,1,{from:'émile',to:'robin@example.net',words:'robin',excluded:'art'})).toEqual({conversations:1});
   expect(await previewFilter(db,1,{excluded:'robin'})).toEqual({conversations:0});
   await create({excluded:'art robin'},{star:true});
   await message({name:'Robin',text:'Partial'});const visible=await message({recipient:'[]',text:'Partial'});
   expect((await db.prepare('SELECT email_id FROM star').all()).results).toEqual([{email_id:visible.email_id}]);
 });
 it('searches named groups and fences a bulk save against mail that arrives after preparation',async()=>{
   const group=await message({recipient:JSON.stringify([{name:'Team',group:[{address:'alix@example.net'}]}])});
   expect(await previewFilter(db,1,{to:'alix@example.net'})).toEqual({conversations:1});
   expect(await previewFilter(db,1,{excluded:'alix'})).toEqual({conversations:0});
   let inject=true;
   const fenced={prepare:sql=>db.prepare(sql),batch:async statements=>{
     if(inject){inject=false;await message({text:'',content:'<b>finance</b>'});}
     return db.batch(statements);
   }};
   const id=crypto.randomUUID(),input={version:0,criteria:{excluded:'finance'},actions:{read:true},applyExisting:true};
   expect(await saveFilter(fenced,1,id,input)).toEqual({preparing:true});
   expect(await listFilters(db,1)).toEqual([]);
   await saveFilter(db,1,id,input);
   expect((await db.prepare('SELECT email_id FROM email WHERE unread=1').all()).results).toEqual([{email_id:group.email_id}]);
 });
 it('applies conflicting attachment and sender rules in creation order to a real local delivery',async()=>{
   await saveFilter(db,2,crypto.randomUUID(),{version:0,criteria:{hasAttachment:true},actions:{category:'updates'}});
   await saveFilter(db,2,crypto.randomUUID(),{version:0,criteria:{from:'admin@example.com'},actions:{category:'promotions',read:true}});
   const saved=await draft({receiveEmail:['person@example.com'],text:'',content:'<b>Only HTML</b>',attachments:[{filename:'report.txt',content:'SGVsbG8=',contentType:'text/plain'}]});
   await send(c(),1,{version:saved.version,idempotencyKey:'test-filter-local'},{draftId:saved.draftId});
   expect(await db.prepare('SELECT m.category,e.unread FROM email e JOIN mailbox_categories m ON m.email_id=e.email_id WHERE e.user_id=2').first()).toEqual({category:'promotions',unread:1});
 });
 it('keeps label ownership and empty criteria out of saved rules',async()=>{
   const label=await db.prepare("INSERT INTO mailbox_labels(user_id,name) VALUES(2,'Private') RETURNING label_id").first();
   await expect(create({from:'x'},{labelId:label.label_id})).rejects.toMatchObject({code:404});
   await expect(create({from:'x',scope:'trash'},{read:true})).rejects.toMatchObject({code:400});
   await expect(create({},{read:true})).rejects.toMatchObject({code:400});
   await expect(create({from:'x'},{})).rejects.toMatchObject({code:400});
 });
});
describe('General mail settings',()=>{
 it('enables hover actions on upgrade without changing an existing preference revision',async()=>{
   const {ensureGeneralPreferenceColumns}=await import('../src/cloud/schema');
   const {readGeneralSettings}=await import('../src/cloud/general-settings');
   await env.db.prepare('ALTER TABLE mail_general_settings DROP COLUMN hover_actions').run();
   await env.db.prepare('INSERT INTO mail_general_settings(user_id,version,undo_seconds,reply_all,keyboard_shortcuts) VALUES(1,4,30,1,1)').run();
   const columns=async()=>(await env.db.prepare('PRAGMA table_info(mail_general_settings)').all()).results;
   const execute=sql=>env.db.prepare(sql).run();
   await ensureGeneralPreferenceColumns(columns,execute);
   await ensureGeneralPreferenceColumns(columns,execute);
   expect(await readGeneralSettings(env.db,1)).toEqual({version:4,undoSeconds:30,replyAll:true,keyboardShortcuts:true,hoverActions:true});
 });
 it('commits both forms together and preserves both when either revision is stale',async()=>{
   const {saveGeneralSettings,readGeneralSettings}=await import('../src/cloud/general-settings');
   const {saveSignatures,readSignatures}=await import('../src/cloud/signatures');
   const initial={version:0,undoSeconds:10,replyAll:false,keyboardShortcuts:true,hoverActions:false,signatures:{
     version:0,items:[{id:'work',name:'Work',html:'<b>First</b><script>ignored()</script>'}],defaults:{},beforeQuote:false}};
   const first=await saveGeneralSettings(env.db,1,initial);
   expect(first.signatures).toMatchObject({version:1,items:[{html:'<b>First</b>'}]});
   const {keyboardShortcuts,hoverActions,...legacy}=first;
   expect(keyboardShortcuts).toBe(true);expect(hoverActions).toBe(false);
   const second=await saveGeneralSettings(env.db,1,{...legacy,replyAll:true});
   expect(second.version).toBe(2);expect(second.signatures.version).toBe(2);
   const newer=await saveSignatures(env.db,1,{...second.signatures,beforeQuote:true});
   await expect(saveGeneralSettings(env.db,1,{...second,undoSeconds:30})).rejects.toMatchObject({code:409});
   await expect(saveGeneralSettings(env.db,1,{...first,signatures:newer})).rejects.toMatchObject({code:409});
   expect(await readGeneralSettings(env.db,1)).toEqual({version:2,undoSeconds:10,replyAll:true,keyboardShortcuts:true,hoverActions:false});
   expect(await readSignatures(env.db,1)).toEqual(newer);
   expect((await readSignatures(env.db,2)).version).toBe(0);
 });
 it('preserves enabled keyboard shortcuts when an older client saves preferences alone',async()=>{
   const {saveGeneralSettings,readGeneralSettings}=await import('../src/cloud/general-settings');
   const prefs={version:0,replyAll:false,undoSeconds:5};
   await saveGeneralSettings(env.db,1,{...prefs,keyboardShortcuts:true,hoverActions:false});
   await saveGeneralSettings(env.db,1,{...prefs,version:1,undoSeconds:10});
   await expect(saveGeneralSettings(env.db,1,{...prefs,version:2,keyboardShortcuts:'false'})).rejects.toMatchObject({code:400});
   await expect(saveGeneralSettings(env.db,1,{...prefs,version:2,hoverActions:0})).rejects.toMatchObject({code:400});
   expect(await readGeneralSettings(env.db,1)).toEqual({version:2,undoSeconds:10,replyAll:false,keyboardShortcuts:true,hoverActions:false});
 });
 it('rejects stale edits, keeps preferences per user, and removes them on deletion',async()=>{
   const {saveGeneralSettings,readGeneralSettings}=await import('../src/cloud/general-settings');
   const input={version:0,undoSeconds:30,replyAll:true};
   expect(await saveGeneralSettings(env.db,1,input)).toEqual({...input,version:1,keyboardShortcuts:false,hoverActions:true});
   await expect(saveGeneralSettings(env.db,1,input)).rejects.toMatchObject({code:409});
   await expect(saveGeneralSettings(env.db,1,{...input,version:1,undoSeconds:6})).rejects.toMatchObject({code:400});
   const updated=await saveGeneralSettings(env.db,1,{...input,version:1,undoSeconds:20});
   expect(await readGeneralSettings(env.db,1)).toEqual(updated);
   expect(await readGeneralSettings(env.db,2)).toEqual({version:0,undoSeconds:null,replyAll:false,keyboardShortcuts:false,hoverActions:true});
   const d=await draft({}), req={version:d.version,idempotencyKey:'account-undo-period',undoSeconds:5}, start=Date.now();
   const held=await send(c(),1,req,{draftId:d.draftId});
   expect(held.undoUntil).toBeGreaterThanOrEqual(start+20000);
   await saveGeneralSettings(env.db,1,{...input,version:2});
   expect(await send(c(),1,req,{draftId:d.draftId})).toEqual(held);
   await drafts.deleteUserData(c(),[1]);
   expect((await readGeneralSettings(env.db,1)).version).toBe(0);
 });
});
describe('System label visibility',()=>{
 it('keeps folder choices per user and validates the available modes',async()=>{
   const {systemLabels,setSystemLabel}=await import('../src/cloud/system-labels');
   await setSystemLabel(env.db,1,'trash','show');await setSystemLabel(env.db,1,'draft','unread');
   await setSystemLabel(env.db,1,'trash','hide');
   expect(await systemLabels(env.db,1)).toEqual({draft:'unread',trash:'hide'});
   expect(await systemLabels(env.db,2)).toEqual({});
   await setSystemLabel(env.db,1,'updates','show');
   await setSystemLabel(env.db,1,'messages-updates','hide');
   await setSystemLabel(env.db,1,'purchases','hide');
   expect(await systemLabels(env.db,1)).toMatchObject({updates:'show','messages-updates':'hide',purchases:'hide'});
   expect(await systemLabels(env.db,2)).toEqual({});
   await expect(setSystemLabel(env.db,1,'messages-purchases','show')).rejects.toMatchObject({code:400});
   await expect(setSystemLabel(env.db,1,'social','unread')).rejects.toMatchObject({code:400});
   await drafts.deleteUserData(c(),[1]);expect(await systemLabels(env.db,1)).toEqual({});
   await expect(setSystemLabel(env.db,1,'trash','unread')).rejects.toMatchObject({code:400});
   await expect(setSystemLabel(env.db,1,'email','hide')).rejects.toMatchObject({code:400});
 });
});
describe('Cloud drafts',()=>{
 it('migrates repeatably, imports once, permits incomplete drafts and isolates owners',async()=>{
   const d=await draft({subject:'',content:'',receiveEmail:[]});
   expect((await drafts.save(c(),1,{clientId:d.clientId,accountId:1,subject:'ignored'})).draftId).toBe(d.draftId);
   await expect(drafts.get(c(),2,d.draftId)).rejects.toMatchObject({code:404});
   await expect(drafts.save(c(),1,{accountId:2})).rejects.toMatchObject({code:404});
   await dbInit.init(c());expect((await drafts.list(c(),1)).drafts).toHaveLength(1);
 });
 it('fences stale edits and sends deletion tombstones without resurrection',async()=>{
   const d=await draft();const changed=await drafts.save(c(),1,{version:d.version,subject:'Changed'},d.draftId);
   await expect(drafts.save(c(),1,{version:d.version,subject:'Stale'},d.draftId)).rejects.toMatchObject({code:409,current:{subject:'Changed'}});
   const before=await drafts.changes(c(),1);
   await drafts.remove(c(),1,d.draftId,changed.version);
   expect((await drafts.changes(c(),1,{after:before.cursor})).changes[0].operation).toBe('delete');
   expect((await drafts.save(c(),1,{clientId:d.clientId,accountId:1,subject:'Retry import'})).state).toBe('deleted');
 });
 it('stores binary attachments privately, replaces them atomically and rejects foreign IDs',async()=>{
   const d=await draft({attachments:[{filename:'binary.bin',content:'AAECA/8=',contentType:'application/octet-stream'}]});
   const f=d.attachments[0];expect(f.size).toBe(5);
   const {object}=await drafts.file(c(),1,f.attachmentId);expect([...new Uint8Array(await new Response(object.body||object).arrayBuffer())]).toEqual([0,1,2,3,255]);
   await expect(drafts.file(c(),2,f.attachmentId)).rejects.toMatchObject({code:404});
   await expect(draft({attachments:[f]})).rejects.toMatchObject({code:404});
   const updated=await drafts.save(c(),1,{version:d.version,attachments:[f]},d.draftId);expect(updated.attachments[0].attachmentId).toBe(f.attachmentId);
   await drafts.remove(c(),1,d.draftId,updated.version);await expect(drafts.file(c(),1,f.attachmentId)).rejects.toMatchObject({code:404});
 });
 it('limits automatic text samples to the first kilobyte and checks attachment ownership before reading',async()=>{
   const content='a'.repeat(1024)+'last lines';
   const d=await draft({attachments:[{filename:'draft.txt',content:btoa(content),contentType:'text/plain'}]});
   const file=d.attachments[0],original=await message();
   const {default:storage}=await import('../src/service/r2-service');
   const key='attachments/text-sample.txt';
   await storage.putObj(c(),key,new TextEncoder().encode(content),{contentType:'text/plain'});
   const row=await env.db.prepare("INSERT INTO attachments(user_id,email_id,account_id,key,filename,mime_type) VALUES(1,?,1,?,'source.txt','text/plain') RETURNING att_id").bind(original.email_id,key).first();
   const read=async result=>{const {object}=await result;return new Response(object.body||object).text();};
   for (const get of [(uid,sample)=>drafts.file(c(),uid,file.attachmentId,sample),(uid,sample)=>mail.attachment(c(),uid,row.att_id,sample)]) {
     expect(await read(get(1,true))).toBe(content.slice(0,1024));
     expect(await read(get(1,false))).toBe(content);
     await expect(get(2,true)).rejects.toMatchObject({code:404});
   }
 });
 it('reads small and empty thumbnail samples from R2 and KV',async()=>{
   const {default:storage}=await import('../src/service/r2-service');
   const {default:kv}=await import('../src/service/kv-obj-service');
   for (const store of [storage,kv]) {
     for (const content of ['', 'abc', 'z'.repeat(2048)]) {
       await store.putObj(c(),'attachments/sample',new TextEncoder().encode(content),{contentType:'text/plain'});
       const sample=await store.getObj(c(),'attachments/sample',1024);
       expect(await new Response(sample.body || sample).text()).toBe(content.slice(0,1024));
     }
   }
 });
 it('allows only one concurrent draft writer',async()=>{
   const d=await draft();const edits=await Promise.allSettled(['A','B'].map(subject=>drafts.save(c(),1,{version:d.version,subject},d.draftId)));
   expect(edits.filter(e=>e.status==='fulfilled')).toHaveLength(1);
   expect(edits.find(e=>e.status==='rejected').reason.code).toBe(409);
 });
});
describe('Send attempts',()=>{
 it('cancels a held delivery idempotently and restores the exact editable draft',async()=>{
   const draftRow=await draft({bcc:['person@example.com'],labelIds:[]});
   const input={version:draftRow.version,idempotencyKey:'held-cancel-test',undoSeconds:5};
   const held=await send(c(),1,input,{draftId:draftRow.draftId});
   expect(held.state).toBe('holding');
   expect(await send(c(),1,input,{draftId:draftRow.draftId})).toEqual(held);
   await expect(undoSend(c(),2,held.attemptId)).rejects.toMatchObject({code:409});
   await dispatchHeld(c(),1,held.attemptId);
   expect((await drafts.list(c(),1)).drafts).toHaveLength(0);
   const canceled=await undoSend(c(),1,held.attemptId);
   expect(await undoSend(c(),1,held.attemptId)).toEqual(canceled);
   await recoverHeld(c());
   expect((await env.db.prepare('SELECT COUNT(*) n FROM email').first()).n).toBe(0);
   expect(await drafts.get(c(),1,draftRow.draftId)).toMatchObject({state:'draft',bcc:['person@example.com'],version:draftRow.version+2});
 });
 it('recovers an expired hold with no browser and fences concurrent dispatch and late Undo',async()=>{
   const draftRow=await draft();
   const held=await send(c(),1,{version:draftRow.version,idempotencyKey:'held-recover-test',undoSeconds:5},{draftId:draftRow.draftId});
   await env.db.prepare("UPDATE send_attempts SET result=json_set(result,'$.undoUntil',1) WHERE idempotency_key=?").bind(held.attemptId).run();
   await expect(undoSend(c(),1,held.attemptId)).rejects.toMatchObject({code:409});
   await Promise.all([dispatchHeld(c(),1,held.attemptId),recoverHeld(c())]);
   expect((await env.db.prepare('SELECT COUNT(*) n FROM email WHERE type=1').first()).n).toBe(1);
   const receipt=await env.db.prepare('SELECT state,result FROM send_attempts WHERE idempotency_key=?').bind(held.attemptId).first();
   expect(receipt.state).toBe('sent');
   expect(JSON.parse(receipt.result).messages[0].emailId).toBeGreaterThan(0);
 });
 it('recovers an interrupted preparation before any provider dispatch',async()=>{
   const d=await draft();
   const hold=await send(c(),1,{version:d.version,idempotencyKey:'interrupted-prepare',undoSeconds:30},{draftId:d.draftId});
   await env.db.prepare("UPDATE send_attempts SET result=json_set(result,'$.undoUntil',1) WHERE idempotency_key=?").bind(hold.attemptId).run();
   let entered, release;
   const waiting=new Promise(done=>{entered=done;});
   const original=emailService.send.bind(emailService);
   vi.spyOn(emailService,'send').mockImplementationOnce(async (...args)=>{
     entered();await new Promise(done=>{release=done;});return original(...args);
   });
   const stalled=dispatchHeld(c(),1,hold.attemptId);
   await waiting;
   expect((await env.db.prepare('SELECT state FROM send_attempts WHERE idempotency_key=?').bind(hold.attemptId).first()).state).toBe('holding');
   try { await recoverHeld(c()); } finally {release();await stalled;}
   expect((await env.db.prepare('SELECT COUNT(*) n FROM email WHERE type=1').first()).n).toBe(1);
 });
 it('retains the reason for a failed held delivery in its editable cloud draft',async()=>{
   const d=await draft({receiveEmail:['outside@example.net']});
   const hold=await send(c(),1,{version:d.version,idempotencyKey:'failed-undo-send',undoSeconds:5},{draftId:d.draftId});
   await env.db.prepare("UPDATE send_attempts SET result=json_set(result,'$.undoUntil',1) WHERE idempotency_key=?").bind(hold.attemptId).run();
   await recoverHeld(c());
   const saved=await drafts.get(c(),1,d.draftId);
   expect(saved.state).toBe('draft');expect(saved.deliveryError).toBeTruthy();
   expect((await drafts.save(c(),1,{version:saved.version,subject:'Edited'},d.draftId)).deliveryError).toBeUndefined();
 });
 it('sends a saved draft once, replays its result and refuses changed key reuse',async()=>{
   const d=await draft();const input={version:d.version,idempotencyKey:'send-draft-0001'};
   const sent=await send(c(),1,input,{draftId:d.draftId});expect(sent.state).toBe('sent');
   expect(await send(c(),1,input,{draftId:d.draftId})).toEqual(sent);
   expect((await env.db.prepare('SELECT COUNT(*) total FROM email WHERE type=1').first()).total).toBe(1);
   await expect(send(c(),1,{...input,version:2},{draftId:d.draftId})).rejects.toMatchObject({code:409});
   await expect(drafts.get(c(),1,d.draftId)).rejects.toMatchObject({code:404});
 });
 it('claims a draft atomically across clients and preserves a failed draft',async()=>{
   const d=await draft({subject:'Invalid\nheader'});const result=await send(c(),1,{version:d.version,idempotencyKey:'failed-draft-001'},{draftId:d.draftId});expect(result.state).toBe('failed');
   expect((await drafts.get(c(),1,d.draftId)).state).toBe('draft');
   const fixed=await drafts.save(c(),1,{version:(await drafts.get(c(),1,d.draftId)).version,subject:'Fixed'},d.draftId);
   const results=await Promise.allSettled(['concurrent-key-a','concurrent-key-b'].map(idempotencyKey=>send(c(),1,{version:fixed.version,idempotencyKey},{draftId:d.draftId})));
   expect(results.filter(r=>r.status==='fulfilled'&&r.value.state==='sent')).toHaveLength(1);
 });
 it('keeps a draft editable after a configuration failure before dispatch',async()=>{
   const d=await draft({receiveEmail:['outside@example.net']});
   const result=await send(c(),1,{version:d.version,idempotencyKey:'unconfigured-sender-1'},{draftId:d.draftId});
   expect(result.state).toBe('failed');expect((await drafts.get(c(),1,d.draftId)).state).toBe('draft');
 });
 it('does not retry an ambiguous provider failure' ,async()=>{
   const context=c();context.env.email={send:vi.fn().mockRejectedValue(new Error('connection lost'))};
   const input={accountId:1,subject:'External',content:'<p>Hello</p>',receiveEmail:['outside@example.net'],idempotencyKey:'uncertain-send-1'};
   expect((await send(context,1,input)).state).toBe('uncertain');expect((await send(context,1,input)).state).toBe('uncertain');expect(context.env.email.send).toHaveBeenCalledTimes(1);
 });
 it('honors explicit blind-copy-only reply addresses and preserves the hidden field on a sent reply',async()=>{
   const source = await message();
   const explicit = await prepare(c(),1,{accountId:1,emailId:source.email_id,subject:'',bcc:['chosen@example.com']},'reply');
   const ordinary = await prepare(c(),1,{accountId:1,emailId:source.email_id,cc:[],bcc:[]},'reply');
   expect(ordinary.receiveEmail).toEqual([source.send_email]);
   expect(explicit.receiveEmail || []).toEqual([]);
   expect(explicit).toMatchObject({subject:'',bcc:['chosen@example.com']});
   const sent = await message({type:1,recipient:'[]',cc:'[]',bcc:'[{"address":"private@example.com"}]'});
   for (const replyAll of [true,false]) {
     const ordinary=await prepare(c(),1,{accountId:1,emailId:sent.email_id,replyAll},'reply');
     expect(ordinary.bcc).toEqual([]);
     const reply=await prepare(c(),1,{accountId:1,emailId:sent.email_id,replyAll,reuseBlindRecipients:true},'reply');
     expect(reply).toMatchObject({receiveEmail:[],cc:[],bcc:['private@example.com']});
   }
 });
 it('prepares reply-all without aliases or Bcc and forwards ordinary files independently',async()=>{
   const original=await message({recipient:JSON.stringify([{name:'Team',group:[{address:'admin@example.com'},{address:'copy@example.net'}]}, {name:'Undisclosed',group:[]}])});
   const reply=await prepare(c(),1,{accountId:1,emailId:original.email_id,text:'Reply',replyAll:true},'reply');
   expect(reply.receiveEmail).toEqual(['outside@example.net','copy@example.net']);expect(reply.cc).toEqual(['cc@example.net']);expect(reply.bcc).toEqual([]);
   const forwarded=await prepare(c(),1,{accountId:1,emailId:original.email_id,text:'Forward'},'forward');expect(forwarded.content).toContain('Original body');
 });
});
describe('Recoverable Trash',()=>{
 it('delivers a queued Trash reply after the original expires, using the verified headers',async()=>{
   const {schedule,deliverDue}=await import('../src/cloud/scheduled');
   const original=await message({relation:'<prior@example.net>'});await mail.trash(c(),1,[original.email_id]);
   const reply=await drafts.save(c(),1,{accountId:1,sendType:'reply',emailId:original.email_id,receiveEmail:['person@example.com'],subject:'After expiry',text:'Follow up',
     replyHeaders:{messageId:'<unverified@example.net>'}});
   await mail.trash(c(),1,[original.email_id],'purge');
   const edited=await drafts.save(c(),1,{version:reply.version,text:'Edited after expiry'},reply.draftId);
   await schedule(c(),1,reply.draftId,{version:edited.version,sendAt:Math.floor(Date.now()/1000)+120});
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',unixepoch()-1) WHERE draft_id=?").bind(reply.draftId).run();
   await deliverDue(c());
   expect(await env.db.prepare('SELECT in_reply_to,reply_to_email_id,relation,text FROM email WHERE type=1 AND user_id=1').first()).toEqual({
     in_reply_to:original.message_id,reply_to_email_id:null,relation:'<prior@example.net> '+original.message_id,text:'Edited after expiry'
   });
 });
 it('saves and delivers an owned reply without restoring the original and preserves its references', async()=>{
   const original=await message();
   await mail.trash(c(),1,[original.email_id]);
   const input={accountId:1,emailId:original.email_id,receiveEmail:['person@example.com'],text:'A reply from Trash'};
   const reply=await prepare(c(),1,input,'reply');
   const saved=await drafts.save(c(),1,reply);
   const receipt=await send(c(),1,{version:saved.version,idempotencyKey:'trash-reply-send'},{draftId:saved.draftId});
   expect(receipt.state).toBe('sent');
   expect(await mail.detail(c(),1,receipt.messages[0].emailId)).toMatchObject({inReplyTo:original.message_id,replyToEmailId:original.email_id});
   expect((await mail.detail(c(),1,original.email_id)).trashedAt).toBeTruthy();
   await expect(drafts.save(c(),2,{...reply,accountId:2})).rejects.toMatchObject({code:404});
   await expect(prepare(c(),2,{...input,accountId:2},'forward')).rejects.toMatchObject({code:404});
 });
 it('excludes Trash from active lists, counts and sync, but permits owned reading and restore',async()=>{
   const original=await message();const boot=await mobile.bootstrap(env.db,1);
   await mail.trash(c(),1,[original.email_id]);
   expect((await mail.list(c(),1,{folder:'inbox'})).messages).toHaveLength(0);expect((await mail.list(c(),1,{folder:'trash'})).messages).toHaveLength(1);
   expect((await mobile.bootstrap(env.db,1)).unreadTotal).toBe(0);
   expect((await mobile.changes(env.db,1,{after:boot.cursor})).changes.some(e=>e.operation==='delete')).toBe(true);
   expect((await mail.detail(c(),1,original.email_id)).bcc).toBe('[]');
   await expect(mail.trash(c(),2,[original.email_id],'restore')).rejects.toMatchObject({code:404});
   await mail.trash(c(),1,[original.email_id],'restore');expect((await mobile.bootstrap(env.db,1)).unreadTotal).toBe(1);
   await expect(mail.trash(c(),1,[original.email_id],'purge')).rejects.toMatchObject({code:400});
 });
 it('applies labels to the selected Trash messages without restoring them or changing siblings',async()=>{
   const {setTrashLabels}=await import('../src/cloud/trash-actions');
   const a=await message(), b=await message({message_id:'<b@local>',in_reply_to:'<original@example.net>'});
   const label=(await env.db.prepare("INSERT INTO mailbox_labels(user_id,name) VALUES(1,'Retain') RETURNING label_id").first()).label_id;
   const ids=[a.email_id,b.email_id];
   await mail.trash(c(),1,ids);
   await setTrashLabels(env.db,1,[a.email_id],[label],[]);
   expect((await mail.detail(c(),1,a.email_id)).labelIds).toEqual([label]);
   expect((await mail.detail(c(),1,b.email_id)).labelIds).toEqual([]);
   expect((await mail.list(c(),1,{folder:'trash'})).messages.map(m=>m.labelIds)).toEqual([[],[label]]);
   await expect(setTrashLabels(env.db,2,ids,[label],[])).rejects.toMatchObject({code:409});
   await expect(setTrashLabels(env.db,1,ids,[9999],[label])).rejects.toMatchObject({code:404});
   await mail.trash(c(),1,[b.email_id],'restore');
   await expect(setTrashLabels(env.db,1,ids,[],[label])).rejects.toMatchObject({code:409});
   expect((await mail.detail(c(),1,a.email_id)).labelIds).toEqual([label]);
   await setTrashLabels(env.db,1,[a.email_id],[],[label]);
   expect((await mail.list(c(),1,{folder:'trash'})).messages[0].labelIds).toEqual([]);
 });
 it('undoes Trash recovery without resetting the retention clock or re-trashing surviving siblings',async()=>{
   const {moveFromTrash}=await import('../src/cloud/trash-actions');
   const {undoConversationMove}=await import('../src/service/conversation-move-undo');
   const first=(await message()).email_id, sibling=(await message({message_id:'<sibling@local>',in_reply_to:'<original@example.net>'})).email_id;
   const date=await env.db.prepare("SELECT datetime('now','-29 days') d").first('d');
   await env.db.prepare('UPDATE email SET trashed_at=? WHERE email_id=?').bind(date,first).run();
   await env.db.prepare('INSERT INTO conversation_filing VALUES(1,?,NULL,1)').bind(sibling).run();
   const options={undoable:true,requestId:crypto.randomUUID()};
   const recover=()=>moveFromTrash(env.db,1,[first],0,undefined,options);
   const [a,b]=await Promise.all([recover(),recover()]);
   expect(a).toEqual(b);
   expect((await mail.list(c(),1,{folder:'inbox'})).messages.length).toBeGreaterThan(0);
   await expect(undoConversationMove(env.db,1,a.undoToken)).rejects.toMatchObject({code:409});
   await expect(undoConversationMove(env.db,2,a.undoToken,true)).rejects.toMatchObject({code:409});
   await undoConversationMove(env.db,1,a.undoToken,true);
   await undoConversationMove(env.db,1,a.undoToken,true);
   expect(await env.db.prepare('SELECT trashed_at FROM email WHERE email_id=?').bind(first).first('trashed_at')).toBe(date);
   expect(await env.db.prepare('SELECT trashed_at FROM email WHERE email_id=?').bind(sibling).first()).toEqual({trashed_at:null});
   expect((await env.db.prepare('SELECT email_id,wake_at,notified FROM conversation_filing WHERE user_id=1').all()).results)
     .toEqual([{email_id:sibling,wake_at:null,notified:1}]);
   expect(await recover()).toEqual({messageCount:1,alreadyProcessed:true});
 });
 it('restores prior labels and distinct Trash dates and rejects a stale recovery',async()=>{
   const {moveFromTrash}=await import('../src/cloud/trash-actions');
   const {undoConversationMove}=await import('../src/service/conversation-move-undo');
   const {saveLabel}=await import('../src/service/mailbox-labels');
   const first=(await message()).email_id, second=(await message({subject:'Other',message_id:'<other@local>'})).email_id;
   const {id:label}=await saveLabel(env.db,1,'Filed');
   const ids=[first,second];
   for(const id of ids)await env.db.prepare("UPDATE email SET trashed_at=datetime('now',?) WHERE email_id=?").bind('-'+id+' days',id).run();
   const dates=async()=>(await env.db.prepare('SELECT email_id,trashed_at FROM email ORDER BY email_id').all()).results;
   const initial=await dates();
   await env.db.prepare('INSERT INTO mailbox_label_members VALUES(1,?,?)').bind(label,first).run();
   const recover=async(previousLocation=false)=>moveFromTrash(env.db,1,ids,previousLocation?0:label,undefined,{undoable:true,requestId:crypto.randomUUID(),previousLocation});
   for(const previous of [false,true]){
     const move=await recover(previous);
     expect((await dates()).every(r=>r.trashed_at===null)).toBe(true);
     await undoConversationMove(env.db,1,move.undoToken,true);
     expect(await dates()).toEqual(initial);
     expect((await env.db.prepare('SELECT email_id FROM mailbox_label_members WHERE label_id=?').bind(label).all()).results).toEqual([{email_id:first}]);
   }
   const move=await recover(true);
   await mail.trash(c(),1,[first]);
   await mail.trash(c(),1,[first],'restore');
   await expect(undoConversationMove(env.db,1,move.undoToken,true)).rejects.toMatchObject({code:409});
   expect((await dates()).every(r=>r.trashed_at===null)).toBe(true);
   const requestId=crypto.randomUUID();
   await expect(moveFromTrash(env.db,1,ids,0,undefined,{previousLocation:true,undoable:true,requestId})).rejects.toMatchObject({code:409});
   expect(await env.db.prepare('SELECT result FROM conversation_move_requests WHERE request_id=?').bind(requestId).first()).toBeNull();
 });
 it('replays creation and recovery without offering an invalidated Undo',async()=>{
   const {saveLabel}=await import('../src/service/mailbox-labels');
   const {moveFromTrash}=await import('../src/cloud/trash-actions');
   const token=crypto.randomUUID(), label=await saveLabel(env.db,1,'Recovered',undefined,null,token);
   const row=await message();
   await mail.trash(c(),1,[row.email_id]);
   const recover=()=>moveFromTrash(env.db,1,[row.email_id],label.id,token,{undoable:true});
   const move=await recover();
   expect(move.undoToken).toBeTruthy();
   expect(await recover()).toEqual(move);
   await env.db.prepare('UPDATE conversation_move_undo SET expires=unixepoch()-1 WHERE token=?').bind(move.undoToken).run();
   expect(await recover()).toEqual({messageCount:1,alreadyProcessed:true});
   await env.db.prepare('UPDATE conversation_move_undo SET expires=unixepoch()+3600 WHERE token=?').bind(move.undoToken).run();
   await mail.trash(c(),1,[row.email_id]);
   expect(await recover()).toEqual({messageCount:1,alreadyProcessed:true});
   expect((await mail.detail(c(),1,row.email_id)).trashedAt).toBeTruthy();
 });
 it('files recovered mail atomically and preserves the folder of a surviving sibling',async()=>{
   const {moveFromTrash,setTrashRead}=await import('../src/cloud/trash-actions');
   const first=await message(), second=await message({message_id:'<reply@local>',in_reply_to:'<original@example.net>'});
   const ids=[first.email_id,second.email_id];
   const label=(await env.db.prepare("INSERT INTO mailbox_labels(user_id,name) VALUES(1,'Keep') RETURNING label_id").first()).label_id;
   await mail.trash(c(),1,ids);
   await setTrashRead(env.db,1,ids,true);
   expect((await mail.list(c(),1,{folder:'trash'})).messages.map(m=>m.unread)).toEqual([1,1]);
   await expect(moveFromTrash(env.db,2,ids,0)).rejects.toMatchObject({code:409});
   await expect(moveFromTrash(env.db,1,ids,9999)).rejects.toMatchObject({code:404});
   await moveFromTrash(env.db,1,[first.email_id],label);
   expect((await mail.list(c(),1,{folder:'inbox'})).messages).toHaveLength(0);
   await expect(setTrashRead(env.db,1,ids,false)).rejects.toMatchObject({code:409});
   expect((await mail.detail(c(),1,second.email_id)).unread).toBe(1);
   await moveFromTrash(env.db,1,[second.email_id],0);
   expect((await mail.list(c(),1,{folder:'inbox'})).messages).toHaveLength(2);
   await mail.trash(c(),1,[second.email_id]);
   await moveFromTrash(env.db,1,[second.email_id],label);
   expect((await mail.list(c(),1,{folder:'inbox'})).messages).toHaveLength(0);
   expect((await env.db.prepare('SELECT COUNT(*) n FROM mailbox_label_members WHERE label_id=?').bind(label).first()).n).toBe(2);
 });
 it('projects matching active threads across Unicode subjects and references without loading unrelated mail',async()=>{
   const {relatedActiveMail}=await import('../src/cloud/trash-threads');
   const {ensureThreads}=await import('../src/mobile/threads');
   const one=await message({subject:'Übersicht',message_id:'<a@local>'});
   const two=await message({subject:'A different heading',message_id:'<b@local>',in_reply_to:'<a@local>'});
   const target=await message({subject:'Re: ÜBERSICHT',message_id:'<c@local>'});
   await message({subject:'Unrelated',message_id:'<d@local>'});
   await mail.trash(c(),1,[target.email_id]);await ensureThreads(env.db,1);
   const active=await relatedActiveMail(env.db,1,[target]);
   expect(active.map(m=>m.email_id).sort()).toEqual([one.email_id,two.email_id].sort());
 });
 it('replays a committed label creation and Trash move after interrupted responses',async()=>{
   const {saveLabel}=await import('../src/service/mailbox-labels');
   const {moveFromTrash}=await import('../src/cloud/trash-actions');
   const token='test-label-move-01', create=()=>saveLabel(env.db,1,'Recovered',undefined,null,token);
   const label=await create();expect(await create()).toEqual(label);
   await expect(saveLabel(env.db,1,'Other',undefined,null,token)).rejects.toMatchObject({code:409});
   await expect(saveLabel(env.db,1,'Recovered',undefined,null,'another-request')).rejects.toMatchObject({code:409});
   const row=await message();await mail.trash(c(),1,[row.email_id]);
   const move=()=>moveFromTrash(env.db,1,[row.email_id],label.id,token);
   expect(await move()).toEqual({messageCount:1});expect(await move()).toEqual({messageCount:1});
   await expect(moveFromTrash(env.db,1,[row.email_id+1],label.id,token)).rejects.toMatchObject({code:409});
 });
 it('undoes only the original members and restores mixed labels and snooze state exactly once',async()=>{
   const {saveLabel}=await import('../src/service/mailbox-labels');
   const {conversationAction}=await import('../src/service/conversation-service');
   const {undoConversationMove}=await import('../src/service/conversation-move-undo');
   const source=(await saveLabel(env.db,1,'Source')).id, destination=(await saveLabel(env.db,1,'Destination')).id;
   const first=(await message()).email_id;
   const second=(await message({message_id:'<second@example.net>',in_reply_to:'<original@example.net>'})).email_id;
   const sql=(q,...params)=>env.db.prepare(q).bind(...params);
   const future=Math.floor(Date.now()/1000)+3600;
   await sql('INSERT INTO conversation_filing VALUES (1,?,?,1)',first,future).run();
   await sql('INSERT INTO mailbox_label_members VALUES(1,?,?),(1,?,?)',source,first,destination,second).run();
   const move=await conversationAction(c(),{emailIds:[first],labelId:destination,fromLabelId:source,undoable:true},1,'move');
   expect(move.messageCount).toBe(2);
   const reply=(await message({message_id:'<new@example.net>',in_reply_to:'<original@example.net>'})).email_id;
   const unrelated=(await saveLabel(env.db,1,'Keep')).id;
   await sql('INSERT INTO mailbox_label_members VALUES(1,?,?)',unrelated,first).run();
   await expect(undoConversationMove(env.db,2,move.undoToken)).rejects.toMatchObject({code:409});
   const before=await sql('SELECT count(*) AS n FROM mobile_changes WHERE user_id=?',1).first();
   for(let attempt=0;attempt<2;attempt++) expect(await undoConversationMove(env.db,1,move.undoToken)).toEqual({restored:true});
   const after=await sql('SELECT count(*) AS n FROM mobile_changes WHERE user_id=?',1).first();
   expect(after.n-before.n).toBe(2);
   expect((await sql('SELECT email_id,wake_at,notified FROM conversation_filing WHERE user_id=?',1).all()).results)
     .toEqual([{email_id:first,wake_at:future,notified:1}]);
   expect((await sql('SELECT label_id,email_id FROM mailbox_label_members WHERE user_id=? ORDER BY label_id',1).all()).results)
     .toEqual([{label_id:source,email_id:first},{label_id:destination,email_id:second},{label_id:unrelated,email_id:first}]);
   expect(await sql('SELECT email_id FROM conversation_filing WHERE email_id=?',reply).first()).toBeNull();
 });
 it('recovers the original move after a lost response and leaves new replies untouched',async()=>{
   const {saveLabel}=await import('../src/service/mailbox-labels');
   const {conversationAction}=await import('../src/service/conversation-service');
   const {undoConversationMove}=await import('../src/service/conversation-move-undo');
   const dest=await saveLabel(env.db,1,'Later');
   const original=await message();
   const request={emailIds:[original.email_id],labelId:dest.id,undoable:true,requestId:crypto.randomUUID()};
   const run=()=>conversationAction(c(),request,1,'move');
   const [a,b]=await Promise.all([run(),run()]);
   expect(a).toEqual(b);
   const reply=await message({message_id:'<new@example.net>',in_reply_to:'<original@example.net>'});
   expect(await run()).toEqual(a);
   await expect(conversationAction(c(),{...request,labelId:0},1,'move')).rejects.toMatchObject({code:409});
   await undoConversationMove(env.db,1,a.undoToken);
   expect(await run()).toEqual({messageCount:1,conversationCount:1,alreadyProcessed:true});
   expect((await env.db.prepare('SELECT email_id FROM mailbox_label_members WHERE email_id IN (?,?)').bind(original.email_id,reply.email_id).all()).results).toEqual([]);
   expect((await env.db.prepare('SELECT email_id FROM conversation_filing WHERE user_id=1').all()).results).toEqual([]);
 });
 it('clears filing history on expiry and permanent user removal',async()=>{
   const {conversationAction}=await import('../src/service/conversation-service');
   const first=await message();
   const move=()=>conversationAction(c(),{emailIds:[first.email_id],labelId:0,undoable:true,requestId:crypto.randomUUID()},1,'move');
   const tables=['conversation_move_requests','conversation_move_undo','conversation_move_prior'];
   const counts=async()=>Promise.all(tables.map(t=>env.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id=1`).first('n')));
   await move();
   expect(await counts()).toEqual([1,1,1]);
   await env.db.batch(tables.slice(0,2).map(t=>env.db.prepare(`UPDATE ${t} SET expires=0`)));
   await mail.purgeExpired(c());
   expect(await counts()).toEqual([0,0,0]);
   await move();
   await drafts.deleteUserData(c(),[1]);
   expect(await counts()).toEqual([0,0,0]);
 });
 it('rejects undo for the whole selection after another filing or a touched label changes',async()=>{
   const {saveLabel}=await import('../src/service/mailbox-labels');
   const {conversationAction}=await import('../src/service/conversation-service');
   const {undoConversationMove}=await import('../src/service/conversation-move-undo');
   const label=(await saveLabel(env.db,1,'Filing')).id, first=(await message()).email_id;
   const second=(await message({message_id:'<other@example.net>',subject:'Unrelated'})).email_id;
   const move=()=>conversationAction(c(),{emailIds:[first,second],labelId:label,undoable:true},1,'move');
   let result=await move();
   await conversationAction(c(),{emailIds:[second]},1,'inbox');
   await expect(undoConversationMove(env.db,1,result.undoToken)).rejects.toMatchObject({code:409});
   expect(await env.db.prepare('SELECT wake_at FROM conversation_filing WHERE email_id=?').bind(first).first()).toEqual({wake_at:null});
   result=await move();
   await env.db.prepare('DELETE FROM mailbox_label_members WHERE label_id=? AND email_id=?').bind(label,second).run();
   await expect(undoConversationMove(env.db,1,result.undoToken)).rejects.toMatchObject({code:409});
 });
 it('replays filing from Inbox without archiving later replies and isolates competing moves',async()=>{
   const {saveLabel}=await import('../src/service/mailbox-labels');
   const {conversationAction}=await import('../src/service/conversation-service');
   const {moveFromTrash}=await import('../src/cloud/trash-actions');
   const token='create-inbox-label',label=await saveLabel(env.db,1,'Filing',undefined,null,token);
   const original=await message();
   const move=()=>conversationAction(c(),{clientId:token,emailIds:[original.email_id],labelId:label.id},1,'move');
   const result=await move();
   const reply=await message({message_id:'<new@example.com>',in_reply_to:'<original@example.net>'});
   expect(await move()).toEqual(result);
   expect((await mail.list(c(),1,{folder:'inbox'})).messages.map(m=>m.emailId)).toContain(reply.email_id);
   const other='create-trash-label',dest=await saveLabel(env.db,1,'Trash filing',undefined,null,other);
   await mail.trash(c(),1,[original.email_id,reply.email_id]);
   const actions=await Promise.allSettled([original,reply].map(m=>moveFromTrash(env.db,1,[m.email_id],dest.id,other)));
   expect(actions.filter(r=>r.status==='fulfilled')).toHaveLength(1);
   expect((await mail.list(c(),1,{folder:'trash'})).messages).toHaveLength(1);
 });
 it('purges only after 30 days and age-based cleanup enters Trash first',async()=>{
   const old=await message({create_time:'2020-01-01 00:00:00'});
   await env.db.prepare('UPDATE setting SET auto_clean_days=1').run();await settingService.refresh(c());
   const {default:emailService}=await import('../src/service/email-service');await emailService.autoClean(c());
   expect((await mail.detail(c(),1,old.email_id)).trashedAt).toBeTruthy();await mail.purgeExpired(c());expect(await mail.detail(c(),1,old.email_id)).toBeTruthy();
   await env.db.prepare("UPDATE email SET trashed_at=datetime('now','-31 days')").run();await mail.purgeExpired(c());await expect(mail.detail(c(),1,old.email_id)).rejects.toMatchObject({code:404});
 });
});
const fetchWorker=(path,options={})=>worker.fetch(new Request('https://mail.example.com'+path,options),bindings(),createExecutionContext());
const cookies=headers=>headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
async function startConnection(scope) {
 const registration=await fetchWorker('/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Test MCP',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'})});
 expect(registration.status).toBe(201);const client=await registration.json();
 const verifier='a'.repeat(64);const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));const challenge=btoa(String.fromCharCode(...hash)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 const params=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://client.example/callback',response_type:'code',scope,state:'state123',code_challenge:challenge,code_challenge_method:'S256',resource:'https://mail.example.com/mcp'});
 const page=await fetchWorker('/oauth/authorize?'+params);expect(page.status).toBe(200);const cookie=cookies(page.headers);const html=await page.text();const handle=html.match(/name="handle" value="([^"]+)"/)[1];
 return {client,verifier,cookie,html,handle};
}
async function connect(scope='mail:read mail:drafts mail:send mail:delete offline_access',approvedScope=scope,inspectConsent=()=>{}) {
 const {client,verifier,cookie,html,handle}=await startConnection(scope);inspectConsent(html);
 const form=new URLSearchParams({handle,decision:'approve',secret:'test-installation-secret',email:'admin@example.com',password:'test-password'});for(const value of approvedScope.split(' '))form.append('scope',value);
 const approved=await fetchWorker('/oauth/authorize',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded',Origin:'https://mail.example.com'},body:form});
 expect(approved.status).toBe(302);const callback=new URL(approved.headers.get('Location'));expect(callback.searchParams.get('state')).toBe('state123');
 const token=await fetchWorker('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:'https://client.example/callback',code:callback.searchParams.get('code'),code_verifier:verifier,resource:'https://mail.example.com/mcp'})});
 expect(token.status).toBe(200);return {...await token.json(),client};
}
async function rpc(token,method,params={}) {
 const response=await fetchWorker('/mcp',{method:'POST',headers:{Host:'mail.example.com',Authorization:'Bearer '+token,Accept:'application/json, text/event-stream','Content-Type':'application/json','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=JSON.parse(text.split('\n').find(l=>l.startsWith('data: ')).slice(6));}return {response,data};
}
describe('Hosted OAuth MCP',()=>{
 it('offers every supported permission by default while honoring narrowed approval and existing grants',async()=>{
   const allScopes=['mail:read','mail:drafts','mail:send','mail:delete','offline_access'];
   const inspect=html=>{
     const {document}=parseHTML(html);
     const choices=[...document.querySelectorAll('input[name="scope"]')];
     expect(choices.map(input=>input.getAttribute('value'))).toEqual(allScopes);
     expect(choices.every(input=>input.hasAttribute('checked'))).toBe(true);
     expect(html).toContain('uncheck any you do not want');
     expect(document.querySelector('button[value="approve"]').textContent).toBe('Sign in and Allow selected permissions');
   };
   const readOnly=await connect('mail:read','mail:read',inspect);expect(readOnly.scope).toBe('mail:read');
   const full=await connect('mail:read',allScopes.join(' '),inspect);
   expect(full.scope.split(' ')).toEqual(allScopes);expect(full.refresh_token).toBeTruthy();
   const records=(await env.db.prepare('SELECT scopes FROM connected_apps ORDER BY rowid').all()).results;
   expect(records.map(row=>JSON.parse(row.scopes))).toEqual([['mail:read'],allScopes]);
   for(const [name,args,scope] of [
     ['list_drafts',{},'mail:drafts'],
     ['send_email',{accountId:1,idempotencyKey:'old-grant-unchanged'},'mail:send'],
     ['delete_emails',{emailIds:[1]},'mail:delete']
   ]) {
     const denied=(await rpc(readOnly.access_token,'tools/call',{name,arguments:args})).data.result;
     expect(denied._meta['mcp/www_authenticate'][0]).toContain(scope);
   }
 });
 it('supports read, draft, send, delete, and offline access after one explicit full approval',async()=>{
   const full=await connect('mail:read','mail:read mail:drafts mail:send mail:delete offline_access');
   const call=async(name,args={})=>{
     const result=(await rpc(full.access_token,'tools/call',{name,arguments:args})).data.result;
     expect(result.isError).not.toBe(true);return result.structuredContent;
   };
   expect((await call('list_mailboxes')).mailboxes).toHaveLength(2);
   const d=await call('create_draft',{accountId:1,subject:'Local test only',text:'Draft',content:'<p>Draft</p>',receiveEmail:['person@example.com']});
   expect((await call('list_drafts')).drafts).toHaveLength(1);
   expect((await call('get_draft',{draftId:d.draftId})).subject).toBe('Local test only');
   expect((await call('send_draft',{draftId:d.draftId,version:d.version,idempotencyKey:'full-consent-local-send'})).state).toBe('sent');
   const original=await message();
   for(const name of ['delete_emails','restore_emails','delete_emails','permanently_delete_emails']) {
     expect((await call(name,{emailIds:[original.email_id]})).messageCount).toBe(1);
   }
   const refresh=await fetchWorker('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:full.client.client_id,refresh_token:full.refresh_token,resource:'https://mail.example.com/mcp'})});
   expect(refresh.status).toBe(200);expect((await refresh.json()).scope.split(' ')).toEqual(full.scope.split(' '));
 });
 it('keeps mailbox, message, and draft ownership enforced with all permissions',async()=>{
   const full=await connect();const foreign=await message({user_id:2,account_id:2});
   const foreignDraft=await drafts.save(c(),2,{accountId:2,subject:'Private draft'});
   for(const [name,args] of [
     ['read_email',{emailId:foreign.email_id}],
     ['delete_emails',{emailIds:[foreign.email_id]}],
     ['create_draft',{accountId:2,subject:'Forbidden'}],
     ['get_draft',{draftId:foreignDraft.draftId}],
     ['send_email',{accountId:2,idempotencyKey:'all-scopes-foreign-send'}]
   ]) {
     const denied=(await rpc(full.access_token,'tools/call',{name,arguments:args})).data.result;
     expect(denied.structuredContent.code).toBe(404);expect(denied._meta).toBeUndefined();
   }
 });
 it.each(['secret','password'])('preserves selected and unchecked permissions after an incorrect %s without granting access',async field=>{
   const {cookie,handle}=await startConnection('mail:read');
   const form=new URLSearchParams({handle,decision:'approve',secret:'test-installation-secret',email:'admin@example.com',password:'test-password'});
   form.append('scope','mail:read');form.append('scope','mail:send');form.set(field,'incorrect');
   const retry=await fetchWorker('/oauth/authorize',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded',Origin:'https://mail.example.com'},body:form});
   expect(retry.status).toBe(200);expect(retry.headers.get('Location')).toBeNull();
   expect((await env.db.prepare('SELECT COUNT(*) total FROM connected_apps').first()).total).toBe(0);
   const html=await retry.text(),{document}=parseHTML(html);
   expect(document.querySelector('input[value="mail:send"]').hasAttribute('checked')).toBe(true);
   expect(document.querySelector('input[value="mail:delete"]').hasAttribute('checked')).toBe(false);
   const nextHandle=document.querySelector('input[name="handle"]').getAttribute('value');
   expect(nextHandle).not.toBe(handle);
   form.set('handle',nextHandle);form.set(field,field==='secret'?'test-installation-secret':'test-password');
   const approved=await fetchWorker('/oauth/authorize',{method:'POST',headers:{Cookie:cookies(retry.headers),'Content-Type':'application/x-www-form-urlencoded',Origin:'https://mail.example.com'},body:form});
   expect(approved.status).toBe(302);
   expect(JSON.parse((await env.db.prepare('SELECT scopes FROM connected_apps').first()).scopes)).toEqual(['mail:read','mail:send']);
 });
 it('advertises discovery and challenges before installation unlock',async()=>{
   const authorization=await fetchWorker('/.well-known/oauth-authorization-server');expect(authorization.status).toBe(200);
   expect((await authorization.json()).scopes_supported).toContain('mail:send');
   const resource=await (await fetchWorker('/.well-known/oauth-protected-resource/mcp')).json();
   expect(resource.scopes_supported).toEqual(['mail:read']);
   const challenge=await fetchWorker('/mcp');expect(challenge.status).toBe(401);expect(challenge.headers.get('WWW-Authenticate')).toContain('resource_metadata');
 });
 it('declares tool permissions and challenges every send operation without side effects',async()=>{
   const token=await connect('mail:read');
   const listed=(await rpc(token.access_token,'tools/list')).data.result.tools;
   expect(listed.every(t=>t._meta.securitySchemes.length>0)).toBe(true);
   expect(listed.find(t=>t.name==='list_mailboxes')._meta.securitySchemes).toEqual([{type:'oauth2',scopes:['mail:read']}]);
   for(const name of ['send_email','send_draft','reply_email','forward_email']) {
     expect(listed.find(t=>t.name===name)._meta.securitySchemes).toEqual([{type:'oauth2',scopes:['mail:read','mail:send']}]);
     const result=(await rpc(token.access_token,'tools/call',{name,arguments:{accountId:1,draftId:1,version:1,emailId:1,idempotencyKey:'scope-check-only'}})).data.result;
     expect(result.isError).toBe(true);expect(result.structuredContent.code).toBe(403);
     const challenge=result._meta['mcp/www_authenticate'][0];
     expect(challenge).toContain('error="insufficient_scope"');expect(challenge).toContain('error_description=');
     expect(challenge).toContain('scope="mail:read mail:send"');
     expect(challenge).toContain('resource_metadata="https://mail.example.com/.well-known/oauth-protected-resource/mcp"');
     expect(challenge).not.toContain('mail:delete');
   }
   expect((await env.db.prepare('SELECT COUNT(*) total FROM send_attempts').first()).total).toBe(0);
   expect((await env.db.prepare('SELECT COUNT(*) total FROM email').first()).total).toBe(0);
 });
 it('requires explicit send consent and preserves ownership after reauthorization',async()=>{
   const declined=await connect('mail:read mail:send','mail:read');expect(declined.scope.split(' ')).not.toContain('mail:send');
   const denied=(await rpc(declined.access_token,'tools/call',{name:'send_email',arguments:{accountId:2,idempotencyKey:'declined-send-scope'}})).data.result;
   expect(denied._meta['mcp/www_authenticate'][0]).toContain('mail:send');
   const approved=await connect('mail:read mail:send');expect(approved.scope.split(' ')).toContain('mail:send');
   const foreign=(await rpc(approved.access_token,'tools/call',{name:'send_email',arguments:{accountId:2,idempotencyKey:'approved-scope-foreign'}})).data.result;
   expect(foreign.structuredContent.code).toBe(404);expect(foreign._meta).toBeUndefined();
   // A separate grant does not silently upgrade the existing read-only token.
   const stillDenied=(await rpc(declined.access_token,'tools/call',{name:'send_email',arguments:{accountId:1,idempotencyKey:'old-token-still-read'}})).data.result;
   expect(stillDenied._meta['mcp/www_authenticate'][0]).toContain('mail:send');
 });
 it('challenges draft files and mutations, but does not relink for ordinary access errors',async()=>{
   const token=await connect('mail:read');
   for(const [name,args,scope] of [
     ['create_draft',{accountId:1},'mail:drafts'],
     ['get_attachment',{attachmentId:crypto.randomUUID()},'mail:drafts'],
     ['delete_emails',{emailIds:[1]},'mail:delete']
   ]) {
     const result=(await rpc(token.access_token,'tools/call',{name,arguments:args})).data.result;
     expect(result._meta['mcp/www_authenticate'][0]).toContain(`scope="mail:read ${scope}"`);
   }
   const missing=(await rpc(token.access_token,'tools/call',{name:'read_email',arguments:{emailId:999}})).data.result;
   expect(missing.structuredContent.code).toBe(404);expect(missing._meta).toBeUndefined();
 });
 it('keeps Cloudmail role restrictions despite all OAuth permissions',async()=>{
   const token=await connect();
   await env.db.prepare("UPDATE user SET email='restricted@example.com',type=999 WHERE user_id=1").run();
   for(const [name,args] of [['send_email',{accountId:1,idempotencyKey:'role-denied-send'}],['delete_emails',{emailIds:[1]}]]) {
     const denied=(await rpc(token.access_token,'tools/call',{name,arguments:args})).data.result;
     expect(denied.structuredContent.code).toBe(403);expect(denied._meta).toBeUndefined();
   }
   expect((await env.db.prepare('SELECT COUNT(*) total FROM send_attempts').first()).total).toBe(0);
 });
 it('rejects unsupported permissions before creating a grant',async()=>{
   const {cookie,handle}=await startConnection('mail:read');
   const form=new URLSearchParams({handle,decision:'approve',secret:'test-installation-secret',email:'admin@example.com',password:'test-password'});
   form.append('scope','mail:read');form.append('scope','mail:admin');
   const denied=await fetchWorker('/oauth/authorize',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded',Origin:'https://mail.example.com'},body:form});
   expect(denied.status).toBe(400);expect((await env.db.prepare('SELECT COUNT(*) total FROM connected_apps').first()).total).toBe(0);
 });
 it('cannot add send permission by refreshing a read-only grant',async()=>{
   const token=await connect('mail:read offline_access');
   const refresh=await fetchWorker('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:token.client.client_id,refresh_token:token.refresh_token,resource:'https://mail.example.com/mcp',scope:'mail:read mail:send'})});
   expect(refresh.status).toBe(200);expect((await refresh.json()).scope.split(' ')).not.toContain('mail:send');
 });
 it('signs in through browser-bound consent, lists tools, enforces scopes and revokes immediately',async()=>{
   const token=await connect('mail:read');
   const tools=await rpc(token.access_token,'tools/list');expect(tools.data.error).toBeUndefined();expect(tools.data.result.tools.map(t=>t.name)).toContain('send_draft');
   const denied=await rpc(token.access_token,'tools/call',{name:'create_draft',arguments:{accountId:1,subject:'Denied'}});expect(denied.data.result.isError).toBe(true);
   const mailboxes=await rpc(token.access_token,'tools/call',{name:'list_mailboxes',arguments:{}});expect(mailboxes.data.result.structuredContent.mailboxes).toHaveLength(2);
   await env.db.prepare('UPDATE connected_apps SET revoked=1').run();expect((await fetchWorker('/mcp',{headers:{Authorization:'Bearer '+token.access_token}})).status).toBe(401);
 });
 it('issues refresh tokens and does not accept missing or foreign audience tokens',async()=>{
   const token=await connect();expect(token.refresh_token).toBeTruthy();
   const refresh=await fetchWorker('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:token.client.client_id,refresh_token:token.refresh_token,resource:'https://mail.example.com/mcp'})});expect(refresh.status).toBe(200);
   expect((await fetchWorker('/mcp',{headers:{Authorization:'Bearer invalid'}})).status).toBe(401);
 });
});

describe('MCP authorization boundaries',()=>{
 it('refuses unregistered redirect destinations without redirecting the browser',async()=>{
   const response=await fetchWorker('/oauth/authorize?'+new URLSearchParams({client_id:'unknown',response_type:'code',redirect_uri:'https://attacker.example/callback',scope:'mail:read',code_challenge:'x'.repeat(43),code_challenge_method:'S256'}));
   expect(response.status).toBe(400);expect(response.headers.get('Location')).toBeNull();
 });
 it('honors Deny and rejects consent from a different browser',async()=>{
   const client=await (await fetchWorker('/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Browser test',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'})})).json();
   const query=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:'https://client.example/callback',scope:'mail:read',state:'denied-state',resource:'https://mail.example.com/mcp',code_challenge:'x'.repeat(43),code_challenge_method:'S256'});
   const page=await fetchWorker('/oauth/authorize?'+query);const cookie=cookies(page.headers),handle=(await page.text()).match(/name="handle" value="([^"]+)"/)[1];
   const form=new URLSearchParams({handle,decision:'deny'});
   expect((await fetchWorker('/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form})).status).toBe(400);
   const fresh=await fetchWorker('/oauth/authorize?'+query),freshCookie=cookies(fresh.headers),freshHandle=(await fresh.text()).match(/name="handle" value="([^"]+)"/)[1];
   const denied=await fetchWorker('/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:freshCookie},body:new URLSearchParams({handle:freshHandle,decision:'deny'})});
   expect(denied.status).toBe(302);const callback=new URL(denied.headers.get('Location'));expect(callback.searchParams.get('error')).toBe('access_denied');expect(callback.searchParams.get('state')).toBe('denied-state');
 });
 it('enforces live user status and message ownership through the MCP transport',async()=>{
   const token=await connect();const foreign=await message({user_id:2,account_id:2});
   const denied=await rpc(token.access_token,'tools/call',{name:'read_email',arguments:{emailId:foreign.email_id}});expect(denied.data.result.structuredContent.code).toBe(404);
   await env.db.prepare('UPDATE user SET status=1 WHERE user_id=1').run();
   expect((await fetchWorker('/mcp',{headers:{Authorization:'Bearer '+token.access_token}})).status).toBe(403);
 });
 it('preserves displayed size, decorative alt text and original sizing on scheduled delivery',async()=>{
   const {schedule,deliverDue}=await import('../src/cloud/scheduled');
   const src='data:image/png;base64,AAECAw==';
   const html='<img src="'+src+'" alt="A diagram" width="198" height="99" style="max-width:100%;height:auto">'+
     '<img src="https://example.org/example.png" alt="" style="margin:0;max-width:none;height:auto">';
   const d=await draft({content:html,receiveEmail:['outside@example.net']});
   const ctx=c();ctx.env.email={send:vi.fn().mockResolvedValue({messageId:'<photo@example.com>'})};
   await schedule(ctx,1,d.draftId,{version:d.version,sendAt:Math.floor(Date.now()/1000)+120});
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',unixepoch()-1) WHERE draft_id=?").bind(d.draftId).run();
   await deliverDue(ctx);
   expect(ctx.env.email.send).toHaveBeenCalledOnce();
   const delivered=ctx.env.email.send.mock.calls[0][0];
   const [small,original]=parseHTML(delivered.html).document.querySelectorAll('img');
   expect(small.getAttribute('src')).toMatch(/^cid:/);
   expect([small.getAttribute('width'),small.getAttribute('height'),small.getAttribute('alt')]).toEqual(['198','99','A diagram']);
   expect(small.getAttribute('style')).toContain('height:auto');
   expect(original.getAttribute('alt')).toBe('');
   expect(original.getAttribute('style')).toBe('margin:0;max-width:none;height:auto');
 });
 it('keeps inline draft images private and sends their original binary content',async()=>{
   const d=await draft({content:'<p>Image</p><img src="data:image/png;base64,AAECAw==">'});
   expect(d.content).toContain('cid:');expect(d.attachments).toHaveLength(1);
   const payload=await drafts.payload(c(),1,d);expect(payload.content).toContain('data:image/png;base64,AAECAw==');
   const next=await drafts.save(c(),1,{version:d.version,content:payload.content,attachments:[{filename:d.attachments[0].filename,content:'AAECAw==',contentType:'image/png',contentId:d.attachments[0].contentId}]},d.draftId);
   expect(next.attachments).toHaveLength(1);
 });
});

describe('Attachment retention',()=>{
 it('keeps saved forwards independent of a permanently deleted original',async()=>{
   const original=await message();await env.r2.put('attachments/source.txt','source bytes');
   await env.db.prepare("INSERT INTO attachments(user_id,email_id,account_id,key,filename,mime_type) VALUES(1,?,1,'attachments/source.txt','source.txt','text/plain')").bind(original.email_id).run();
   const payload=await prepare(c(),1,{accountId:1,emailId:original.email_id,text:'For you',receiveEmail:['person@example.com']},'forward');
   const saved=await drafts.save(c(),1,payload);
   await mail.trash(c(),1,[original.email_id]);await mail.trash(c(),1,[original.email_id],'purge');
   const ready=await drafts.payload(c(),1,saved);expect(new TextDecoder().decode(ready.attachments[0].content)).toBe('source bytes');
 });
 it('does not remove a shared object while another user still references it',async()=>{
   const first=await message(),second=await message({user_id:2,account_id:2});await env.r2.put('attachments/shared.txt','shared');
   for(const [userId,emailId,accountId] of [[1,first.email_id,1],[2,second.email_id,2]])await env.db.prepare("INSERT INTO attachments(user_id,email_id,account_id,key,filename) VALUES(?,?,?,'attachments/shared.txt','shared.txt')").bind(userId,emailId,accountId).run();
   await mail.trash(c(),1,[first.email_id]);await mail.trash(c(),1,[first.email_id],'purge');const retained=await env.r2.get('attachments/shared.txt');expect(await retained.text()).toBe('shared');
 });
});

describe('Scheduled send',()=>{
 it('remembers only the last successful schedule per user across retries and cancellation',async()=>{
   const {schedule,cancel,lastSchedule}=await import('../src/cloud/scheduled');
   const a=await draft(),b=await draft({clientId:crypto.randomUUID()}),t=Math.floor(Date.now()/1000)+3600;
   const req={version:a.version,sendAt:t},first=await schedule(c(),1,a.draftId,req);
   expect(first.lastSchedule).toEqual({sendAt:t,version:1});
   const next=await schedule(c(),1,b.draftId,{version:b.version,sendAt:t+900});
   expect((await schedule(c(),1,a.draftId,req)).lastSchedule).toEqual(next.lastSchedule);
   await cancel(c(),1,b.draftId,next.version);
   await expect(schedule(c(),1,a.draftId,{...req,sendAt:t+600})).rejects.toMatchObject({code:409});
   expect(await lastSchedule(env.db,1)).toEqual({sendAt:t+900,version:2});
   expect(await lastSchedule(env.db,2)).toBeNull();
 });

 it('applies label differences to a whole queue selection and preserves each message’s unrelated labels',async()=>{
   const {schedule,scheduledList,setScheduledLabels,cancel}=await import('../src/cloud/scheduled');
   const label=(user,name)=>env.db.prepare('INSERT INTO mailbox_labels(user_id,name) VALUES(?,?) RETURNING label_id').bind(user,name).first('label_id');
   const old=await label(1,'Work'),keep=await label(1,'Personal'),added=await label(1,'Later'),foreign=await label(2,'Other');
   const sendAt=Math.floor(Date.now()/1000)+3600;
   const messages=[];
   for(const labels of [[old,keep],[old]]) {
     const d=await draft({labelIds:labels});
     const queued=await schedule(c(),1,d.draftId,{version:d.version,sendAt});
     messages.push({draftId:queued.draftId,version:queued.version,sendAt:queued.sendAt});
   }
   const change=(messages,add,remove,uid=1)=>setScheduledLabels(c(),uid,{messages,add,remove});
   await expect(change(messages,[foreign],[old])).rejects.toMatchObject({code:409});
   await expect(change(messages,[added],[old],2)).rejects.toMatchObject({code:409});
   await expect(change([messages[0],{...messages[1],version:77}],[added],[old])).rejects.toMatchObject({code:409});
   await expect(change(messages,[added],[added])).rejects.toMatchObject({code:400});
   expect((await scheduledList(c(),1,1,{labelId:old})).length).toBe(2);
   expect(await change(messages,[added],[old])).toEqual({updated:2});
   expect(await change(messages,[added],[old])).toEqual({updated:2});
   expect(await scheduledList(c(),1,1,{labelId:added})).toMatchObject(messages.map((m,i)=>({...m,labelIds:i ? [added] : [keep,added]})));
   expect(await scheduledList(c(),1,1,{labelId:old})).toEqual([]);
   const {labelUnreadCounts}=await import('../src/service/conversation-service');
   const {setScheduledRead}=await import('../src/cloud/scheduled');
   const counts=(accountId,allReceive=0,uid=1)=>labelUnreadCounts(c(),{accountId,allReceive},uid);
   await setScheduledRead(c(),1,{messages,unread:true});
   expect(await counts(1)).toEqual({[added]:2,[keep]:1});
   expect(await counts(3)).toEqual({});
   expect(await counts(3,1)).toEqual({[added]:2,[keep]:1});
   expect(await counts(1,1,2)).toEqual({});
   await cancel(c(),1,messages[0].draftId,messages[0].version);
   expect(await counts(1)).toEqual({[added]:1});
   expect((await drafts.get(c(),1,messages[0].draftId)).labelIds).toEqual([keep,added]);
   await expect(change(messages,[],[added])).rejects.toMatchObject({code:409});
   expect(await scheduledList(c(),1,1,{labelId:added})).toHaveLength(1);
 });
 it('keeps a first label applied during preparation on the delivered sender copy',async()=>{
   const {schedule,setScheduledLabels,deliverDue}=await import('../src/cloud/scheduled');
   const {default:storage}=await import('../src/service/r2-service');
   const id=await env.db.prepare("INSERT INTO mailbox_labels(user_id,name) VALUES(1,'Just filed') RETURNING label_id").first('label_id');
   const d=await draft({attachments:[{filename:'a.txt',content:'YQ==',contentType:'text/plain'}]});
   const queued=await schedule(c(),1,d.draftId,{version:d.version,sendAt:Math.floor(Date.now()/1000)+3600});
   const get=storage.getObj.bind(storage);
   vi.spyOn(storage,'getObj').mockImplementationOnce(async(...args)=>{
     await setScheduledLabels(c(),1,{messages:[queued],add:[id],remove:[]});return get(...args);
   });
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',1) WHERE draft_id=?").bind(d.draftId).run();
   await deliverDue(c());
   expect((await env.db.prepare('SELECT m.label_id,e.user_id,e.type FROM mailbox_label_members m JOIN email e USING(email_id)').all()).results)
     .toEqual([{label_id:id,user_id:1,type:1}]);
 });
 it.each([false,true])('files only the sender copy with surviving owned compose labels (scheduled=%s)',async queued=>{
   const {schedule,scheduledList,deliverDue}=await import('../src/cloud/scheduled');
   const label=async(owner,name)=>(await env.db.prepare('INSERT INTO mailbox_labels(user_id,name) VALUES(?,?) RETURNING label_id')
     .bind(owner,name).first()).label_id;
   const keep=await label(1,'Keep'),removed=await label(1,'Delete later'),foreign=await label(2,'Private');
   const d=await draft({labelIds:[keep,keep,removed,foreign],composeStarred:true});
   const saved=await drafts.save(c(),1,{version:d.version,subject:'Revised'},d.draftId);
   expect(saved.labelIds).toEqual([keep,removed,foreign]);
   expect(saved.mailboxStarred).toBe(1);
   await env.db.prepare('DELETE FROM mailbox_labels WHERE label_id=?').bind(removed).run();
   if(queued) {
     await schedule(c(),1,d.draftId,{version:saved.version,sendAt:Math.floor(Date.now()/1000)+600});
     expect(await scheduledList(c(),1,1,{labelId:keep})).toHaveLength(1);
     expect(await scheduledList(c(),1,1,{labelId:foreign})).toHaveLength(0);
     await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',1) WHERE draft_id=?").bind(d.draftId).run();
     await deliverDue(c());
   } else {
     const request={version:saved.version,idempotencyKey:'compose-label-filing'};
     expect((await send(c(),1,request,{draftId:d.draftId})).state).toBe('sent');
     expect((await send(c(),1,request,{draftId:d.draftId})).state).toBe('sent');
   }
   const filed=await env.db.prepare('SELECT m.label_id,e.user_id,e.type FROM mailbox_label_members m JOIN email e USING(email_id)').all();
   expect(filed.results).toEqual([{label_id:keep,user_id:1,type:1}]);
   expect((await env.db.prepare('SELECT user_id FROM star').all()).results).toEqual([{user_id:1}]);
 });
 it('delivers an empty blind-copy-only scheduled draft and keeps its envelope private',async()=>{
   const {schedule,deliverDue}=await import('../src/cloud/scheduled');
   const d=await draft({subject:'',text:'',content:'',receiveEmail:[],bcc:['person@example.com'],ui:{replyRecipientNames:{'person@example.com':'Private Person'}},plainText:true});
   await schedule(c(),1,d.draftId,{version:d.version,sendAt:Math.floor(Date.now()/1000)+600});
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',1) WHERE draft_id=?").bind(d.draftId).run();
   await deliverDue(c());
   const {results}=await env.db.prepare('SELECT user_id,subject,recipient,cc,bcc,text FROM email ORDER BY user_id').all();
   expect(results).toHaveLength(2);
   expect(results[0]).toMatchObject({user_id:1,subject:'',recipient:'[]',text:''});
   expect(JSON.parse(results[0].bcc)).toEqual([{address:'person@example.com',name:'Private Person'}]);
   expect(results[1]).toMatchObject({user_id:2,subject:'',recipient:'[]',text:''});
   expect(JSON.parse(results[1].bcc || '[]')).toEqual([]);
 });
 it('removes queued messages from draft sync, isolates owners, and cancels back to the same editable draft',async()=>{
   const {schedule,scheduledList,cancel,deliverDue}=await import('../src/cloud/scheduled');
   const d=await draft(),sendAt=Math.floor(Date.now()/1000)+1800;
   const queued=await schedule(c(),1,d.draftId,{version:d.version,sendAt});
   expect(await schedule(c(),1,d.draftId,{version:d.version,sendAt})).toEqual(queued);
   expect((await drafts.list(c(),1)).drafts).toEqual([]);
   expect((await drafts.changes(c(),1)).changes.at(-1).operation).toBe('delete');
   expect((await scheduledList(c(),1))[0]).toMatchObject({draftId:d.draftId,sendAt});
   expect(await scheduledList(c(),2)).toEqual([]);
   expect(await scheduledList(c(),1,null,{countOnly:'1'})).toEqual({count:1});
   expect(await scheduledList(c(),2,null,{countOnly:'1'})).toEqual({count:0});
   const [summary]=await scheduledList(c(),1,d.accountId,{subject:d.subject,to:d.receiveEmail[0]});
   expect(summary).toMatchObject({draftId:d.draftId,accountId:d.accountId,recipients:d.receiveEmail});
   expect(await scheduledList(c(),1,null,{subject:'unknown'})).toEqual([]);
   await expect(cancel(c(),2,d.draftId,queued.version)).rejects.toMatchObject({code:404});
   await expect(send(c(),1,{version:queued.version,idempotencyKey:'manual-while-scheduled'},{draftId:d.draftId})).rejects.toMatchObject({code:404});
   await deliverDue(c());
   await cancel(c(),1,d.draftId,queued.version);
   expect((await drafts.get(c(),1,d.draftId))).toMatchObject({state:'draft',content:d.content});
   expect((await drafts.changes(c(),1)).changes.at(-1).operation).toBe('upsert');
 });
 it('sets read state atomically without disturbing a queued delivery or carrying unread state back to Drafts',async()=>{
   const {schedule,scheduledList,setScheduledRead,cancel}=await import('../src/cloud/scheduled');
   const sendAt=Math.floor(Date.now()/1000)+3600;
   const messages=[];
   for (const subject of ['First','Second']) {
     const d=await draft({subject});
     const queued=await schedule(c(),1,d.draftId,{version:d.version,sendAt});
     messages.push({draftId:queued.draftId,version:queued.version,sendAt:queued.sendAt});
   }
   const unread=()=>scheduledList(c(),1,1,{isUnread:'1'});
   const set=(user,messages,unread)=>setScheduledRead(c(),user,{messages,unread});
   expect(await unread()).toEqual([]);
   await expect(set(2,messages,true)).rejects.toMatchObject({code:409});
   await expect(set(1,[messages[0],messages[0]],true)).rejects.toMatchObject({code:400});
   await expect(set(1,[messages[0],{...messages[1],version:999}],true)).rejects.toMatchObject({code:409});
   expect(await unread()).toEqual([]);
   expect(await set(1,messages,true)).toEqual({updated:2});
   expect(await unread()).toMatchObject(messages.map(({draftId,version})=>({draftId,version,unread:1,sendAt})));
   await set(1,[messages[1]],false);
   expect(await scheduledList(c(),1,1,{countOnly:'1',isUnread:'1'})).toEqual({count:2});
   expect((await unread()).map(d=>d.draftId)).toEqual([messages[0].draftId]);
   const {draftId,version}=messages[0];
   await cancel(c(),1,draftId,version);
   await expect(set(1,messages,true)).rejects.toMatchObject({code:409});
   await schedule(c(),1,draftId,{version:version+1,sendAt});
   expect(await unread()).toEqual([]);
 });
 it('moves and archives a queue selection independently of send time, unread state and account scope',async()=>{
   const {schedule,scheduledList,setScheduledRead,setScheduledInbox,cancel}=await import('../src/cloud/scheduled');
   const when=Math.floor(Date.now()/1000)+3600;
   const rows=[];
   for (const subject of ['First','Second']) {
     const d=await draft({subject});
     const queued=await schedule(c(),1,d.draftId,{version:d.version,sendAt:when});
     rows.push({draftId:queued.draftId,version:queued.version,sendAt:queued.sendAt});
   }
   const file=(messages,inbox)=>setScheduledInbox(c(),1,{messages,inbox});
   const inbox=()=>scheduledList(c(),1,1,{mark:'inbox'});
   expect(await inbox()).toEqual([]);
   await expect(setScheduledInbox(c(),2,{messages:rows,inbox:true})).rejects.toMatchObject({code:409});
   await expect(file([rows[0],{...rows[1],version:999}],true)).rejects.toMatchObject({code:409});
   expect(await inbox()).toEqual([]);
   await file([rows[0]],true);
   const moved=await file(rows,true);
   expect(moved.changed).toEqual([rows[1].draftId]);
   const undo=()=>setScheduledInbox(c(),1,{messages:[rows[1]],inbox:false,previousEdit:moved.edit});
   await undo();
   expect((await inbox()).map(r=>r.draftId)).toEqual([rows[0].draftId]);
   await file([rows[1]],true);
   await expect(undo()).rejects.toMatchObject({code:409});
   await setScheduledRead(c(),1,{messages:[rows[1]],unread:true});
   expect(await inbox()).toMatchObject(rows.map(row=>({...row,inbox:1})));
   expect(await scheduledList(c(),1,3,{mark:'inbox'})).toEqual([]);
   expect(await scheduledList(c(),1,1,{countOnly:'1',includeInboxUnread:'1'})).toEqual({count:2,inboxUnread:1});
   expect((await scheduledList(c(),1,1,{mark:'inbox',isUnread:'1'})).map(r=>r.draftId)).toEqual([rows[1].draftId]);
   await file([rows[0]],false);
   expect((await inbox()).map(r=>r.draftId)).toEqual([rows[1].draftId]);
   expect(await scheduledList(c(),1,1)).toMatchObject(rows);
   await cancel(c(),1,rows[1].draftId,rows[1].version);
   await schedule(c(),1,rows[1].draftId,{version:rows[1].version+1,sendAt:when});
   expect(await inbox()).toEqual([]);
 });
 it('sets and undoes a queued reminder atomically while keeping the original send time and placement',async()=>{
   const {schedule,snoozeScheduled,scheduledList,setScheduledInbox,setScheduledRead,cancel}=await import('../src/cloud/scheduled');
   const {conversationList}=await import('../src/service/conversation-service');
   const now=Math.floor(Date.now()/1000),sendAt=now+7200,wakeAt=now+3600;
   const rows=[];
   for (const subject of ['Snooze first','Snooze second']) {
     const d=await draft({subject});
     const queued=await schedule(c(),1,d.draftId,{version:d.version,sendAt});
     rows.push({draftId:queued.draftId,version:queued.version,sendAt:queued.sendAt});
   }
   const snooze=(messages,time=wakeAt,uid=1)=>snoozeScheduled(c(),uid,{messages,wakeAt:time});
   const folder=mark=>scheduledList(c(),1,1,{mark});
   await setScheduledInbox(c(),1,{messages:[rows[0]],inbox:true});
   await setScheduledRead(c(),1,{messages:rows,unread:true});
   await expect(snooze(rows,now-1)).rejects.toMatchObject({code:400});
   await expect(snooze(rows,wakeAt,2)).rejects.toMatchObject({code:409});
   await expect(snooze([rows[0],{...rows[1],version:200}])).rejects.toMatchObject({code:409});
   expect(await folder('snoozed')).toEqual([]);
   const result=await snooze(rows);
   expect(await folder('snoozed')).toMatchObject(rows.map(row=>({...row,inbox:0,wakeAt})));
   expect(await folder('inbox')).toEqual([]);
   expect(await scheduledList(c(),1,1,{countOnly:'1',includeInboxUnread:'1',includeNextWake:'1'})).toEqual({count:2,inboxUnread:0,nextWakeAt:wakeAt});
   expect((await conversationList(c(),{folder:'inbox',accountId:1},1)).nextWakeAt).toBe(wakeAt);
   await setScheduledInbox(c(),1,{messages:rows,inbox:false,previousEdit:result.edit});
   expect(await folder('snoozed')).toEqual([]);
   expect((await folder('inbox')).map(row=>row.draftId)).toEqual([rows[0].draftId]);
   const first=await snooze(rows),later=await snooze([rows[0]],wakeAt+60);
   expect((await folder('snoozed')).map(row=>row.draftId)).toEqual([rows[1].draftId,rows[0].draftId]);
   for(const action of [setScheduledInbox,setScheduledRead,snoozeScheduled])
     await expect(action(c(),1,null)).rejects.toMatchObject({code:400});
   await expect(setScheduledInbox(c(),1,{messages:rows,inbox:false,previousEdit:first.edit})).rejects.toMatchObject({code:409});
   await setScheduledInbox(c(),1,{messages:[rows[0]],inbox:false,previousEdit:later.edit});
   expect(await folder('snoozed')).toMatchObject(rows.map(row=>({...row,wakeAt})));
   await cancel(c(),1,rows[0].draftId,rows[0].version);
   expect((await drafts.get(c(),1,rows[0].draftId)).scheduledWakeAt).toBeUndefined();
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledWakeAt',unixepoch()-1) WHERE draft_id=?").bind(rows[1].draftId).run();
   expect(await folder('snoozed')).toEqual([]);
   expect(await folder('inbox')).toMatchObject([{...rows[1],unread:1,inbox:1}]);
 });
 it('keeps a reminder on the sender copy after its scheduled delivery and returns the conversation to Inbox on wake',async()=>{
   const {schedule,snoozeScheduled,deliverDue,scheduledList}=await import('../src/cloud/scheduled');
   const {conversationList}=await import('../src/service/conversation-service');
   const d=await draft(),wakeAt=Math.floor(Date.now()/1000)+86400;
   const queued=await schedule(c(),1,d.draftId,{version:d.version,sendAt:wakeAt-300});
   await snoozeScheduled(c(),1,{messages:[queued],wakeAt});
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',1) WHERE draft_id=?").bind(d.draftId).run();
   await deliverDue(c());await deliverDue(c());
   expect(await scheduledList(c(),1,1)).toEqual([]);
   expect(await env.db.prepare('SELECT wake_at FROM scheduled_inbox_deliveries WHERE user_id=1').first('wake_at')).toBe(wakeAt);
   const list=(folder,user=1)=>conversationList(c(),{folder,accountId:user},user);
   expect((await list('snoozed')).threads).toMatchObject([{subject:d.subject,wakeAt}]);
   expect((await list('inbox')).threads).toEqual([]);
   expect((await list('snoozed',2)).threads).toEqual([]);
   await env.db.prepare('UPDATE conversation_filing SET wake_at=unixepoch()-1 WHERE user_id=1').run();
   expect((await list('inbox')).threads).toMatchObject([{subject:d.subject}]);
   expect((await list('snoozed')).threads).toEqual([]);
   expect(await env.db.prepare("SELECT count(*) n FROM send_attempts WHERE state='sent'").first('n')).toBe(1);
 });
 it('retains Inbox on the delivered conversation without filing the recipient’s mailbox',async()=>{
   const {schedule,setScheduledInbox,deliverDue}=await import('../src/cloud/scheduled');
   const {conversationList,conversationAction}=await import('../src/service/conversation-service');
   const original=await message();
   await conversationAction(c(),{emailIds:[original.email_id]},1,'archive');
   const d=await draft({subject:'Re: Original',sendType:'reply',emailId:original.email_id,
     receiveEmail:['person@example.com']});
   const row=await schedule(c(),1,d.draftId,{version:d.version,sendAt:Math.floor(Date.now()/1000)+60});
   await setScheduledInbox(c(),1,{messages:[row],inbox:true});
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',unixepoch()-1) WHERE draft_id=?").bind(d.draftId).run();
   await deliverDue(c());
   expect((await drafts.get(c(),1,d.draftId,true)).state).toBe('sent');
   expect(await env.db.prepare('SELECT count(*) n FROM scheduled_inbox_deliveries WHERE user_id=1').first('n')).toBe(1);
   await env.db.prepare("CREATE TRIGGER test_fail_filing BEFORE INSERT ON conversation_filing BEGIN SELECT RAISE(ABORT,'filing temporarily unavailable'); END").run();
   await expect(conversationList(c(),{folder:'inbox',accountId:1},1)).rejects.toThrow();
   expect(await env.db.prepare("SELECT count(*) n FROM send_attempts WHERE state='sent'").first('n')).toBe(1);
   expect(await env.db.prepare('SELECT count(*) n FROM scheduled_inbox_deliveries').first('n')).toBe(1);
   await env.db.prepare('DROP TRIGGER test_fail_filing').run();
   const box=await conversationList(c(),{folder:'inbox',accountId:1},1);
   expect(await env.db.prepare('SELECT count(*) n FROM scheduled_inbox_deliveries').first('n')).toBe(0);
   expect(box.threads).toHaveLength(1);
   expect(box.threads[0].messageCount).toBe(2);
   expect((await env.db.prepare('SELECT * FROM conversation_filing WHERE user_id!=1').all()).results).toEqual([]);
 });
 it('keeps a newer manual Archive when an arriving message delays the pending Inbox placement',async()=>{
   const {schedule,setScheduledInbox,deliverDue}=await import('../src/cloud/scheduled');
   const {conversationList,conversationAction}=await import('../src/service/conversation-service');
   const d=await draft();
   const row=await schedule(c(),1,d.draftId,{version:d.version,sendAt:Math.floor(Date.now()/1000)+60});
   await setScheduledInbox(c(),1,{messages:[row],inbox:true});
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',unixepoch()-1) WHERE draft_id=?").bind(d.draftId).run();
   await deliverDue(c());
   const sentId=await env.db.prepare('SELECT email_id FROM scheduled_inbox_deliveries WHERE user_id=1').first('email_id');
   // Reproduce an intervening arrival between the index scan and its revision write.
   await env.db.prepare('CREATE TRIGGER test_index_advanced AFTER UPDATE OF indexed_revision ON mobile_thread_state WHEN NEW.user_id=1 BEGIN UPDATE mobile_thread_state SET revision=revision+1 WHERE user_id=1; END').run();
   await conversationAction(c(),{emailIds:[sentId]},1,'archive');
   await env.db.prepare('DROP TRIGGER test_index_advanced').run();
   expect((await conversationList(c(),{folder:'inbox',accountId:1},1)).threads).toHaveLength(0);
   expect((await conversationList(c(),{folder:'archived',accountId:1},1)).threads).toMatchObject([{lastEmailId:sentId}]);
   expect(await env.db.prepare('SELECT count(*) n FROM scheduled_inbox_deliveries').first('n')).toBe(0);
 });
 it('removes pending Inbox placement when the message or its owner is permanently removed',async()=>{
   const first=await message(),second=await message({message_id:'<another@example.net>'});
   await env.db.prepare('INSERT INTO scheduled_inbox_deliveries(user_id,email_id) VALUES(1,?),(1,?)').bind(first.email_id,second.email_id).run();
   await env.db.prepare('DELETE FROM email WHERE email_id=?').bind(first.email_id).run();
   expect((await env.db.prepare('SELECT email_id FROM scheduled_inbox_deliveries').all()).results).toEqual([{email_id:second.email_id}]);
   await drafts.deleteUserData(c(),[1]);
   expect(await env.db.prepare('SELECT count(*) n FROM scheduled_inbox_deliveries').first('n')).toBe(0);
 });
 it('keeps filing choices through cancellation, edits and delivery, on the sender copy only',async()=>{
   const {schedule,scheduledList,cancel,setScheduledMark}=await import('../src/cloud/scheduled');
   const draftRow=await draft(),id=draftRow.draftId,sendAt=Math.floor(Date.now()/1000)+3600;
   const {version}=await schedule(c(),1,id,{version:draftRow.version,sendAt});
   const mark=(field,value)=>setScheduledMark(c(),1,id,{version,field,value});
   await expect(setScheduledMark(c(),2,id,{version,field:'starred',value:true})).rejects.toMatchObject({code:404});
   await Promise.all([mark('starred',true),mark('important',true)]);
   for(const filter of ['starred','important']) {
     expect(await scheduledList(c(),1,1,{mark:filter})).toMatchObject([{draftId:id,version,sendAt,starred:1,importanceReason:'user'}]);
     expect(await scheduledList(c(),1,3,{mark:filter})).toEqual([]);
   }
   await mark('starred',true);
   await cancel(c(),1,id,version);
   await expect(mark('important',false)).rejects.toMatchObject({code:409});
   const edited=await drafts.save(c(),1,{version:version+1,subject:'After cancel',mailboxStarred:0},id);
   expect(edited).toMatchObject({mailboxStarred:1,mailboxImportant:1});
   const result=await send(c(),1,{version:edited.version,idempotencyKey:'send-after-filing'},{draftId:id});
   expect(result.state).toBe('sent');
   const sentId=result.messages[0].emailId;
   expect((await env.db.prepare('SELECT user_id,email_id FROM star').all()).results).toEqual([{user_id:1,email_id:sentId}]);
   expect((await env.db.prepare('SELECT user_id,email_id,important FROM mailbox_importance').all()).results).toEqual([{user_id:1,email_id:sentId,important:1}]);
 });
 it('respects an explicit unimportant choice on a scheduled message to yourself after dispatch',async()=>{
   const {schedule,scheduledList,deliverDue,setScheduledMark}=await import('../src/cloud/scheduled');
   const d=await draft({receiveEmail:['admin@example.com']}),id=d.draftId;
   const {version}=await schedule(c(),1,id,{version:d.version,sendAt:Math.floor(Date.now()/1000)+120});
   expect(await scheduledList(c(),1,1,{mark:'important'})).toMatchObject([{importanceReason:'direct'}]);
   await setScheduledMark(c(),1,id,{version,field:'important',value:false});
   expect(await scheduledList(c(),1,1,{mark:'important'})).toEqual([]);
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',unixepoch()-1) WHERE draft_id=?").bind(id).run();
   await deliverDue(c());
   expect((await env.db.prepare('SELECT important FROM mailbox_importance').all()).results).toEqual([{important:0}]);
 });
 it('finds scheduled mail by body, hidden recipients and downloadable files while keeping the folder count unfiltered',async()=>{
   const {schedule,scheduledList}=await import('../src/cloud/scheduled');
   const when=Math.floor(Date.now()/1000)+3600;
   const attached=await draft({subject:'Notes',bcc:['finance@example.net'],content:'<p style="color:tomato">Quarterly <b>statement</b></p>',text:'\r\n',
     attachments:[{filename:'ledger.txt',content:'c2FtcGxl',contentType:'text/plain'}]});
   const inline=await draft({subject:'Photo',content:'<img src="data:image/png;base64,AAECAw==">'});
   for(const row of [attached,inline])await schedule(c(),1,row.draftId,{version:row.version,sendAt:when});
   await env.db.prepare("UPDATE cloud_drafts SET created_at='2023-11-05 06:00:00' WHERE draft_id=?").bind(attached.draftId).run();
   await env.db.prepare("UPDATE cloud_drafts SET created_at='2023-11-06 07:00:00' WHERE draft_id=?").bind(inline.draftId).run();
   const range={dateAfter:Date.parse('2023-11-05T06:00:00Z')/1000, dateBefore:Date.parse('2023-11-06T07:00:00Z')/1000};
   expect((await scheduledList(c(),1,1,range)).map(m=>m.draftId)).toEqual([attached.draftId]);
   const {searchPeople}=await import('../src/cloud/mail');
   expect(await searchPeople(c(),1,{folder:'scheduled',accountId:'1',field:'to',q:'finance'})).toEqual([{email:'finance@example.net',name:'finance@example.net'}]);
   expect(await searchPeople(c(),1,{folder:'scheduled',accountId:'2',field:'to',q:'finance'})).toEqual([]);
   for(const filter of [{to:'nobody',toAny:'["FINANCE@"]'},{to:'FINANCE@'},{q:'Quarterly statement'},{hasAttachment:'1'}]){
     const found=await scheduledList(c(),1,1,filter);
     expect(found.map(m=>m.draftId)).toEqual([attached.draftId]);
     expect(found[0]).toMatchObject({attachmentCount:1,attachments:[{filename:'ledger.txt'}]});
     expect(found[0].attachments[0]).not.toHaveProperty('content');
   }
   expect(await scheduledList(c(),1,1,{q:'tomato'})).toEqual([]);
   for (const excluded of ['finance','"quarterly statement"','ledger finance']) {
     expect((await scheduledList(c(),1,1,{excluded})).map(row=>row.draftId)).toEqual([inline.draftId]);
   }
   expect((await scheduledList(c(),1,1,{q:'Notes',excluded:'tomato quarter'})).map(row=>row.draftId)).toEqual([attached.draftId]);
   expect(await scheduledList(c(),1,1,{countOnly:'1',subject:'Notes'})).toEqual({count:2});
   expect(await scheduledList(c(),1,2,{countOnly:'1'})).toEqual({count:0});
 });
 it('filters queued drafts by UTF-8 subject, both body parts, and decoded files',async()=>{
   const {schedule,scheduledList}=await import('../src/cloud/scheduled');
   const d=await draft({subject:'☁',text:'é',content:'x',attachments:[{filename:'data.txt',content:'YWJj',contentType:'text/plain'}]});
   await schedule(c(),1,d.draftId,{version:d.version,sendAt:Math.floor(Date.now()/1000)+3600});
   const search=(sizeOperator,sizeValue)=>scheduledList(c(),1,1,{sizeUnit:'Bytes',sizeOperator,sizeValue});
   expect(await search('larger','8')).toHaveLength(1);
   expect(await search('larger','9')).toEqual([]);
   expect(await search('smaller','9')).toEqual([]);
   expect(await search('smaller','10')).toHaveLength(1);
 });
 it('delivers a scheduled plain-text draft literally with its ordinary attachment', async () => {
   const {schedule,deliverDue}=await import('../src/cloud/scheduled');
   const text='A <literal> message\nNext line';
   const d=await draft({plainText:true,content:'<div>A &lt;literal&gt; message</div><div>Next line</div>',text,
     attachments:[{filename:'note.txt',content:'bm90ZQ==',contentType:'text/plain'}]});
   await schedule(c(),1,d.draftId,{version:d.version,sendAt:Math.floor(Date.now()/1000)+120});
   expect(await drafts.get(c(),1,d.draftId,true)).toMatchObject({plainText:true,text});
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',unixepoch()-1) WHERE draft_id=?").bind(d.draftId).run();
   await deliverDue(c());
   const sent=await env.db.prepare('SELECT text,content FROM email WHERE type=1 AND user_id=1').first();
   expect(sent).toEqual({content:'',text});
 });
 it('dispatches a due internal message only once even when two ticks overlap',async()=>{
   const {schedule,deliverDue,scheduledList}=await import('../src/cloud/scheduled');
   const d=await draft();
   await schedule(c(),1,d.draftId,{version:d.version,sendAt:Math.floor(Date.now()/1000)+120});
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',unixepoch()-1) WHERE draft_id=?").bind(d.draftId).run();
   await Promise.all([worker.scheduled({cron:'* * * * *'},bindings()),worker.scheduled({cron:'* * * * *'},bindings())]);
   await deliverDue(c());
   expect((await drafts.get(c(),1,d.draftId,true)).state).toBe('sent');
   expect(await scheduledList(c(),1)).toEqual([]);
   expect((await env.db.prepare("SELECT COUNT(*) n FROM send_attempts WHERE state='sent'").first()).n).toBe(1);
   expect((await env.db.prepare("SELECT COUNT(*) n FROM email WHERE type=1 AND user_id=1").first()).n).toBe(1);
 });
 it('keeps the original draft editable when permission is revoked before delivery',async()=>{
   const {schedule,deliverDue,scheduledList,cancel}=await import('../src/cloud/scheduled');
   const d=await draft(), when=Math.floor(Date.now()/1000)+120;
   await expect(schedule(c(),1,d.draftId,{version:d.version,sendAt:1})).rejects.toMatchObject({code:400});
   await schedule(c(),1,d.draftId,{version:d.version,sendAt:when});
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',unixepoch()-1) WHERE draft_id=?").bind(d.draftId).run();
   await env.db.prepare("UPDATE user SET status=1 WHERE user_id=1").run();
   await deliverDue(c());
   await env.db.prepare("UPDATE user SET status=0 WHERE user_id=1").run();
   const [failed]=await scheduledList(c(),1);
   expect(failed).toMatchObject({state:'schedule_failed',draftId:d.draftId});
   expect((await env.db.prepare('SELECT COUNT(*) n FROM email').first()).n).toBe(0);
   await cancel(c(),1,d.draftId,failed.version);
   expect((await drafts.get(c(),1,d.draftId)).content).toBe(d.content);
 });
 it.each(['prepared','dispatching'])('reconciles interrupted %s attempts without repeating a possible delivery', async state=>{
   const {schedule,deliverDue,scheduledList}=await import('../src/cloud/scheduled');
   const d=await draft();
   await schedule(c(),1,d.draftId,{version:d.version,sendAt:Math.floor(Date.now()/1000)+60});
   const key=(await drafts.get(c(),1,d.draftId,true)).scheduleKey;
   await env.db.prepare("INSERT INTO send_attempts(user_id,idempotency_key,request_hash,draft_id,state) VALUES(1,?,'interrupted',?,?)").bind(key,d.draftId,state).run();
   await env.db.prepare("UPDATE cloud_drafts SET state='sending',data=json_set(data,'$.scheduledAt',unixepoch()-3600),updated_at=datetime('now','-30 minutes') WHERE draft_id=?").bind(d.draftId).run();
   await deliverDue(c());await deliverDue(c());
   const delivered=(await env.db.prepare('SELECT COUNT(*) n FROM email WHERE type=1 AND user_id=1').first()).n;
   expect(delivered).toBe(state==='prepared'?1:0);
   if(state==='dispatching')expect((await scheduledList(c(),1))[0].state).toBe('uncertain');
 });
});

describe('Scheduled Trash',()=>{
 const queue=async(extra={})=>{
   const {schedule}=await import('../src/cloud/scheduled');
   const d=await draft(extra);
   return {...d,...await schedule(c(),1,d.draftId,{version:d.version,sendAt:Math.floor(Date.now()/1000)+7200})};
 };
 it('moves a scheduled reply with inline and ordinary files through Trash, Undo, and recovery to Drafts',async()=>{
   const {trashScheduled,undoScheduledTrash}=await import('../src/cloud/scheduled-trash');
   const {scheduledList}=await import('../src/cloud/scheduled');
   const {setTrashLabels,moveFromTrash}=await import('../src/cloud/trash-actions');
   const original=await message();
   const label=await env.db.prepare("INSERT INTO mailbox_labels(user_id,name) VALUES(1,'Projects') RETURNING label_id").first('label_id');
   const d=await queue({sendType:'reply',emailId:original.email_id,labelIds:[label],bcc:['private@example.net'],
     content:'<b>Hello</b><img src="cid:photo">',attachments:[{filename:'notes.txt',content:'YWJj',contentType:'text/plain'},
       {filename:'photo.png',content:'aW1n',contentType:'image/png',contentId:'photo'}]});
   const request={edit:crypto.randomUUID(),messages:[d]};
   const edit=await trashScheduled(c(),1,request);
   expect(await trashScheduled(c(),1,request)).toEqual(edit);
   await expect(trashScheduled(c(),1,{...request,messages:[{...d,version:d.version+1}]})).rejects.toMatchObject({code:409});
   expect(await scheduledList(c(),1)).toEqual([]);
   expect((await drafts.list(c(),1)).drafts).toEqual([]);
   const [receipt]=(await mail.list(c(),1,{folder:'trash',hasAttachment:'1'})).messages;
   expect(receipt).toMatchObject({scheduledDraftId:d.draftId,attachmentCount:1,labelIds:[label]});
   expect((await mail.list(c(),2,{folder:'trash'})).messages).toEqual([]);
   const detail=await mail.detail(c(),1,receipt.emailId);
   const {default:publicFeed}=await import('../src/service/public-service');
   const {default:adminFeed}=await import('../src/service/email-service');
   const {default:stats}=await import('../src/dao/analysis-dao');
   expect(await publicFeed.emailList(c(),{subject:d.subject})).toEqual([]);
   expect((await adminFeed.allList(c(),{type:'send'})).total).toBe(0);
   expect(await adminFeed.selectUserEmailCountList(c(),[1],1)).toEqual([]);
   expect((await stats.numberCount(c())).sendTotal).toBe(0);
   expect(detail.content).toBe(d.content);
   expect(JSON.parse(detail.bcc)[0].address).toBe('private@example.net');
   expect(detail.attList).toHaveLength(2);
   const file=detail.attList.find(f=>f.filename==='notes.txt');
   expect(await new Response((await mail.attachment(c(),1,file.attId)).object.body).text()).toBe('abc');
   await expect(drafts.file(c(),1,d.attachments[0].attachmentId)).rejects.toMatchObject({code:404});
   await expect(moveFromTrash(env.db,1,[receipt.emailId],0)).rejects.toMatchObject({code:409});
   await setTrashLabels(env.db,1,[receipt.emailId],[],[label]);
   expect(await undoScheduledTrash(c(),1,edit)).toEqual({scheduled:1,drafts:0});
   expect(await undoScheduledTrash(c(),1,edit)).toEqual({scheduled:1,drafts:0});
   await expect(undoScheduledTrash(c(),1,null)).rejects.toMatchObject({code:409});
   const [again]=await scheduledList(c(),1);
   expect(again).toMatchObject({sendAt:d.sendAt,labelIds:[],attachmentCount:1});
   expect((await mail.list(c(),1,{folder:'sent'})).messages).toEqual([]);
   const second=await trashScheduled(c(),1,{messages:[again]});
   const [next]=(await mail.list(c(),1,{folder:'trash'})).messages;
   await mail.trash(c(),1,[next.emailId],'restore');
   const recovered=await drafts.get(c(),1,d.draftId);
   expect(recovered).toMatchObject({state:'draft',clientId:d.clientId,emailId:d.emailId,attachments:d.attachments,content:d.content,bcc:d.bcc});
   expect(recovered.scheduledAt).toBeUndefined();
   expect((await mail.list(c(),1,{folder:'sent'})).messages).toEqual([]);
   await expect(undoScheduledTrash(c(),1,second)).rejects.toMatchObject({code:409});
 });
 it('preserves draft consent for connected apps after an unsent message enters Trash',async()=>{
   const {trashScheduled}=await import('../src/cloud/scheduled-trash');
   const d=await queue({bcc:['blind@example.net'],attachments:[{filename:'notes.txt',content:'YWJj',contentType:'text/plain'}]});
   await trashScheduled(c(),1,{messages:[d]});
   const [row]=(await mail.list(c(),1,{folder:'trash'})).messages;
   const {access_token}=await connect('mail:read mail:delete');
   const call=async(token,name,args)=>(await rpc(token,'tools/call',{name,arguments:args})).data.result.structuredContent;
   expect((await call(access_token,'list_emails',{folder:'trash'})).messages).toEqual([]);
   for (const [name,args] of [['read_email',{emailId:row.emailId}],['get_attachment',{attachmentId:row.attachments[0].attId}],
      ['restore_emails',{emailIds:[row.emailId]}],['permanently_delete_emails',{emailIds:[row.emailId]}]]) {
     expect((await call(access_token,name,args)).code).toBe(404);
   }
   const full=await connect();
   expect((await call(full.access_token,'read_email',{emailId:row.emailId})).subject).toBe(d.subject);
 });
 it('returns the whole batch to Drafts when there is no space to resume delivery',async()=>{
   const {trashScheduled,undoScheduledTrash}=await import('../src/cloud/scheduled-trash');
   const a=await queue(),b=await queue();
   const receipt=await trashScheduled(c(),1,{messages:[a,b]});
   await expect(undoScheduledTrash(c(),1,{...receipt,count:1})).rejects.toMatchObject({code:409});
   await env.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<99)
     INSERT INTO cloud_drafts(user_id,account_id,client_id,data,state) SELECT 1,1,'capacity/'||i,json_object('scheduledAt',unixepoch()+3600),'scheduled' FROM n`).run();
   expect(await undoScheduledTrash(c(),1,receipt)).toEqual({scheduled:0,drafts:2});
   expect((await drafts.list(c(),1)).drafts.map(d=>d.draftId)).toEqual([a.draftId,b.draftId]);
 });
 it('fences dispatch and bulk changes, restores overdue mail as a draft and purges expired files',async()=>{
   const {trashScheduled,undoScheduledTrash}=await import('../src/cloud/scheduled-trash');
   const {deliverDue}=await import('../src/cloud/scheduled');
   const a=await queue({plainText:true,text:'<hello>',attachments:[{filename:'notes.txt',content:'YWJj',contentType:'text/plain'}]}), b=await queue();
   await env.db.prepare("UPDATE cloud_drafts SET state='sending' WHERE draft_id=?").bind(b.draftId).run();
   await expect(trashScheduled(c(),1,{messages:[a,b]})).rejects.toMatchObject({code:409});
   expect((await mail.list(c(),1,{folder:'trash'})).messages).toEqual([]);
   await env.db.prepare("UPDATE cloud_drafts SET data=json_set(data,'$.scheduledAt',1) WHERE draft_id=?").bind(a.draftId).run();
   const first=await trashScheduled(c(),1,{messages:[a]});
   await deliverDue(c());
   expect((await mail.list(c(),2,{folder:'inbox'})).messages).toEqual([]);
   const [receipt]=(await mail.list(c(),1,{folder:'trash'})).messages;
   expect(await mail.detail(c(),1,receipt.emailId)).toMatchObject({content:'',text:'<hello>'});
   expect(await undoScheduledTrash(c(),1,first)).toEqual({scheduled:0,drafts:1});
   const after=await queue({attachments:[{filename:'notes.txt',content:'YWJj',contentType:'text/plain'}]});
   const row=await env.db.prepare('SELECT key FROM draft_files WHERE attachment_id=?').bind(after.attachments[0].attachmentId).first();
   const last=await trashScheduled(c(),1,{messages:[after]});
   await env.db.prepare("UPDATE email SET trashed_at=datetime('now','-31 days') WHERE scheduled_draft_id=?").bind(after.draftId).run();
   await mail.purgeExpired(c());
   expect((await drafts.get(c(),1,after.draftId,true)).state).toBe('deleted');
   await expect(undoScheduledTrash(c(),1,last)).rejects.toMatchObject({code:409});
   expect(await env.r2.get(row.key)).toBeNull();
 });
});
describe('signature settings',()=>{
 it('isolates owners, keeps supported formatting and prevents a stale editor overwriting changes',async()=>{
   const {readSignatures,saveSignatures}=await import('../src/cloud/signatures');
   const initial=await readSignatures(env.db,1);
   const incoming={...initial,items:[{id:'work',name:'Work',html:'<b style="color:#123456" id="editor-only">Team</b> <a href="https://example.org/">Website</a>'}],
     defaults:{1:{newMail:'work',reply:null}},beforeQuote:true};
   const saved=await saveSignatures(env.db,1,incoming);
   expect(saved.items[0].html).toContain('color:#123456');expect(saved.items[0].html).not.toContain('editor-only');
   expect(await readSignatures(env.db,1)).toEqual(saved);expect(await readSignatures(env.db,2)).toEqual(initial);
   await expect(saveSignatures(env.db,1,incoming)).rejects.toMatchObject({code:409});
   await expect(saveSignatures(env.db,1,{...saved,items:[]})).rejects.toMatchObject({code:400});
   expect((await saveSignatures(env.db,1,{...saved,items:[],defaults:{}})).version).toBe(2);
   await drafts.deleteUserData(c(),[1]);expect(await readSignatures(env.db,1)).toEqual(initial);
 });
});
