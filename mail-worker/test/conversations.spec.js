import { env } from 'cloudflare:test';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { dbInit } from '../src/init/init';
import { conversationList, conversationMessages, conversationAction } from '../src/service/conversation-service';
import * as cloudMail from '../src/cloud/mail';
import emailService from '../src/service/email-service';
import settingService from '../src/service/setting-service';
import * as mobile from '../src/mobile/service';
import worker from '../src/index';
import loginService from '../src/service/login-service';
import permService from '../src/service/perm-service';
const context = () => ({
	env,
	get: (key) => (key === 'user' ? { userId: 1, email: 'admin@example.com' } : undefined),
	set: () => {},
	text: (s) => s,
	req: { header: () => undefined },
});
async function insert(extra = {}) {
	const row = {
		user_id: 1,
		account_id: 1,
		subject: 'Project',
		send_email: 'outside@external.com',
		name: 'Outside',
		recipient: '[{"address":"admin@example.com"}]',
		text: 'Hello',
		content: '<p>Hello</p>',
		status: 0,
		type: 0,
		...extra,
	};
	return env.db
		.prepare(
			`INSERT INTO email (${Object.keys(row).join(',')}) VALUES (${Object.keys(row)
				.map(() => '?')
				.join(',')}) RETURNING *`,
		)
		.bind(...Object.values(row))
		.first();
}
const list = (p = {}) => conversationList(context(), { folder: 'inbox', accountId: 1, ...p }, 1);
const messages = (id, p = {}) => conversationMessages(context(), { emailId: id, ...p }, 1);
const action = (name, ids, p = {}) => conversationAction(context(), { emailIds: ids, ...p }, 1, name);
beforeEach(async () => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	await dbInit.init(context());
	await env.db
		.prepare(
			"INSERT INTO user(user_id,email,password,salt) VALUES(1,'admin@example.com','unused','unused'),(2,'other@example.com','unused','unused')",
		)
		.run();
	await env.db
		.prepare(
			"INSERT INTO account(account_id,email,user_id,name) VALUES(1,'admin@example.com',1,'Admin'),(2,'other@example.com',2,'Other'),(3,'alias@example.com',1,'Alias')",
		)
		.run();
	await env.db.prepare('UPDATE setting SET send=0,sync_delete=1').run();
	await settingService.refresh(context());
});
afterEach(() => vi.restoreAllMocks());
describe('Web conversations', () => {
	it('names the destination of a sent blind-copy-only message without returning its raw address fields', async () => {
		await insert({ type: 1, status: 1, recipient: '[]', cc: '[]', bcc: '[{"address":"private@example.com"}]' });
		const [row] = (await list({folder:'sent'})).threads;
		expect(row.participants).toBe('Bcc: private@example.com');
		expect(row).not.toHaveProperty('sentBcc');
	});
	it('shares iOS grouping, filters eligible conversations, and opens all owned messages', async () => {
		const root = await insert({ message_id: '<project@external.com>' });
		const sent = await insert({
			type: 1,
			account_id: 3,
			subject: 'Re: Project',
			in_reply_to: '<project@external.com>',
			send_email: 'alias@example.com',
			recipient: '[{"address":"outside@external.com"}]',
		});
		await insert({ user_id: 2, account_id: 2, message_id: '<project@external.com>' });
		await env.db.prepare('INSERT INTO star(user_id,email_id) VALUES(1,?)').bind(root.email_id).run();
		for (const p of [{}, { folder: 'sent', accountId: 3 }, { folder: 'starred', accountId: 2 }])
			expect((await list(p)).threads[0]).toMatchObject({ messageCount: 2, lastEmailId: sent.email_id, starred: 1 });
		expect((await list({ accountId: 3 })).total).toBe(0);
		expect((await list({ allReceive: 1 })).total).toBe(1);
		const opened = await messages(root.email_id);
		expect(opened.messages.map((m) => m.emailId)).toEqual([root.email_id, sent.email_id]);
		expect((await mobile.threads(env.db, 1, { folder: 'inbox' })).threads[0].threadId).toBe(opened.threadId);
	});
	it('lists only downloadable attachments on this page, including files from earlier thread members', async () => {
    const root=await insert({message_id:'<files@example.com>'});
    const reply=await insert({type:1,in_reply_to:'<files@example.com>'});
    const other=await insert({subject:'Inline only'});
    const add=(id,name,type=0,cid=null,owner=1,account=1)=>env.db.prepare(
      'INSERT INTO attachments(email_id,user_id,account_id,key,filename,type,content_id) VALUES(?,?,?,?,?,?,?)'
    ).bind(id,owner,account,'attachments/'+name,name,type,cid).run();
    for (const name of ['a.txt','b.txt','c.txt','d.txt']) await add(root.email_id,name);
    await add(other.email_id,'inline.png',1,'embedded');
    await add(other.email_id,'foreign.txt',0,null,2,2);
    const page=await list({hasAttachment:1});
    expect(page.total).toBe(1);
    expect(page.threads[0].attachmentCount).toBe(4);
    expect(page.threads[0].attachments.map(file=>file.filename)).toEqual(['a.txt','b.txt','c.txt']);
    expect((await list({folder:'sent',hasAttachment:1})).total).toBe(1);
    await add(reply.email_id,'reply.txt',0,'<reference>');
    await env.db.prepare("UPDATE attachments SET disposition='attachment' WHERE email_id=?").bind(reply.email_id).run();
    await env.db.prepare('DELETE FROM attachments WHERE email_id=?').bind(root.email_id).run();
    expect((await list({hasAttachment:1})).threads[0].attachments[0].filename).toBe('reply.txt');
    await cloudMail.trash(context(),1,[reply.email_id]);
    expect((await list()).threads.every(row=>!row.attachmentCount)).toBe(true);
    expect((await cloudMail.list(context(),1,{folder:'trash',hasAttachment:1})).messages[0].attachmentCount).toBe(1);
  });
  it.each(['name', 'send_email', 'recipient', 'cc', 'subject', 'text', 'content'])('matches literal substring in %s', async (field) => {
		const root = await insert({ [field]: 'a%b_c\\d' });
		await insert({ subject: 'No match' });
		expect((await list({ q: '%b_c\\' })).threads.map((t) => t.lastEmailId)).toEqual([root.email_id]);
		expect((await list({ q: "' OR 1=1 --" })).total).toBe(0);
	});
	it('never searches or exposes received Bcc; searches owned sent Bcc only', async () => {
		const root = await insert({ bcc: '[{"address":"hidden@external.com"}]', message_id: '<root@external.com>' });
		const sent = await insert({ type: 1, bcc: '[{"address":"hidden@external.com"}]', in_reply_to: '<root@external.com>' });
		expect((await list({ q: 'hidden' })).total).toBe(0);
		expect((await list({ folder: 'sent', q: 'hidden' })).total).toBe(1);
		expect((await messages(root.email_id)).messages.map((m) => m.bcc)).toEqual(['[]', '[{"address":"hidden@external.com"}]']);
	});
	it('keeps filing consistent across web, mobile sync and cloud inboxes, including member deletion and new mail', async () => {
		const first=await insert({message_id:'<filed@example.com>'});
		const latest=await insert({in_reply_to:'<filed@example.com>'});
		const before=await mobile.bootstrap(env.db,1);
		await action('archive',[latest.email_id]);
		expect((await list()).total).toBe(0);
		expect((await mobile.changes(env.db,1,{after:before.cursor})).threads[0].inboxCount).toBe(0);
		expect((await mobile.bootstrap(env.db,1)).unreadTotal).toBe(0);
		expect((await cloudMail.list(context(),1,{folder:'inbox'})).messages).toHaveLength(0);
		await cloudMail.trash(context(),1,[latest.email_id]);
		expect((await list({folder:'archived'})).threads[0].lastEmailId).toBe(first.email_id);
		expect((await list()).total).toBe(0);
		await insert({in_reply_to:'<filed@example.com>'});
		expect((await list()).total).toBe(1);
		expect((await list({folder:'archived'})).total).toBe(0);
		expect((await cloudMail.list(context(),1,{folder:'inbox'})).messages).toHaveLength(2);
	});
	it('brings due snoozes to the top and pages by reminder time with a stable ID tie-break', async () => {
		const older=await insert({subject:'Old',create_time:'2020-01-01 00:00:00'});
		const newer=await insert({subject:'Recent',create_time:'2021-01-01 00:00:00'});
		await action('snooze',[older.email_id],{wakeAt:Math.floor(Date.now()/1000)+60});
		expect((await list({folder:'snoozed'})).threads[0].subject).toBe('Old');
		expect((await list()).threads[0].subject).toBe('Recent');
		const before=await mobile.bootstrap(env.db,1);
		await env.db.prepare('UPDATE conversation_filing SET wake_at=unixepoch()-1 WHERE user_id=1').run();
		expect((await mobile.changes(env.db,1,{after:before.cursor})).threads[0].inboxCount).toBe(1);
		const first=await list({limit:1});
		expect(first.threads[0].lastEmailId).toBe(older.email_id);
		expect((await list({limit:1,cursor:first.nextCursor})).threads[0].lastEmailId).toBe(newer.email_id);
		expect((await list({folder:'snoozed'})).total).toBe(0);
	});
	it('syncs an expired reminder after the newest snoozed member was trashed and synchronized', async () => {
		const first=await insert({message_id:'<wake@example.com>'});
		const last=await insert({in_reply_to:'<wake@example.com>'});
		await action('snooze',[last.email_id],{wakeAt:Math.floor(Date.now()/1000)+120});
		await cloudMail.trash(context(),1,[last.email_id]);
		const before=await mobile.bootstrap(env.db,1);
		await env.db.prepare('UPDATE conversation_filing SET wake_at=unixepoch()-1 WHERE user_id=1').run();
		const changed=await mobile.changes(env.db,1,{after:before.cursor});
		expect(changed.threads).toHaveLength(1);
		expect(changed.threads[0]).toMatchObject({inboxCount:1,lastEmailId:first.email_id});
	});
	it('keeps a sent-only snooze when another outgoing reply joins and can move it to Inbox', async () => {
		const first=await insert({type:1,message_id:'<sent-only@example.com>'});
		await action('snooze',[first.email_id],{wakeAt:Math.floor(Date.now()/1000)+3600});
		const last=await insert({type:1,in_reply_to:'<sent-only@example.com>'});
		expect((await list({folder:'snoozed'})).threads[0].lastEmailId).toBe(last.email_id);
		await action('inbox',[last.email_id]);
		expect((await list()).threads[0].lastEmailId).toBe(last.email_id);
	});
	it('has consistent totals and cursors in both sort orders', async () => {
		const ids = [];
		for (let i = 0; i < 5; i++) ids.push((await insert({ subject: 'Unique ' + i })).email_id);
		for (const timeSort of [0, 1]) {
			const first = await list({ limit: 2, timeSort }),
				second = await list({ limit: 2, timeSort, cursor: first.nextCursor }),
				third = await list({ limit: 2, timeSort, cursor: second.nextCursor });
			expect([first.total, second.total, third.total]).toEqual([5, 5, 5]);
			expect(third.hasMore).toBe(false);
			expect([...first.threads, ...second.threads, ...third.threads].map((t) => t.lastEmailId)).toEqual(
				timeSort ? ids : [...ids].reverse(),
			);
		}
	});
	it('pages newest messages chronologically and resolves regrouped membership from an anchor', async () => {
		const child = await insert({ in_reply_to: '<late@external.com>' });
		const original = await messages(child.email_id);
		const parent = await insert({ message_id: '<late@external.com>' });
		for (let i = 0; i < 33; i++) await insert({ reply_to_email_id: child.email_id, subject: 'Different ' + i });
		const page = await messages(child.email_id, { limit: 30 }),
			older = await messages(child.email_id, { limit: 30, before: page.nextCursor });
		expect(page.total).toBe(35);
		expect(page.messages).toHaveLength(30);
		expect(older.messages).toHaveLength(5);
		expect([...older.messages, ...page.messages].map((m) => m.emailId)).toEqual(
			[...older.messages, ...page.messages].map((m) => m.emailId).sort((a, b) => a - b),
		);
		expect(page.threadId).toBe(original.threadId);
		expect([...older.messages, ...page.messages].some((m) => m.emailId === parent.email_id)).toBe(true);
	});
	it('re-resolves anchors after two indexed conversations merge', async () => {
		const earlier = await insert({ subject: 'Separate topic', message_id: '<earlier@external.com>' });
		const anchor = await insert({ subject: 'Later topic', in_reply_to: '<missing@external.com>' });
		const before = await messages(anchor.email_id);
		expect(before.total).toBe(1);
		await insert({ subject: 'Bridge', message_id: '<missing@external.com>', reply_to_email_id: earlier.email_id });
		const after = await messages(anchor.email_id);
		expect(after.total).toBe(3);
		expect(after.threadId).not.toBe(before.threadId);
		expect((await action('read', [anchor.email_id])).messageCount).toBe(3);
	});
	it('moves messages to Trash even when legacy permanent deletion is configured', async () => {
		const root = await insert();
		await env.db.prepare('UPDATE setting SET sync_delete=0').run();
		await settingService.refresh(context());
		await action('delete', [root.email_id]);
		expect((await env.db.prepare('SELECT * FROM email WHERE email_id=?').bind(root.email_id).first()).trashed_at).toBeTruthy();
	});
	it('applies read/delete/star to every member beyond a page, preserving another user', async () => {
		const root = await insert({ message_id: '<long@external.com>' });
		for (let i = 0; i < 104; i++) await insert({ in_reply_to: '<long@external.com>' });
		const other = await insert({ user_id: 2, account_id: 2, in_reply_to: '<long@external.com>' });
		const result = await action('read', [root.email_id]);
		expect(result.messageCount).toBe(105);
		expect((await env.db.prepare('SELECT COUNT(*) n FROM email WHERE user_id=1 AND unread=0').first()).n).toBe(0);
		await action('star', [root.email_id], { starred: true });
		await action('star', [root.email_id], { starred: true });
		expect((await env.db.prepare('SELECT COUNT(*) n FROM star WHERE user_id=1').first()).n).toBe(1);
		await env.db.prepare('INSERT INTO star(user_id,email_id) VALUES(1,?)').bind(root.email_id).run();
		await action('star', [root.email_id], { starred: false });
		expect((await env.db.prepare('SELECT COUNT(*) n FROM star WHERE user_id=1').first()).n).toBe(0);
		await action('read', [root.email_id], { unread: 0 });
		expect((await messages(root.email_id)).messages.every((m) => m.unread === 0)).toBe(true);
		const trashed = await action('delete', [root.email_id]);
		expect(trashed.emailIds).toHaveLength(105);
		expect(trashed.emailIds).not.toContain(other.email_id);
		expect((await list()).total).toBe(0);
		expect((await env.db.prepare('SELECT is_del FROM email WHERE email_id=?').bind(other.email_id).first()).is_del).toBe(0);
	});
	it('rejects invalid/foreign/deleted anchors before any mutation', async () => {
		const own = await insert(),
			foreign = await insert({ user_id: 2, account_id: 2 }),
			deleted = await insert({ is_del: 1 }),
			alias = await insert({ account_id: 3 });
		await env.db.prepare('UPDATE account SET is_del=1 WHERE account_id=3').run();
		for (const id of [foreign.email_id, deleted.email_id, alias.email_id, 99999, 0, 'bad']) {
			await expect(messages(id)).rejects.toMatchObject({ code: 404 });
			await expect(action('delete', [own.email_id, id])).rejects.toBeDefined();
		}
		expect((await messages(own.email_id)).total).toBe(1);
		for (const emailIds of [undefined, '1', [], [0]])
			await expect(conversationAction(context(), { emailIds }, 1, 'read')).rejects.toMatchObject({ code: 400 });
	});
	it('keeps locally delivered sent replies attached after index rebuild and carries reply headers', async () => {
		const root = await insert({ message_id: '<root@external.com>', relation: '<before@external.com>' });
		const [sent] = await emailService.send(
			context(),
			{
				accountId: 1,
				subject: 'Re: Project',
				content: '<p>Reply</p>',
				receiveEmail: ['other@example.com'],
				sendType: 'reply',
				emailId: root.email_id,
			},
			1,
		);
		const opened = await messages(root.email_id);
		expect(opened.messages.map((m) => m.emailId)).toContain(sent.emailId);
		const row = await env.db.prepare('SELECT * FROM email WHERE email_id=?').bind(sent.emailId).first();
		expect(row.reply_to_email_id).toBe(root.email_id);
		expect(row.in_reply_to).toBe('<root@external.com>');
		expect(row.relation).toContain('<before@external.com>');
		expect((await mobile.threads(env.db, 1, { folder: 'sent' })).threads[0].messageCount).toBe(2);
	});
	it('authenticates web conversation routes and enforces delete permissions', async () => {
		const root = await insert({ user_id: 2, account_id: 2 });
		const secure = { ...env, app_access_secret: 'local-secret', init_secret: 'local-init' };
		const token = await loginService.login(context(), { email: 'other@example.com' }, true);
		const headers = { 'X-Cloudmail-App-Secret': 'local-secret', Authorization: token, 'Content-Type': 'application/json' };
		const request = (path, options = {}) => worker.fetch(new Request('https://mail.example.com/api' + path, options), secure, {});
		expect((await request('/email/conversations?folder=inbox&accountId=2')).status).toBe(403);
		expect((await (await request('/email/conversations?folder=inbox&accountId=2', { headers })).json()).data.threads).toHaveLength(1);
		vi.spyOn(permService, 'userPermKeys').mockResolvedValue([]);
		const denied = await request('/email/conversation/delete', {
			headers,
			method: 'POST',
			body: JSON.stringify({ emailIds: [root.email_id] }),
		});
		expect((await denied.json()).code).toBe(403);
	});
});

