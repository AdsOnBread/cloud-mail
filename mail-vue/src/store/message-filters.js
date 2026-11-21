import {defineStore} from 'pinia';
import http from '@/axios';
import {useUserStore} from './user';

export function filterSession() {
  const user=useUserStore(), token=user.authenticatedToken, owner=user.user.userId;
  const current=()=>Boolean(token && owner && user.user.userId===owner && user.authenticatedToken===token && localStorage.getItem('token')===token);
  return {current,config:{headers:{Authorization:token},noMsg:true}};
}
export const useMessageFilters=defineStore('message-filters',{
  state:()=>({editor:null,senderRequest:null,revision:0}),
  actions:{
    fromMessage(sender) {
      if (!filterSession().current() || !sender) return;
      if (document.querySelector('[role=search] [data-search-options]')?.getBoundingClientRect().width)
        this.senderRequest={sender};
      else this.open({from:sender});
    },
    open(criteria={},rule=null,step='criteria'){
      if (!filterSession().current()) return;
      this.editor={id:rule?.id || crypto.randomUUID(),version:rule?.version || 0,
        criteria:{...criteria},actions:{...rule?.actions},step};
    },
    async save(session,input) {
      if (!session.current()) throw new Error('Reopen filters in your signed-in mailbox.');
      await http.put('/v1/filters/'+input.id,input,session.config);
      if (session.current()) this.revision++;
    },
  },
});
