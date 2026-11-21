import http from '@/axios';
import {userDraftStore} from '@/store/draft';
import {useUserStore} from '@/store/user';
import {useMailFeedback} from '@/store/mail-feedback';

export async function fileScheduledMessages(rows,inbox) {
  const user=useUserStore(), owner=user.user.email, token=user.authenticatedToken;
  const current=()=>owner===user.user.email && token===user.authenticatedToken && token===localStorage.getItem('token');
  if (!owner || !token || !current()) throw new Error('Your mailbox changed. Reopen Scheduled.');
  const messages=rows.map(({draftId,version})=>({draftId,version}));
  try {
    const result=await http.post('/v1/scheduled/inbox',{messages,inbox},{noMsg:true});
    if (current()) {
      const subject=messages.length===1 ? 'Message' : messages.length+' messages';
      const feedback=useMailFeedback();
      feedback.show(subject+(inbox ? ' moved to Inbox.' : ' archived.'));
      const changed=messages.filter(row=>result.changed?.includes(row.draftId));
      if (changed.length) feedback.notice.undoFiling=async()=>{
        if (!current()) throw new Error('Your mailbox changed. Reopen Scheduled.');
        try {
          await http.post('/v1/scheduled/inbox',{messages:changed,inbox:!inbox,previousEdit:result.edit},{noMsg:true});
        } finally {
          if (current()) userDraftStore().scheduledRevision++;
        }
      };
    }
  } finally {
    if (current()) userDraftStore().scheduledRevision++;
  }
}
