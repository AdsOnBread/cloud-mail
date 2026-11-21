import {beforeEach,expect,it,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {filterSession,useMessageFilters} from '../src/store/message-filters';
import {useUserStore} from '../src/store/user';
import {useEmailStore} from '../src/store/email';
import http from '../src/axios';

vi.mock('../src/axios',()=>({default:{put:vi.fn()}}));
beforeEach(()=>{
  setActivePinia(createPinia());http.put.mockReset();
  const user=useUserStore();user.authenticatedToken='sample';user.user.userId=1;
  localStorage.setItem('token','sample');
});
it('completes preparation before refreshing existing conversations',async()=>{
  http.put.mockResolvedValueOnce({preparing:true}).mockResolvedValueOnce({version:1});
  const store=useMessageFilters(),session=filterSession(),input={id:'sample',applyExisting:true};
  await store.save(session,input);
  expect(http.put).toHaveBeenCalledTimes(2);
  expect(http.put).toHaveBeenCalledWith('/v1/filters/sample',input,session.config);
  expect(store.revision).toBe(1);expect(useEmailStore().conversationRevision).toBe(1);
});
it('stops preparing a rule when another tab switches the signed-in user',async()=>{
  http.put.mockImplementationOnce(async()=>{localStorage.setItem('token','another');return {preparing:true};});
  await expect(useMessageFilters().save(filterSession(),{id:'sample',applyExisting:true})).rejects.toThrow('signed-in mailbox');
  expect(http.put).toHaveBeenCalledTimes(1);expect(useEmailStore().conversationRevision).toBe(0);
});
