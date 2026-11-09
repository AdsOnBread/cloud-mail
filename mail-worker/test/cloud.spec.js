import {env,createExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {dbInit} from '../src/init/init';
import * as drafts from '../src/cloud/drafts';
import * as mail from '../src/cloud/mail';
import {send,prepare} from '../src/cloud/send';
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
 it('allows only one concurrent draft writer',async()=>{
   const d=await draft();const edits=await Promise.allSettled(['A','B'].map(subject=>drafts.save(c(),1,{version:d.version,subject},d.draftId)));
   expect(edits.filter(e=>e.status==='fulfilled')).toHaveLength(1);
   expect(edits.find(e=>e.status==='rejected').reason.code).toBe(409);
 });
});
describe('Send attempts',()=>{
 it('sends a saved draft once, replays its result and refuses changed key reuse',async()=>{
   const d=await draft();const input={version:d.version,idempotencyKey:'send-draft-0001'};
   const sent=await send(c(),1,input,{draftId:d.draftId});expect(sent.state).toBe('sent');
   expect(await send(c(),1,input,{draftId:d.draftId})).toEqual(sent);
   expect((await env.db.prepare('SELECT COUNT(*) total FROM email WHERE type=1').first()).total).toBe(1);
   await expect(send(c(),1,{...input,version:2},{draftId:d.draftId})).rejects.toMatchObject({code:409});
   await expect(drafts.get(c(),1,d.draftId)).rejects.toMatchObject({code:404});
 });
 it('claims a draft atomically across clients and preserves a failed draft',async()=>{
   const d=await draft({subject:''});const result=await send(c(),1,{version:d.version,idempotencyKey:'failed-draft-001'},{draftId:d.draftId});expect(result.state).toBe('failed');
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
 it('prepares reply-all without aliases or Bcc and forwards ordinary files independently',async()=>{
   const original=await message();
   const reply=await prepare(c(),1,{accountId:1,emailId:original.email_id,text:'Reply',replyAll:true},'reply');
   expect(reply.receiveEmail).toEqual(['outside@example.net','copy@example.net']);expect(reply.cc).toEqual(['cc@example.net']);expect(reply.bcc).toEqual([]);
   const forwarded=await prepare(c(),1,{accountId:1,emailId:original.email_id,text:'Forward'},'forward');expect(forwarded.content).toContain('Original body');
 });
});
describe('Recoverable Trash',()=>{
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
 it('offers unchecked sending on read-only reconnect and grants it only when selected',async()=>{
   const inspect=html=>{
     const {document}=parseHTML(html);
     const send=document.querySelector('input[name="scope"][value="mail:send"]');
     expect(send).not.toBeNull();expect(send.hasAttribute('checked')).toBe(false);
     expect(send.parentNode.textContent).toContain('optional');
     expect(document.querySelector('input[value="mail:read"]').hasAttribute('checked')).toBe(true);
     expect(document.querySelector('input[value="mail:delete"]')).toBeNull();
   };
   const readOnly=await connect('mail:read','mail:read',inspect);expect(readOnly.scope).toBe('mail:read');
   const optedIn=await connect('mail:read','mail:read mail:send',inspect);
   expect(optedIn.scope.split(' ')).toEqual(['mail:read','mail:send']);
   const records=(await env.db.prepare('SELECT scopes FROM connected_apps ORDER BY rowid').all()).results;
   expect(records.map(row=>JSON.parse(row.scopes))).toEqual([['mail:read'],['mail:read','mail:send']]);
   const oldToken=(await rpc(readOnly.access_token,'tools/call',{name:'send_email',arguments:{accountId:1,idempotencyKey:'old-grant-unchanged'}})).data.result;
   expect(oldToken._meta['mcp/www_authenticate'][0]).toContain('mail:send');
   const ownedOnly=(await rpc(optedIn.access_token,'tools/call',{name:'send_email',arguments:{accountId:2,idempotencyKey:'optional-send-owner'}})).data.result;
   expect(ownedOnly.structuredContent.code).toBe(404);expect(ownedOnly._meta).toBeUndefined();
 });
 it('leaves sending unchecked even when requested by the client',async()=>{
   const token=await connect('mail:read mail:send','mail:read',html=>{
     const {document}=parseHTML(html);
     expect(document.querySelectorAll('input[value="mail:send"]')).toHaveLength(1);
     expect(document.querySelector('input[value="mail:send"]').hasAttribute('checked')).toBe(false);
   });
   expect(token.scope).toBe('mail:read');
 });
 it.each(['secret','password'])('preserves explicit send selection after an incorrect %s without granting access',async field=>{
   const {cookie,handle}=await startConnection('mail:read');
   const form=new URLSearchParams({handle,decision:'approve',secret:'test-installation-secret',email:'admin@example.com',password:'test-password'});
   form.append('scope','mail:read');form.append('scope','mail:send');form.set(field,'incorrect');
   const retry=await fetchWorker('/oauth/authorize',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded',Origin:'https://mail.example.com'},body:form});
   expect(retry.status).toBe(200);expect(retry.headers.get('Location')).toBeNull();
   expect((await env.db.prepare('SELECT COUNT(*) total FROM connected_apps').first()).total).toBe(0);
   const html=await retry.text(),{document}=parseHTML(html);
   expect(document.querySelector('input[value="mail:send"]').hasAttribute('checked')).toBe(true);
   expect(document.querySelector('input[value="mail:delete"]')).toBeNull();
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
 it('does not ask for OAuth again when the Cloudmail role forbids sending',async()=>{
   const token=await connect('mail:read mail:send');
   await env.db.prepare("UPDATE user SET email='restricted@example.com',type=999 WHERE user_id=1").run();
   const denied=(await rpc(token.access_token,'tools/call',{name:'send_email',arguments:{accountId:1,idempotencyKey:'role-denied-send'}})).data.result;
   expect(denied.structuredContent.code).toBe(403);expect(denied._meta).toBeUndefined();
   expect((await env.db.prepare('SELECT COUNT(*) total FROM send_attempts').first()).total).toBe(0);
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