it('keeps label names, membership and folder results scoped to their owner', async () => {
 const {saveLabel,listLabels,removeLabel}=await import('../src/service/mailbox-labels');
 const root=await insert({message_id:'<label@example.com>'});
 const reply=await insert({in_reply_to:'<label@example.com>'});
 const tag=await saveLabel(env.db,1,'Projects'), other=await saveLabel(env.db,2,'Projects');
 await expect(saveLabel(env.db,1,'projects')).rejects.toThrow(/exists/);
 await expect(action('label',[root.email_id],{add:[other.id],remove:[]})).rejects.toThrow(/not found/);
 await action('label',[root.email_id],{add:[tag.id],remove:[]});
 expect((await list({folder:'label',labelId:tag.id})).threads[0]).toMatchObject({lastEmailId:reply.email_id,labelIds:[tag.id]});
 expect((await messages(reply.email_id)).labelIds).toEqual([tag.id]);
 await action('archive',[root.email_id]);
 expect((await list({folder:'all'})).total).toBe(1);
 await expect(removeLabel(env.db,2,tag.id)).rejects.toThrow(/not found/);
 await saveLabel(env.db,1,'Filed',tag.id);
 expect(await listLabels(env.db,1)).toEqual([{id:tag.id,name:'Filed'}]);
 await action('label',[reply.email_id],{add:[],remove:[tag.id]});
 expect((await list({folder:'label',labelId:tag.id})).total).toBe(0);
 await action('label',[reply.email_id],{add:[tag.id],remove:[]});
 await removeLabel(env.db,1,tag.id);
 expect((await messages(reply.email_id)).labelIds).toEqual([]);
});

