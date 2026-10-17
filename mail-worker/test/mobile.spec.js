import { env } from 'cloudflare:test';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { dbInit } from '../src/init/init';
import * as mobile from '../src/mobile/service';
import { groupThreads } from '../src/mobile/threads';
import { accessGate } from '../src/security/app-access';
import emailService from '../src/service/email-service';
import { buildMessage } from '../src/service/email-sender';
import settingService from '../src/service/setting-service';
import loginService from '../src/service/login-service';
import worker from '../src/index';
const secureEnv = () => ({...env,app_access_secret:'test-installation-secret',init_secret:'test-init-credential'});
const context = () => ({env:secureEnv(),get:key=>key==='user'?{userId:1,email:'admin@example.com'}:undefined,set:()=>{},req:{header:()=>undefined},text:s=>s});
const request = (path,options={})=>new Request('https://mail.example.com'+path,options);
async function insert(extra={}) {
	const row={user_id:1,account_id:1,subject:'Project',send_email:'outside@external.com',name:'Outside',recipient:'[{"address":"admin@example.com"}]',text:'Hello',content:'<p>Hello</p>',status:0,type:0,...extra};
	const keys=Object.keys(row);
	return (await env.db.prepare(`INSERT INTO email (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')}) RETURNING *`).bind(...Object.values(row)).first());
}
beforeEach(async()=>{
	vi.spyOn(console,'warn').mockImplementation(()=>{});
	vi.spyOn(console,'error').mockImplementation(()=>{});
	await dbInit.init(context());
	await env.db.prepare("INSERT INTO user (user_id,email,password,salt) VALUES (1,'admin@example.com','unused','unused'),(2,'person@example.com','unused','unused')").run();
	await env.db.prepare("INSERT INTO account (account_id,email,user_id,name) VALUES (1,'admin@example.com',1,'Admin'),(2,'person@example.com',2,'Person'),(3,'alias@example.com',1,'Alias')").run();
	await env.db.prepare('UPDATE setting SET send=0').run();
	await settingService.refresh(context());
});
afterEach(()=>vi.restoreAllMocks());

describe('Installation access',()=>{
	it('fails closed without a configured installation secret and rejects cross-origin unlocks',async()=>{
		expect((await accessGate(request('/api/login'),env)).status).toBe(503);
		expect((await accessGate(request('/api/access/unlock',{method:'POST',headers:{Origin:'https://attacker.example'},body:'{}'}),secureEnv())).status).toBe(403);
	});
	it('accepts native access and creates expiring, rotation-sensitive browser cookies',async()=>{
		const req=request('/api/login',{headers:{'X-Cloudmail-App-Secret':secureEnv().app_access_secret}});
		expect(await accessGate(req,secureEnv())).toBeNull();
		const unlocked=await accessGate(request('/api/access/unlock',{method:'POST',body:JSON.stringify({secret:secureEnv().app_access_secret})}),secureEnv());
		expect(unlocked.status).toBe(200);
		const cookie=unlocked.headers.get('set-cookie');
		expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure');
		expect(await accessGate(request('/api/my/loginUserInfo',{headers:{Cookie:cookie.split(';')[0]}}),secureEnv())).toBeNull();
		expect((await accessGate(request('/api/my/loginUserInfo',{headers:{Cookie:cookie.split(';')[0]}}),{...secureEnv(),app_access_secret:'rotated'})).status).toBe(403);
	});
	it('rate limits failed unlock attempts',async()=>{
		for(let i=0;i<10;i++) expect((await accessGate(request('/api/access/unlock',{method:'POST',body:'{"secret":"wrong"}'}),secureEnv())).status).toBe(403);
		expect((await accessGate(request('/api/access/unlock',{method:'POST',body:'{"secret":"wrong"}'}),secureEnv())).status).toBe(429);
	});
	it('requires both access and mailbox authorization, including legacy storage paths',async()=>{
		const token=await loginService.login(context(),{email:'person@example.com'},true);
		const headers={'X-Cloudmail-App-Secret':secureEnv().app_access_secret,Authorization:token};
		expect((await worker.fetch(request('/api/mobile/v1/bootstrap'),secureEnv(),{})).status).toBe(403);
		const boot=await worker.fetch(request('/api/mobile/v1/bootstrap',{headers}),secureEnv(),{});
		expect(boot.headers.get('Cache-Control')).toBe('private, no-store');
		expect((await boot.json()).data.mailboxes.map(m=>m.userId)).toEqual([2]);
		const row=await insert();
		await env.db.prepare("INSERT INTO attachments(user_id,email_id,account_id,key,filename) VALUES (1,?,1,'attachments/private.pdf','private.pdf')").bind(row.email_id).run();
		const denied=await worker.fetch(request('/attachments/private.pdf',{headers}),secureEnv(),{});
		expect((await denied.json()).code).toBe(404);
	});
});

