import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import { activeUser,permission } from '../cloud/auth';
import * as drafts from '../cloud/drafts';
import * as mail from '../cloud/mail';
import { send } from '../cloud/send';
const root='/v1';const uid=c=>userContext.getUserId(c);
app.use(root+'/*',async(c,next)=>{await activeUser(c,uid(c));await next();c.header('Cache-Control','private, no-store');});
app.get(root+'/drafts',async c=>c.json(result.ok(await drafts.list(c,uid(c),c.req.query()))));
app.get(root+'/drafts/changes',async c=>c.json(result.ok(await drafts.changes(c,uid(c),c.req.query()))));
app.get(root+'/drafts/attachments/:id/content',async c=>{const {row,object}=await drafts.file(c,uid(c),c.req.param('id'));return mail.fileResponse(object,row);});
app.get(root+'/drafts/:id',async c=>c.json(result.ok(await drafts.get(c,uid(c),c.req.param('id')))));
app.post(root+'/drafts',async c=>c.json(result.ok(await drafts.save(c,uid(c),await c.req.json()))));
app.put(root+'/drafts/:id',async c=>c.json(result.ok(await drafts.save(c,uid(c),await c.req.json(),c.req.param('id')))));
app.delete(root+'/drafts/:id',async c=>c.json(result.ok(await drafts.remove(c,uid(c),c.req.param('id'),Number(c.req.query('version'))))));
app.post(root+'/drafts/:id/send',async c=>c.json(result.ok(await send(c,uid(c),await c.req.json(),{draftId:c.req.param('id')}))));
app.get(root+'/messages',async c=>c.json(result.ok(await mail.list(c,uid(c),c.req.query()))));
app.get(root+'/messages/:id',async c=>c.json(result.ok(await mail.detail(c,uid(c),c.req.param('id')))));
app.get(root+'/attachments/:id/content',async c=>{const {row,object}=await mail.attachment(c,uid(c),c.req.param('id'));return mail.fileResponse(object,row);});
for(const action of ['trash','restore','purge']) app.post(root+'/messages/'+action,async c=>{
  await permission(c,uid(c),'email:delete');return c.json(result.ok(await mail.trash(c,uid(c),(await c.req.json()).emailIds,action)));
});
app.get(root+'/send-attempts/:id',async c=>{
  const row=await c.env.db.prepare('SELECT state,result FROM send_attempts WHERE user_id=? AND idempotency_key=?').bind(uid(c),c.req.param('id')).first();
  return c.json(result.ok(row?row.result?JSON.parse(row.result):{state:'uncertain',attemptId:c.req.param('id')}:{state:'not_started',attemptId:c.req.param('id')}));
});