it('filters before pagination and retains full thread state when viewing a single page', async () => {
 const first=await insert({subject:'Roadmap 50%',message_id:'<filter@example.com>',send_email:'search@example.com',unread:0});
 const last=await insert({in_reply_to:'<filter@example.com>',subject:'Later',unread:1});
 await insert({subject:'Different',bcc:'private@example.com'});
 const page=await messages(last.email_id,{limit:1});
 expect(page).toMatchObject({unreadCount:1,incoming:2,filedAway:false});
 await action('archive',[last.email_id]);
 expect((await messages(last.email_id)).filedAway).toBe(true);
 expect((await list({folder:'all',subject:'50%',from:'SEARCH@',isUnread:'1'})).total).toBe(1);
 expect((await list({folder:'all',to:'private@example.com'})).total).toBe(0);
 await cloudMail.trash(context(),1,[first.email_id,last.email_id]);
 const trash=await cloudMail.list(context(),1,{folder:'trash',from:'SEARCH@',subject:'50%',isUnread:'1',limit:1});
 expect(trash.messages.map(row=>row.emailId)).toEqual([first.email_id]);
 expect((await cloudMail.list(context(),1,{folder:'trash',hasAttachment:'1'})).messages).toEqual([]);
});

it('moves between labels and Inbox atomically while retaining other labels',async()=>{
  const {saveLabel}=await import('../src/service/mailbox-labels');
  const row=await insert(),id=row.email_id;
  const src=await saveLabel(env.db,1,'Source'),dest=await saveLabel(env.db,1,'Destination'),other=await saveLabel(env.db,2,'Private');
  await action('label',[id],{add:[src.id],remove:[]});
  await expect(action('move',[id],{labelId:other.id})).rejects.toMatchObject({code:404});
  expect((await list()).total).toBe(1);
  await action('move',[id],{labelId:dest.id});
  expect((await list()).total).toBe(0);
  expect((await messages(id)).labelIds.sort()).toEqual([src.id,dest.id].sort());
  await action('move',[id],{fromLabelId:dest.id,labelId:0});
  expect((await list()).total).toBe(1);
  expect((await messages(id)).labelIds).toEqual([src.id]);
});

