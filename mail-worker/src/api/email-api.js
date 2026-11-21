import app from '../hono/hono';
import emailService from '../service/email-service';
import result from '../model/result';
import userContext from '../security/user-context';
import { listLabels, saveLabel, removeLabel } from '../service/mailbox-labels';
import attService from '../service/att-service';
import { conversationList, conversationMessages, conversationAction, draftThreads } from '../service/conversation-service';

app.get('/email/list', async (c) => {
	const data = await emailService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.get('/email/latest', async (c) => {
	const list = await emailService.latest(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.get('/email/detail', async (c) => {
	const message = await emailService.detail(c, c.req.query('emailId'), userContext.getUserId(c));
	return c.json(result.ok(message));
});

app.delete('/email/delete', async (c) => {
	await emailService.delete(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.get('/email/attList', async (c) => {
	const attList = await attService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(attList));
});

app.post('/email/send', async (c) => {
	const email = await emailService.send(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(email));
});

app.put('/email/read', async (c) => {
	await emailService.read(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
})

// Conversation routes share the mobile index while keeping its wire contract unchanged.
app.use('/email/conversation*', async (c, next) => {
	c.header('Cache-Control', 'private, no-store');
	await next();
});
app.get('/email/conversations', async c => c.json(result.ok(await conversationList(c, c.req.query(), userContext.getUserId(c)))));
app.get('/email/conversation/messages', async c => c.json(result.ok(await conversationMessages(c, c.req.query(), userContext.getUserId(c)))));
app.post('/email/conversation/draft-threads', async c => c.json(result.ok(await draftThreads(c, (await c.req.json()).emailIds, userContext.getUserId(c)))));
app.get('/email/conversation/labels', async c => c.json(result.ok(await listLabels(c.env.db,userContext.getUserId(c)))));
app.post('/email/conversation/labels', async c => c.json(result.ok(await saveLabel(c.env.db,userContext.getUserId(c),(await c.req.json()).name))));
app.put('/email/conversation/labels/:id', async c => c.json(result.ok(await saveLabel(c.env.db,userContext.getUserId(c),(await c.req.json()).name,c.req.param('id')))));
app.delete('/email/conversation/labels/:id', async c => {
  await removeLabel(c.env.db,userContext.getUserId(c),c.req.param('id'));
  return c.json(result.ok());
});
for (const action of ['read', 'delete', 'star', 'archive', 'snooze', 'inbox', 'label', 'move', 'category']) {
	app.post(`/email/conversation/${action}`, async c =>
		c.json(result.ok(await conversationAction(c, await c.req.json(), userContext.getUserId(c), action))));
}