describe('Mobile synchronization',()=>{
	it('bootstraps user-scoped threads, mailboxes, unread totals and search',async()=>{
		await insert({message_id:'<root@external.com>'});
		await insert({type:1,subject:'Re: Project',send_email:'admin@example.com',recipient:'[{"address":"outside@external.com"}]',in_reply_to:'<root@external.com>'});
		await insert({user_id:2,account_id:2,subject:'Private'});
		const boot=await mobile.bootstrap(env.db,1);
		expect(boot.mailboxes).toHaveLength(2); expect(boot.unreadTotal).toBe(1); expect(boot.threads).toHaveLength(1);
		expect(boot.threads[0]).toMatchObject({messageCount:2,sentCount:1,inboxCount:1});
		expect((await mobile.threads(env.db,1,{q:'outside'})).threads).toHaveLength(1);
		expect((await mobile.threads(env.db,1,{q:'Private'})).threads).toHaveLength(0);
	});
	it('pages every change in ascending order without losing a burst, replays safely, and isolates users',async()=>{
		const baseline=await mobile.bootstrap(env.db,1);
		for(let i=0;i<65;i++) await insert({subject:'Burst '+i});
		await insert({user_id:2,account_id:2});
		let cursor=baseline.cursor, seen=new Set(),page;
		do {
			page=await mobile.changes(env.db,1,{after:cursor,limit:17});
			expect(page.changes.every(c=>!c.message || c.message.userId===1)).toBe(true);
			for(const c of page.changes) if(c.newMail) seen.add(c.entityId);
			const replay=await mobile.changes(env.db,1,{after:cursor,limit:17});
			expect(replay.cursor).toBe(page.cursor);
			cursor=page.cursor;
		}while(page.hasMore);
		expect(seen.size).toBe(65);
	});
	it('does not announce mail until receipt completes and records web read/star/deletion changes',async()=>{
		const baseline=await mobile.bootstrap(env.db,1);
		const row=await insert({status:6,is_del:1});
		const saving=await mobile.changes(env.db,1,{after:baseline.cursor});
		expect(saving.changes.some(c=>c.newMail)).toBe(false);
		await emailService.completeReceive(context(),0,row.email_id);
		const complete=await mobile.changes(env.db,1,{after:saving.cursor});
		expect(complete.changes.some(c=>c.newMail && c.message?.emailId===row.email_id)).toBe(true);
		await emailService.read(context(),{emailIds:[row.email_id]},1);
		await env.db.prepare('INSERT INTO star(user_id,email_id) VALUES (1,?)').bind(row.email_id).run();
		const changed=await mobile.changes(env.db,1,{after:complete.cursor});
		expect(changed.changes.at(-1).message).toMatchObject({unread:1,isStar:1});
		await env.db.prepare('DELETE FROM email WHERE email_id=?').bind(row.email_id).run();
		const deleted=await mobile.changes(env.db,1,{after:changed.cursor});
		expect(deleted.changes).toContainEqual(expect.objectContaining({entityId:row.email_id,operation:'delete'}));
		expect(deleted.removedThreadIds).toContain('t-'+row.email_id);
	});
	it('preserves attachment bytes and updates conversations when a mailbox disappears',async()=>{
        const first=await insert({message_id:'<same@external.com>'});
        await insert({account_id:3,in_reply_to:'<same@external.com>'});
        const baseline=await mobile.bootstrap(env.db,1);
        expect(baseline.threads[0].messageCount).toBe(2);
        const att=await env.db.prepare("INSERT INTO attachments(user_id,email_id,account_id,key,filename,mime_type) VALUES (1,?,1,'attachments/result.json','result.json','application/json') RETURNING att_id").bind(first.email_id).first();
        const bytes=new TextEncoder().encode('{"code":401,"message":"ordinary attachment data"}');
        await env.r2.put('attachments/result.json',bytes);
        const response=await mobile.attachment(context(),1,{id:att.att_id});
        expect(response.status).toBe(200);expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        await expect(mobile.attachment(context(),2,{id:att.att_id})).rejects.toMatchObject({code:404});
        await env.db.prepare('UPDATE account SET is_del=1 WHERE account_id=3').run();
        const changed=await mobile.changes(env.db,1,{after:baseline.cursor});
        expect(changed.threads[0].messageCount).toBe(1);
        expect(changed.mailboxes.map(m=>m.accountId)).toEqual([1]);
    });
	it('rejects cross-user details and attachment downloads and supports mark unread',async()=>{
		const row=await insert();
		await expect(mobile.messageDetail(env.db,2,row.email_id)).rejects.toMatchObject({code:404});
		await emailService.read(context(),{emailIds:[row.email_id]},1);
		await emailService.read(context(),{emailIds:[row.email_id],unread:0},1);
		expect((await mobile.messageDetail(env.db,1,row.email_id)).unread).toBe(0);
	});
});