it('keeps category folders independent of inbox tabs and counts overlapping purchase threads once',async()=>{
  const receipt=await insert({send_email:'receipts@store.example',subject:'Your receipt',unread:0,message_id:'<order@store.example>'});
  const reply=await insert({reply_to_email_id:receipt.email_id,in_reply_to:'<order@store.example>',subject:'A delivery question',type:1,status:2});
  const promo=await insert({send_email:'offers@shop.example',subject:'November sale',unread:0});
  await insert({account_id:2,user_id:2,send_email:'receipts@store.example',subject:'Your receipt private'});
  await insert({send_email:'receipts@store.example',subject:'Your receipt removed',trashed_at:1});
  await action('archive',[receipt.email_id]);
  await action('category',[receipt.email_id],{category:'promotions'});
  expect((await list({category:'promotions'})).threads.map(t=>t.lastEmailId)).toEqual([promo.email_id]);
  const folder=await list({folder:'promotions',limit:1});
  expect(folder.total).toBe(2);expect((await list({folder:'promotions',limit:1,cursor:folder.nextCursor})).threads).toHaveLength(1);
  expect((await list({folder:'promotions',q:'delivery question'})).threads.map(t=>t.lastEmailId)).toEqual([reply.email_id]);
  expect((await list({folder:'purchases',includeCategory:1})).threads).toMatchObject([{lastEmailId:reply.email_id,category:'promotions'}]);
  expect((await list({folder:'all',countOnly:1,categoryCounts:1})).categoryUnread).toMatchObject({promotions:2,purchases:1});
  expect((await list({folder:'archived',includeCategory:1})).threads).toMatchObject([{category:'promotions'}]);
  await action('read',[receipt.email_id],{unread:1});
  expect((await list({folder:'all',countOnly:1,categoryCounts:1})).categoryUnread.purchases).toBe(0);
});
it('counts unread category threads across shared aliases without counting invisible mail',async()=>{
  const root=await insert({account_id:3,send_email:'receipts@shop.example',subject:'Your receipt',unread:0,message_id:'<shared-receipt@shop.example>'});
  await insert({account_id:1,unread:1,in_reply_to:'<shared-receipt@shop.example>',reply_to_email_id:root.email_id,subject:'Re: Your receipt'});
  await insert({account_id:3,unread:0,send_email:'invites@linkedin.com',subject:'Social invitation'});
  const counts=async p=>(await list({folder:'all',countOnly:1,categoryCounts:1,...p})).categoryUnread;
  expect(await counts({accountId:1})).toEqual({updates:1,purchases:1});
  expect(await counts({allReceive:1})).toEqual({updates:1,purchases:1,social:1});
});
it('categorizes complete conversations before pagination and retains explicit filing across replies',async()=>{
  const personal=await insert({subject:'Dinner?',message_id:'<dinner@example.com>'});
  const promo=await insert({send_email:'offers@bookshop.example',subject:'New titles',message_id:'<books@example.com>'});
  const update=await insert({send_email:'alerts@delivery.example',subject:'Your delivery'});
  const forum=await insert({send_email:'reading@groups.io',subject:'Next meeting'});
  const social=await insert({send_email:'invites@linkedin.com',subject:'An invitation'});
  for(const [category,id] of [['primary',personal.email_id],['promotions',promo.email_id],['updates',update.email_id],['forums',forum.email_id],['social',social.email_id]]) {
    const page=await list({category});
    expect(page.threads.map(t=>t.lastEmailId)).toEqual([id]);
    expect(page.categoryUnread).toHaveProperty('primary');
  }
  await expect(action('category',[personal.email_id],{category:'custom'})).rejects.toMatchObject({code:400});
  const foreign=await insert({user_id:2,account_id:2});
  await expect(action('category',[foreign.email_id],{category:'social'})).rejects.toMatchObject({code:404});
  await action('category',[promo.email_id],{category:'primary'});
  const reply=await insert({reply_to_email_id:promo.email_id,in_reply_to:'<books@example.com>',subject:'Re: New titles',send_email:'offers@bookshop.example'});
  const first=await list({category:'primary',limit:1}),second=await list({category:'primary',limit:1,cursor:first.nextCursor});
  expect(first.total).toBe(2);
  expect([first,second].map(p=>p.threads[0].lastEmailId).sort((a,b)=>a-b)).toEqual([personal.email_id,reply.email_id]);
  expect((await list({category:'promotions'})).total).toBe(0);
  expect((await list({q:'New titles'})).total).toBe(1);
});

