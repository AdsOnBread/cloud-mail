import {undoConversationMove} from '../service/conversation-move-undo.js';
import {readContact,setContact} from '../cloud/contacts';
import {listFilters,previewFilter,saveFilter,deleteFilter} from '../cloud/message-filters';
import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import { activeUser,permission } from '../cloud/auth';
import * as drafts from '../cloud/drafts';
import * as mail from '../cloud/mail';
import {trashScheduled,undoScheduledTrash} from '../cloud/scheduled-trash';
import {schedule,scheduledList,snoozeScheduled,setScheduledLabels,setScheduledInbox,setScheduledRead,setScheduledMark,cancel} from '../cloud/scheduled';
import { send, dispatchHeld, undoSend } from '../cloud/send';
import {readGeneralSettings,saveGeneralSettings} from '../cloud/general-settings';
import {readSignatures,saveSignatures} from '../cloud/signatures';
import { moveFromTrash,setTrashRead,setTrashImportance,setTrashLabels } from '../cloud/trash-actions';
import {systemLabels,setSystemLabel} from '../cloud/system-labels';
const root='/v1';const uid=c=>userContext.getUserId(c);
app.use(root+'/*',async(c,next)=>{await activeUser(c,uid(c));await next();c.header('Cache-Control','private, no-store');});
app.get(root+'/filters',async c=>c.json(result.ok(await listFilters(c.env.db,uid(c)))));
app.post(root+'/filters/preview',async c=>c.json(result.ok(await previewFilter(c.env.db,uid(c),await c.req.json()))));
app.put(root+'/filters/:id',async c=>c.json(result.ok(await saveFilter(c.env.db,uid(c),c.req.param('id'),await c.req.json()))));
app.delete(root+'/filters/:id',async c=>c.json(result.ok(await deleteFilter(c.env.db,uid(c),c.req.param('id'),Number(c.req.query('version'))))));
app.get(root+'/system-labels',async c=>c.json(result.ok(await systemLabels(c.env.db,uid(c)))));
app.put(root+'/system-labels/:folder',async c=>c.json(result.ok(await setSystemLabel(c.env.db,uid(c),c.req.param('folder'),(await c.req.json()).mode))));
app.get(root+'/general-settings',async c=>c.json(result.ok(await readGeneralSettings(c.env.db,uid(c)))));
app.put(root+'/general-settings',async c=>c.json(result.ok(await saveGeneralSettings(c.env.db,uid(c),await c.req.json()))));
app.get(root+'/signatures',async c=>c.json(result.ok(await readSignatures(c.env.db,uid(c)))));
app.put(root+'/signatures',async c=>c.json(result.ok(await saveSignatures(c.env.db,uid(c),await c.req.json()))));
app.get(root+'/drafts',async c=>c.json(result.ok(await drafts.list(c,uid(c),c.req.query()))));
app.get(root+'/drafts/changes',async c=>c.json(result.ok(await drafts.changes(c,uid(c),c.req.query()))));
app.get(root+'/drafts/attachments/:id/content',async c=>{const {row,object}=await drafts.file(c,uid(c),c.req.param('id'),c.req.query('preview')==='text');return mail.fileResponse(object,row);});
app.get(root+'/drafts/:id',async c=>c.json(result.ok(await drafts.get(c,uid(c),c.req.param('id')))));
app.post(root+'/drafts',async c=>c.json(result.ok(await drafts.save(c,uid(c),await c.req.json()))));
app.put(root+'/drafts/:id',async c=>c.json(result.ok(await drafts.save(c,uid(c),await c.req.json(),c.req.param('id')))));
app.delete(root+'/drafts/:id',async c=>c.json(result.ok(await drafts.remove(c,uid(c),c.req.param('id'),Number(c.req.query('version'))))));
app.post(root+'/drafts/:id/send',async c=>{
  const userId=uid(c);
  const receipt=await send(c,userId,await c.req.json(),{draftId:c.req.param('id')});
  if (receipt.state==='holding' && receipt.undoUntil-Date.now()<15000) {
    const job=new Promise(resolve=>setTimeout(resolve,Math.max(0,receipt.undoUntil-Date.now())))
      .then(()=>dispatchHeld({env:c.env},userId,receipt.attemptId));
    c.executionCtx.waitUntil(job);
  }
  return c.json(result.ok(receipt.state==='holding' ? {...receipt,remainingMs:Math.max(0,receipt.undoUntil-Date.now())} : receipt));
});
app.post(root+'/send-attempts/:id/undo',async c=>c.json(result.ok(await undoSend(c,uid(c),c.req.param('id')))));
app.post(root+'/drafts/:id/schedule',async c=>c.json(result.ok(await schedule(c,uid(c),c.req.param('id'),await c.req.json()))));
app.get(root+'/scheduled',async c=>c.json(result.ok(await scheduledList(c,uid(c),c.req.query('accountId'),c.req.query()))));
app.get(root+'/scheduled/:id',async c=>{
  const row=await drafts.get(c,uid(c),c.req.param('id'),true);
  if(!row.scheduledAt)return c.json({code:404,message:'Scheduled message not found.'},404);
  return c.json(result.ok(row));
});
app.post(root+'/scheduled/trash',async c=>c.json(result.ok(await trashScheduled(c,uid(c),await c.req.json()))));
app.post(root+'/scheduled/undo-trash',async c=>c.json(result.ok(await undoScheduledTrash(c,uid(c),await c.req.json()))));
app.post(root+'/scheduled/labels',async c=>c.json(result.ok(await setScheduledLabels(c,uid(c),await c.req.json()))));
app.post(root+'/scheduled/snooze',async c=>c.json(result.ok(await snoozeScheduled(c,uid(c),await c.req.json()))));
app.post(root+'/scheduled/inbox',async c=>c.json(result.ok(await setScheduledInbox(c,uid(c),await c.req.json()))));
app.post(root+'/scheduled/read',async c=>c.json(result.ok(await setScheduledRead(c,uid(c),await c.req.json()))));
app.post(root+'/scheduled/:id/mark',async c=>c.json(result.ok(await setScheduledMark(c,uid(c),c.req.param('id'),await c.req.json()))));
app.post(root+'/scheduled/:id/cancel',async c=>c.json(result.ok(await cancel(c,uid(c),c.req.param('id'),(await c.req.json()).version))));
app.get(root+'/contacts',async c=>c.json(result.ok(await readContact(c,uid(c),c.req.query()))));
app.put(root+'/contacts',async c=>c.json(result.ok(await setContact(c,uid(c),await c.req.json()))));
app.get(root+'/search/people',async c=>c.json(result.ok(await mail.searchPeople(c,uid(c),c.req.query()))));
app.get(root+'/messages',async c=>c.json(result.ok(await mail.list(c,uid(c),c.req.query()))));
app.get(root+'/messages/:id',async c=>c.json(result.ok(await mail.detail(c,uid(c),c.req.param('id')))));
app.get(root+'/attachments/:id/content',async c=>{const {row,object}=await mail.attachment(c,uid(c),c.req.param('id'),c.req.query('preview')==='text');return mail.fileResponse(object,row);});
app.post(root+'/messages/move-from-trash',async c=>{
  await permission(c,uid(c),'email:delete');
  const {emailIds,labelId,clientId,undoable,requestId}=await c.req.json();
  return c.json(result.ok(await moveFromTrash(c.env.db,uid(c),emailIds,labelId,clientId,{undoable,requestId})));
});
app.post(root+'/messages/undo-recovery',async c=>{
  await permission(c,uid(c),'email:delete');
  return c.json(result.ok(await undoConversationMove(c.env.db,uid(c),(await c.req.json()).token,true)));
});
app.post(root+'/messages/trash-labels',async c=>{
  const {emailIds,add,remove}=await c.req.json();
  return c.json(result.ok(await setTrashLabels(c.env.db,uid(c),emailIds,add,remove)));
});
app.post(root+'/messages/:id/trash-importance',async c=>{
  const {important}=await c.req.json();
  return c.json(result.ok(await setTrashImportance(c.env.db,uid(c),c.req.param('id'),important)));
});
app.post(root+'/messages/trash-read',async c=>{
  const {emailIds,read}=await c.req.json();
  return c.json(result.ok(await setTrashRead(c.env.db,uid(c),emailIds,read)));
});
for(const action of ['trash','restore','purge']) app.post(root+'/messages/'+action,async c=>{
  await permission(c,uid(c),'email:delete');
  const body=await c.req.json();
  if (action==='restore' && body.undoable===true)
    return c.json(result.ok(await moveFromTrash(c.env.db,uid(c),body.emailIds,0,undefined,{undoable:true,requestId:body.requestId,previousLocation:true})));
  return c.json(result.ok(await mail.trash(c,uid(c),body.emailIds,action)));
});
async function attemptStatus(c) {
  const row=await c.env.db.prepare('SELECT state,result FROM send_attempts WHERE user_id=? AND idempotency_key=?').bind(uid(c),c.req.param('id')).first();
  const receipt=row?.result ? JSON.parse(row.result) : {state:row?'uncertain':'not_started',attemptId:c.req.param('id')};
  if(receipt.state==='holding') receipt.remainingMs=Math.max(0,receipt.undoUntil-Date.now());
  return c.json(result.ok(receipt));
}
app.get(root+'/send-attempts/:id',attemptStatus);
app.post(root+'/send-attempts/:id/finish',async c=>{
  await dispatchHeld(c,uid(c),c.req.param('id'));
  return attemptStatus(c);
});