describe('Conversation relationships',()=>{
	const message=(email_id,extra={})=>({email_id,user_id:1,subject:'Status',send_email:'outside@external.com',recipient:'[{"address":"admin@example.com"}]',cc:'[]',create_time:'2026-10-01 12:00:00',...extra});
	it('connects late parents and sent replies, without merging users or conflicting references',()=>{
		const groups=groupThreads([message(1,{in_reply_to:'<late@external.com>'}),message(2,{message_id:'<late@external.com>'}),message(3,{user_id:2,message_id:'<late@external.com>'}),message(4,{reply_to_email_id:1,send_email:'admin@example.com',recipient:'[{"address":"outside@external.com"}]'})],['admin@example.com']);
		expect(groups.map(g=>g.threadId)).toEqual(['t-1','t-1','t-3','t-1']);
		const separate=groupThreads([message(1,{relation:'<a@x>'}),message(2,{relation:'<b@x>'})],['admin@example.com']);
		expect(separate[0].threadId).not.toBe(separate[1].threadId);
	});
	it('keeps missing-header subjects separate across participants and the 14-day window',()=>{
		const groups=groupThreads([message(1),message(2,{subject:'Re: Status'}),message(3,{create_time:'2026-10-20 12:00:00'}),message(4,{send_email:'different@external.com'})],['admin@example.com']);
		expect(groups.map(g=>g.threadId)).toEqual(['t-1','t-1','t-3','t-4']);
	});
});

describe('Cc, Bcc, and reply privacy',()=>{
	it('keeps Bcc only in the sender copy and delivers to every unique internal recipient',async()=>{
		const [sent]=await emailService.send(context(),{accountId:1,subject:'Private cc',content:'<p>Hello</p>',receiveEmail:['person@example.com'],cc:['alias@example.com'],bcc:['admin@example.com']},1);
		expect(JSON.parse(sent.bcc)[0].address).toBe('admin@example.com');
		const received=(await env.db.prepare('SELECT * FROM email WHERE type=0').all()).results;
		expect(received).toHaveLength(3); expect(received.every(r=>r.bcc==='[]')).toBe(true);
		expect(received.every(r=>JSON.parse(r.cc)[0].address==='alias@example.com')).toBe(true);
	});
	it('uses provider cc/bcc fields, preserves references, and rejects cross-user replies',async()=>{
		const message=await buildMessage({accountEmail:'admin@example.com',name:'Admin',subject:'Hello',text:'Hello',receiveEmail:['a@external.com'],cc:['c@external.com'],bcc:['hidden@external.com'],sendType:'reply',messageId:'<parent@x>',references:'<root@x> <parent@x>'});
		expect(message).toMatchObject({cc:['c@external.com'],bcc:['hidden@external.com'],headers:{References:'<root@x> <parent@x>'}});
		const other=await insert({user_id:2,account_id:2});
		await expect(emailService.send(context(),{accountId:1,subject:'Reply',content:'<p>reply</p>',receiveEmail:['person@example.com'],sendType:'reply',emailId:other.email_id},1)).rejects.toBeDefined();
	});
});