it('keeps manual importance through replies, filing, and changes to read or star state',async()=>{
  const original=await insert({subject:'A question',message_id:'<important@example.com>'});
  const reply=await insert({type:1,status:2,subject:'Re: A question',in_reply_to:'<important@example.com>',reply_to_email_id:original.email_id});
  const ordinary=await insert({subject:'A receipt'});
  expect((await list({folder:'important'})).threads.map(t=>[t.lastEmailId,t.importanceReason])).toEqual([[reply.email_id,'reply']]);
  expect((await messages(original.email_id)).importanceReason).toBe('reply');
  await action('importance',[original.email_id],{important:false});
  await insert({reply_to_email_id:original.email_id,subject:'Thanks!'});
  expect((await list({folder:'important'})).total).toBe(0);
  await action('importance',[ordinary.email_id],{important:true});
  await action('archive',[ordinary.email_id]);
  await action('read',[ordinary.email_id],{unread:1});
  expect((await list({folder:'important',q:'receipt'})).threads[0]).toMatchObject({importanceReason:'user',unreadCount:0,starred:0});
  expect((await messages(ordinary.email_id)).importanceReason).toBe('user');
  const foreign=await insert({user_id:2,account_id:2});
  await expect(action('importance',[ordinary.email_id,foreign.email_id],{important:false})).rejects.toMatchObject({code:404});
  expect((await list({folder:'important'})).total).toBe(1);
  await expect(action('importance',[ordinary.email_id],{important:1})).rejects.toMatchObject({code:400});
  expect((await list({folder:'important',accountId:3})).total).toBe(0);
});

it('keeps label colors across rename, rejects foreign labels and clears only the colors', async () => {
 const {saveLabel,listLabels,setLabelColor,removeLabel,recentLabelColors}=await import('../src/service/mailbox-labels');
 const label=await saveLabel(env.db,1,'Palette');
 const colors={background:'#C2185B',foreground:'#FFFFFF',custom:true};
 await expect(setLabelColor(env.db,2,label.id,colors)).rejects.toThrow(/not found/);
 await expect(setLabelColor(env.db,1,label.id,{...colors,background:'red'})).rejects.toThrow(/Choose/);
 await setLabelColor(env.db,1,label.id,colors);
 await saveLabel(env.db,1,'Renamed palette',label.id);
 expect(await listLabels(env.db,1)).toContainEqual({id:label.id,name:'Renamed palette',background:'#c2185b',foreground:'#ffffff'});
 await setLabelColor(env.db,1,label.id,{background:null,foreground:null});
 expect(await listLabels(env.db,1)).toContainEqual({id:label.id,name:'Renamed palette'});
 await removeLabel(env.db,1,label.id);
 expect(await recentLabelColors(env.db,1)).toEqual([{background:'#c2185b',foreground:'#ffffff'}]);
 expect(await recentLabelColors(env.db,2)).toEqual([]);
 expect(await env.db.prepare('SELECT * FROM mailbox_label_colors WHERE label_id=?').bind(label.id).first()).toBeNull();
});

it('keeps the six most recent distinct custom label pairs in selection order', async () => {
 const {saveLabel,recentLabelColors,setLabelColor}=await import('../src/service/mailbox-labels');
 const {id}=await saveLabel(env.db,1,'Review');
 const backgrounds=Array.from({length:7},(_,i)=>'#00000'+i);
 for(const background of [...backgrounds,backgrounds[2]])await setLabelColor(env.db,1,id,{background,foreground:'#ffffff',custom:true});
 expect((await recentLabelColors(env.db,1)).map(pair=>pair.background))
   .toEqual([2,6,5,4,3,1].map(i=>backgrounds[i]));
});

