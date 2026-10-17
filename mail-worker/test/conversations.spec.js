import { env } from 'cloudflare:test';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { dbInit } from '../src/init/init';
import { conversationList, conversationMessages, conversationAction } from '../src/service/conversation-service';
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
	it('retains the configured permanent-delete behavior', async () => {
		const root = await insert();
		await env.db.prepare('UPDATE setting SET sync_delete=0').run();
		await settingService.refresh(context());
		await action('delete', [root.email_id]);
		expect(await env.db.prepare('SELECT * FROM email WHERE email_id=?').bind(root.email_id).first()).toBeNull();
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
		await action('delete', [root.email_id]);
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
