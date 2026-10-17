import app from '../hono/hono';
import userContext from '../security/user-context';
import result from '../model/result';
import * as mobile from '../mobile/service';
const root='/mobile/v1';
const uid=c=>userContext.getUserId(c);
app.use(root+'/*',async (c,next)=>{
	await next();
	c.header('Cache-Control','private, no-store');
	c.header('Vary','Authorization, Cookie, X-Cloudmail-App-Secret',{append:true});
});
app.get(root+'/bootstrap',async c=>c.json(result.ok(await mobile.bootstrap(c.env.db,uid(c),c.req.query()))));
app.get(root+'/changes',async c=>c.json(result.ok(await mobile.changes(c.env.db,uid(c),c.req.query()))));
app.get(root+'/threads',async c=>c.json(result.ok(await mobile.threads(c.env.db,uid(c),c.req.query()))));
app.get(root+'/threads/:id/messages',async c=>c.json(result.ok(await mobile.threadMessages(c.env.db,uid(c),c.req.param('id'),c.req.query()))));
app.get(root+'/messages/:id',async c=>c.json(result.ok(await mobile.messageDetail(c.env.db,uid(c),c.req.param('id')))));
app.get(root+'/attachments/:id/content',async c=>mobile.attachment(c,uid(c),{id:c.req.param('id')}));
app.get(root+'/attachment-by-key',async c=>mobile.attachment(c,uid(c),{key:c.req.query('key')}));