it('counts label folders by unread conversation across aliases and later replies', async () => {
 const {saveLabel} = await import('../src/service/mailbox-labels');
 const {labelUnreadCounts} = await import('../src/service/conversation-service');
 const tag=await saveLabel(env.db,1,'Committee');
 const root=await insert({subject:'Meeting',message_id:'<meeting@example.com>',unread:1});
 await action('label',[root.email_id],{add:[tag.id],remove:[]});
 const later=await insert({account_id:3,in_reply_to:'<meeting@example.com>',unread:0});
 await insert({account_id:3,in_reply_to:'<meeting@example.com>',unread:0});
 const counts=(accountId,allReceive=0,userId=1)=>labelUnreadCounts(context(),{accountId,allReceive},userId);
 expect(await counts(1)).toEqual({[tag.id]:1});
 expect(await counts(3)).toEqual({});
 expect(await counts(3,1)).toEqual({[tag.id]:1});
 expect(await counts(2,1,2)).toEqual({});
 await action('read',[later.email_id]);
 expect(await counts(1)).toEqual({});
 await action('read',[later.email_id],{unread:0});
 await action('delete',[root.email_id]);
 expect(await counts(1)).toEqual({});
});

it('saves each label visibility preference independently for its owner', async () => {
 const {saveLabel,setLabelDisplay,listLabels}=await import('../src/service/mailbox-labels');
 const label=await saveLabel(env.db,1,'Dispatch');
 await setLabelDisplay(env.db,1,label.id,{list:'messages',mode:'hide'});
 await setLabelDisplay(env.db,1,label.id,{list:'sidebar',mode:'unread'});
 await expect(setLabelDisplay(env.db,2,label.id,{list:'sidebar',mode:'show'})).rejects.toMatchObject({code:404});
 await expect(setLabelDisplay(env.db,1,label.id,{list:'messages',mode:'unread'})).rejects.toMatchObject({code:400});
 expect((await listLabels(env.db,1))[0]).toMatchObject({sidebar:'unread',messages:'hide'});
 await setLabelDisplay(env.db,1,label.id,{list:'messages',mode:'show'});
 expect(await listLabels(env.db,1)).toEqual([{...label,sidebar:'unread'}]);
});

it('moves a label branch atomically while retaining identities, membership and colors', async () => {
  const { saveLabel, listLabels, setLabelColor, removeLabel } = await import('../src/service/mailbox-labels');
  const db=env.db, root=await saveLabel(db,1,'Work_%'), other=await saveLabel(db,1,'Personal');
  const child=await saveLabel(db,1,'Planning',undefined,root.id);
  const leaf=await saveLabel(db,1,'April',undefined,child.id);
  const unrelated=await saveLabel(db,1,'WorkXX/Planning');
  const foreign=await saveLabel(db,2,'Private');
  const email=await insert({subject:'Quarterly review'});
  await action('label',[email.email_id],{add:[leaf.id],remove:[]});
  await setLabelColor(db,1,child.id,{background:'#123456',foreground:'#ffffff'});
  expect(leaf.name).toBe('Work_%/Planning/April');
  expect((await list({folder:'label',labelId:root.id})).total).toBe(0);
  await expect(saveLabel(db,1,'Bad',root.id,leaf.id)).rejects.toMatchObject({code:400});
  await expect(saveLabel(db,1,'Bad',undefined,foreign.id)).rejects.toMatchObject({code:404});
  await expect(saveLabel(db,1,'Bad',child.id,foreign.id)).rejects.toMatchObject({code:400});
  await saveLabel(db,1,'Team',root.id,other.id);
  const changed=await listLabels(db,1);
  expect(changed).toEqual(expect.arrayContaining([
    {...root,name:'Personal/Team'}, {...child,name:'Personal/Team/Planning',background:'#123456',foreground:'#ffffff'},
    {...leaf,name:'Personal/Team/Planning/April'},unrelated
  ]));
  expect((await list({folder:'label',labelId:leaf.id})).total).toBe(1);
  // A previously standalone slash-containing label occupies the new descendant path.
  await saveLabel(db,1,'Operations/Planning');
  await expect(saveLabel(db,1,'Operations',root.id,null)).rejects.toMatchObject({code:409});
  expect(await listLabels(db,1)).toContainEqual({...root,name:'Personal/Team'});
  await removeLabel(db,1,root.id);
  expect((await list({folder:'label',labelId:leaf.id})).total).toBe(1);
  expect(await listLabels(db,1)).toContainEqual({...leaf,name:'Personal/Team/Planning/April'});
});

it('moves overlapping paths without changing unrelated legacy paths or shortening an orphan',async()=>{
 const {saveLabel,listLabels,removeLabel}=await import('../src/service/mailbox-labels');
 const save=(name,id,parent)=>saveLabel(env.db,1,name,id,parent);
 const early=await save('A/B/B'),late=await save('A/B');
 const detached=await save('A/B/'),legacy=await save('May',undefined,detached.id);
 await save('A',late.id);
 const all=await listLabels(env.db,1);
 expect(all).toEqual(expect.arrayContaining([{...early,name:'A/B'},{...late,name:'A'},detached,legacy]));
 const longParent=await save('p'.repeat(80)),child=await save('n'.repeat(32),undefined,longParent.id);
 await removeLabel(env.db,1,longParent.id);
 const kept=await save(child.name,child.id,late.id);
 expect(kept.name).toBe('A/'+child.name);
 await expect(save('x'.repeat(101),child.id)).rejects.toMatchObject({code:400});
});

