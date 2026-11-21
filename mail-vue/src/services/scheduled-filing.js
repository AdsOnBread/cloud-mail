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
    await http.post('/v1/scheduled/inbox',{messages,inbox},{noMsg:true});
    if (current()) {
      const subject=messages.length===1 ? 'Message' : messages.length+' messages';
      useMailFeedback().show(subject+(inbox ? ' moved to Inbox.' : ' archived.'));
    }
  } finally {
    if (current()) userDraftStore().scheduledRevision++;
  }
}
