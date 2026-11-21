import http from '@/axios';
import {userDraftStore} from '@/store/draft';
import {useMailFeedback} from '@/store/mail-feedback';
import {useUserStore} from '@/store/user';

const requests=new Map();
function session() {
  const user=useUserStore(), owner=user.user.email, token=user.authenticatedToken;
  if (owner && token && token===localStorage.getItem('token'))
    return {owner,token,key:'cloudmail:scheduled-trash:'+owner,current:()=>user.user.email===owner && user.authenticatedToken===token && localStorage.getItem('token')===token};
}
function pending(key) {return JSON.parse(sessionStorage.getItem(key) || '[]');}
function forget(key,edit) {
  const rest=pending(key).filter(op=>op.edit!==edit);
  if (rest.length) sessionStorage.setItem(key,JSON.stringify(rest));
  else sessionStorage.removeItem(key);
}

function confirmTrash(context,op) {
  const requestKey=JSON.stringify([context.owner,context.token,op.edit]);
  if (requests.has(requestKey)) return requests.get(requestKey);
  const feedback=useMailFeedback(), drafts=userDraftStore();
  const task=(async()=>{
    let receipt;
    try {
      receipt=await http.post('/v1/scheduled/trash',op,{noMsg:true,headers:{Authorization:context.token}});
    } catch(e) {
      const status=Number(e.response?.status || e.code);
      if (status>=400 && status<500 && ![401,408,429].includes(status)) {
        if (context.current()) forget(context.key,op.edit);
        throw e;
      }
      if (context.current()) {
        feedback.show('Could not confirm the move to Trash.');
        feedback.notice.retry=retryPendingTrash;
      }
      return false;
    }
    if (!context.current()) return false;
    forget(context.key,op.edit);
    feedback.trashed([],receipt.count,'message');
    feedback.notice.scheduledTrash=op.edit;
    feedback.restored++;
    drafts.scheduledRevision++;
    feedback.notice.undoFiling=async()=>{
      if (!context.current()) throw new Error('Your mailbox changed. Reopen Trash.');
      const result=await http.post('/v1/scheduled/undo-trash',receipt,{noMsg:true,headers:{Authorization:context.token}});
      if (!context.current()) return;
      drafts.scheduledRevision++;
      feedback.restored++;
      if (result.drafts) {
        import('@/services/cloud-drafts').then(({syncCloudDrafts})=>syncCloudDrafts()).catch(()=>{});
        if (result.scheduled) return result.scheduled+' scheduled again. '+result.drafts+' returned to Drafts.';
        return result.drafts===1 ? 'Message returned to Drafts.' : result.drafts+' messages returned to Drafts.';
      }
    };
    return true;
  })().finally(()=>requests.delete(requestKey));
  requests.set(requestKey,task);
  return task;
}
export async function deleteScheduled(rows) {
  const context=session();
  if (!context) throw new Error('Your mailbox changed. Reopen Scheduled.');
  const messages=rows.map(({draftId,version})=>({draftId,version})).sort((a,b)=>a.draftId-b.draftId);
  const saved=pending(context.key);
  let op=saved.find(entry=>JSON.stringify(entry.messages)===JSON.stringify(messages));
  if (!op) {
    op={edit:crypto.randomUUID(),messages};
    sessionStorage.setItem(context.key,JSON.stringify([...saved,op]));
  }
  return confirmTrash(context,op);
}
// The server might have committed before the browser lost its connection or reloaded.
export async function retryPendingTrash() {
  const context=session();
  if (!context || !navigator.onLine || useMailFeedback().notice?.scheduledTrash) return;
  for (const op of pending(context.key)) {
    if (!context.current()) return;
    // Display one recovered Undo at a time. The notification advances the queue
    // after the user acts or dismisses it.
    try {await confirmTrash(context,op);return;}
    catch(e) {if (context.current()) useMailFeedback().show(e.message || 'The scheduled message changed.');}
  }
}