it('filters Trash by message date across an inclusive local day before pagination', async () => {
 const createTimes=['2023-11-05 05:59:59','2023-11-05 06:00:00','2023-11-06 06:59:59','2023-11-06 07:00:00'];
 const rows=[];
 for (const create_time of createTimes) rows.push(await insert({create_time,subject:'Date filter fixture'}));
 await cloudMail.trash(context(),1,rows.map(row=>row.email_id));
 const bounds={dateAfter:String(Date.parse('2023-11-05T00:00:00-06:00')/1000),dateBefore:String(Date.parse('2023-11-06T00:00:00-07:00')/1000)};
 const result=await cloudMail.list(context(),1,{folder:'trash',subject:'Date filter fixture',...bounds});
 expect(result.messages.map(row=>row.emailId).sort()).toEqual([rows[1].email_id,rows[2].email_id].sort());
 expect((await cloudMail.list(context(),1,{folder:'trash',...bounds,limit:1})).messages).toHaveLength(1);
});

it('finds compose correspondents only in the sending mailbox and omits received blind copies',async()=>{
 await insert({name:'Arden Hart',send_email:'arden@example.net',recipient:'[{"name":"Arden Lee","address":"lee@example.net"}]',bcc:'[{"address":"arden-hidden@example.net"}]'});
 await insert({type:1,status:2,bcc:'[{"name":"Arden Ray","address":"ray@example.net"}]'});
 await insert({name:'Arden elsewhere',send_email:'elsewhere@example.net',account_id:3});
 await insert({name:'Arden external',send_email:'external@example.net',account_id:2,user_id:2});
 const options=await cloudMail.searchPeople(context(),1,{folder:'compose',field:'any',accountId:'1',q:'arden'});
 expect(options.map(p=>p.email).sort()).toEqual(['arden@example.net','lee@example.net','ray@example.net']);
 expect(await cloudMail.searchPeople(context(),1,{folder:'compose',field:'any',accountId:'2',q:'arden'})).toEqual([]);
});

it('uses indexed headers to suggest older correspondents beyond recent messages',async()=>{
 await insert({name:'Juniper Rivera',send_email:'juniper@example.net'});
 await env.db.prepare(`WITH RECURSIVE fill(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM fill WHERE n<200)
   INSERT INTO email(user_id,account_id,send_email,name,is_del,status,type) SELECT 2,2,'juniper@elsewhere.net','Juniper Rivera',0,0,0 FROM fill`).run();
 await env.db.prepare(`WITH RECURSIVE fill(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM fill WHERE n<110)
   INSERT INTO email(user_id,account_id,send_email,name,is_del,status,type) SELECT 1,1,'other@example.net','Other',0,0,0 FROM fill`).run();
 const options=await cloudMail.searchPeople(context(),1,{field:'any',folder:'compose',accountId:'1',q:'Juniper Ri'});
 expect(options).toEqual([{name:'Juniper Rivera',email:'juniper@example.net'}]);
});

it('suggests scoped senders and recipients and matches either selected person in Trash', async()=>{
 const a=await insert({name:'Élodie Chen',send_email:'ann@example.net',recipient:'[{"name":"Robin","address":"robin@example.net"}]',bcc:'[{"address":"hidden@example.net"}]'});
 const b=await insert({name:'Lee',send_email:'lee@example.net',type:1,status:2,bcc:'[{"address":"blind@example.net"}]'});
 const c=await insert({name:'ann@example.net',send_email:'joann@example.net',recipient:'[{"address":"xrobin@example.net","name":"robin@example.net"}]'});
 await insert({name:'Another owner',send_email:'owner@example.org',user_id:2,account_id:2});
 await insert({name:'Other alias',send_email:'alias@example.org',account_id:3});
 await cloudMail.trash(context(),1,[a,b,c].map(row=>row.email_id));
 const options=(field,q)=>cloudMail.searchPeople(context(),1,{folder:'trash',accountId:'1',field,q});
 const longAddress='a'.repeat(63)+'@'+('d'.repeat(54)+'.').repeat(3)+'com';
 const long=await insert({send_email:longAddress});
 await cloudMail.trash(context(),1,[long.email_id]);
 expect((await cloudMail.list(context(),1,{folder:'trash',from:longAddress})).messages.map(r=>r.emailId)).toEqual([long.email_id]);
 expect((await options('from',longAddress))[0].email).toBe(longAddress);
 expect(await options('from','example.org')).toEqual([]);
 expect(await options('from','élodie')).toEqual([{name:'Élodie Chen',email:'ann@example.net'}]);
 expect((await cloudMail.list(context(),1,{folder:'trash',from:'ÉLODIE'})).messages.map(r=>r.emailId)).toEqual([a.email_id]);
 expect((await cloudMail.list(context(),1,{folder:'trash',from:'ann@example.net'})).messages.map(r=>r.emailId)).toEqual([a.email_id]);
 expect((await cloudMail.list(context(),1,{folder:'trash',to:'robin@example.net'})).messages.map(r=>r.emailId)).toEqual([a.email_id]);
 expect(await options('to','hidden')).toEqual([]);
 expect(await options('to','blind')).toEqual([{name:'blind@example.net',email:'blind@example.net'}]);
 expect(await options('to','Robin')).toContainEqual({name:'Robin',email:'robin@example.net'});
 const p={folder:'trash',accountId:'1',from:'chen',fromAny:'["LEE@"]'};
 expect((await cloudMail.list(context(),1,p)).messages.map(r=>r.emailId)).toEqual([b.email_id,a.email_id]);
 expect((await cloudMail.list(context(),1,{...p,to:'hidden',toAny:'["ROBIN"]'})).messages.map(r=>r.emailId)).toEqual([a.email_id]);
});

it('compares raw message bytes strictly, before paging, and estimates old messages using their own files',async()=>{
 const exact=await insert({raw_size:1024,subject:'Exact'}), larger=await insert({raw_size:1025,subject:'Larger'});
 const old=await insert({subject:'☁',text:'é',content:'x'});
 const file=(user,account,size)=>env.db.prepare("INSERT INTO attachments(user_id,account_id,email_id,key,size,type) VALUES(?,?,?,'sample',?,1)")
   .bind(user,account,old.email_id,size).run();
 await file(1,1,1019);await file(2,2,15000);
 const params={sizeValue:'1',sizeUnit:'KB',sizeOperator:'larger'};
 expect((await list({...params,folder:'all'})).total).toBe(2);
 await cloudMail.trash(context(),1,[exact,larger,old].map(row=>row.email_id));
 const trash=async filters=>(await cloudMail.list(context(),1,{folder:'trash',...filters})).messages.map(r=>r.emailId);
 expect(await trash({...params,limit:1})).toEqual([old.email_id]);
 expect(await trash({...params,sizeOperator:'smaller'})).toEqual([]);
 expect(await trash({sizeValue:'1026',sizeUnit:'Bytes',sizeOperator:'smaller'})).toHaveLength(3);
 expect(await trash({sizeValue:'1025',sizeUnit:'Bytes'})).toEqual([]);
});

it('records received MIME bytes including headers across split UTF-8 chunks',async()=>{
 const {email:receive}=await import('../src/email/email');
 const raw=new TextEncoder().encode('From: Sender <pat@example.net>\r\nTo: admin@example.com\r\nSubject: Counts original bytes\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCafé ☁');
 const split=raw.length-2;
 await receive({to:'admin@example.com',from:'pat@example.net',raw:new ReadableStream({start(c){c.enqueue(raw.slice(0,split));c.enqueue(raw.slice(split));c.close();}}),
   setReject(reason){throw new Error(reason)}}, {...env,admin:'admin@example.com'},{});
 const saved=await env.db.prepare("SELECT raw_size,text FROM email WHERE subject='Counts original bytes'").first();
 expect(saved.raw_size).toBe(raw.byteLength);expect(saved.text).toContain('Café ☁');
});

it('hands MIME bytes to the parser with their declared character set',async()=>{
 const {email:receive}=await import('../src/email/email');
 const headers='From: Sender <pat@example.net>\r\nTo: admin@example.com\r\nSubject: Latin mail\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: 8bit\r\n\r\nCaf';
 const raw=new Uint8Array([...new TextEncoder().encode(headers),0xe9]);
 await receive({to:'admin@example.com',from:'pat@example.net',raw:new Blob([raw]).stream(),setReject(reason){throw new Error(reason)}},{...env,admin:'admin@example.com'},{});
 const saved=await env.db.prepare("SELECT raw_size,text FROM email WHERE subject='Latin mail'").first();
 expect(saved.raw_size).toBe(raw.byteLength);expect(saved.text).toContain('Café');
});

it('excludes visible words and phrases before paging, with isolated headers, HTML-only mail and incoming Bcc privacy',async()=>{
 const plain=await insert({subject:'Café report',text:'The paperwork arrived κόσμος',bcc:'[{"address":"hidden@example.net"}]'});
 const html=await insert({subject:'Report two',text:'\r\n',content:'<p style="color:magenta">Paper <b>lantern</b></p>'});
 const sent=await insert({type:1,status:2,subject:'Third report',bcc:'[{"address":"hidden@example.net"}]'});
 const options={folder:'all',q:'report'};
 expect((await list({...options,excluded:'cafe hidden'})).total).toBe(1);
 expect((await list({...options,excluded:'"paper lantern" hidden'})).threads.map(m=>m.lastEmailId)).toEqual([plain.email_id]);
 expect((await list({...options,excluded:'paper'})).total).toBe(2);
 expect((await list({...options,excluded:'κόσμοσ'})).total).toBe(2);
 expect((await list({...options,excluded:'magenta "lantern report" address'})).total).toBe(3);
 await cloudMail.trash(context(),1,[plain,html,sent].map(m=>m.email_id));
 const trash=async excluded=>(await cloudMail.list(context(),1,{folder:'trash',excluded,limit:1})).messages.map(m=>m.emailId);
 expect(await trash('"paper lantern" hidden')).toEqual([plain.email_id]);
 await env.db.prepare("UPDATE email SET text='replacement' WHERE email_id=?").bind(html.email_id).run();
 expect(await trash('hidden "paper lantern"')).toEqual([html.email_id]);
 await env.db.prepare('DELETE FROM email WHERE email_id=?').bind(html.email_id).run();
 expect(await env.db.prepare("SELECT rowid FROM mail_word_index WHERE mail_word_index MATCH 'replacement'").first()).toBeNull();
});

it('bounds search preparation and resumes a scoped historical index without returning partial results',async()=>{
 const {mailWordSchema}=await import('../src/service/mail-word-schema');
 const {indexWordBatch}=await import('../src/service/mail-word-index');
 const ids=[];
 for(let n=0;n<10;n++) ids.push((await insert({subject:'Historical '+n,text:'',content:n===6?'<p>Lantern</p>':'<p>Other</p>'})).email_id);
 await env.db.prepare('INSERT INTO account(account_id,email,user_id) VALUES(7,\'other-alias@example.com\',1)').run();
 const other=await insert({account_id:7,subject:'Other alias',text:'',content:'<p>other</p>'});
 // Simulate messages that existed before search was installed.
 await env.db.batch(['mail_words_insert','mail_words_update','mail_words_delete'].map(name=>env.db.prepare('DROP TRIGGER '+name)));
 await env.db.batch(['mail_word_index','mail_word_pending','mail_word_setup'].map(name=>env.db.prepare('DROP TABLE '+name)));
 await env.db.batch(mailWordSchema().map(sql=>env.db.prepare(sql)));
 expect(await list({folder:'all',excluded:'lantern'})).toEqual({preparingSearch:true});
 expect((await env.db.prepare('SELECT count(*) n FROM mail_word_pending WHERE email_id=?').bind(other.email_id).first()).n).toBe(0);
 expect(await list({folder:'all',excluded:'lantern'})).toEqual({preparingSearch:true});
 expect((await list({folder:'all',excluded:'lantern',limit:1})).total).toBe(9);
 await indexWordBatch(env.db);
 expect((await list({folder:'all',allReceive:1,excluded:'lantern'})).total).toBe(10);
});
