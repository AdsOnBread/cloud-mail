import {afterEach,expect,it,vi} from 'vitest';
import {flushPromises,shallowMount} from '@vue/test-utils';
import {createMemoryHistory,createRouter} from 'vue-router';
import {createPinia,setActivePinia} from 'pinia';
import Scheduled from '../src/views/scheduled/index.vue';
import {useAccountStore} from '../src/store/account';
import {useUserStore} from '../src/store/user';
import http from '../src/axios';

vi.mock('../src/axios',()=>({default:{get:vi.fn(),post:vi.fn()}}));
vi.mock('../src/db/db',async()=>({default:(await import('vue')).shallowRef({})}));

afterEach(()=>localStorage.removeItem('token'));

it('finishes an earlier mark before reading a reopened message and keeps the new reader open',async()=>{
  const pinia=createPinia();
  setActivePinia(pinia);
  useAccountStore().select({accountId:7,email:'me@example.com'});
  useUserStore().user.email='me@example.com';
  useUserStore().authenticatedToken='session';localStorage.setItem('token','session');
  const messages=[1,2].map(draftId=>({draftId,version:2,accountId:7,state:'scheduled',
    subject:'Message '+draftId,sendAt:1900000000,recipients:['someone@example.com'],unread:0}));
  http.get.mockImplementation(async path=>{
    if (path==='/v1/scheduled') return messages.map(row=>({...row}));
    const row=messages.find(row=>path==='/v1/scheduled/'+row.draftId);
    return {...row,scheduledUnread:row.unread};
  });
  let release;
  const delayed=new Promise(resolve=>{release=resolve});
  http.post.mockImplementation(async(_path,{messages:selection,unread})=>{
    if (unread) await delayed;
    for (const {draftId} of selection) messages.find(row=>row.draftId===draftId).unread=Number(unread);
    return {updated:selection.length};
  });
  const router=createRouter({history:createMemoryHistory(),routes:[{name:'scheduled',path:'/scheduled',component:Scheduled}]});
  const visit=id=>router.push({name:'scheduled',query:{message:id}});
  await visit(1);
  const wrapper=shallowMount(Scheduled,{global:{plugins:[pinia,router],stubs:{MailSnoozePicker:false}}});
  try {
    await flushPromises();
    await wrapper.get('button[aria-label="Mark as unread"]').trigger('click');
    await visit(2);await flushPromises();
    await visit(1);await flushPromises();
    release();await flushPromises();
    expect(router.currentRoute.value.query.message).toBe('1');
    expect(http.post.mock.calls.map(([,payload])=>payload.unread)).toEqual([true,false]);
    expect(messages[0].unread).toBe(0);
  } finally {release();wrapper.unmount();}
});

it('retries the displayed page and ignores a sign-in change in another tab',async()=>{
  vi.resetAllMocks();
  const pinia=createPinia();
  setActivePinia(pinia);
  const user=useUserStore();
  user.user.email='me@example.com';user.authenticatedToken='old-session';
  localStorage.setItem('token','old-session');
  useAccountStore().select({accountId:7,email:user.user.email});
  const messages=Array.from({length:52},(_,i)=>({draftId:i+1,version:3,accountId:7,state:'scheduled',
    subject:'Message '+(i+1),sendAt:1900000000+i,recipients:['someone@example.com'],unread:Number(i!==51)}));
  http.get.mockImplementation(async()=>messages.map(row=>({...row})));
  http.post.mockRejectedValueOnce(new Error('Message changed.')).mockImplementation(async(_path,payload)=>{
    for (const {draftId} of payload.messages) messages.find(row=>row.draftId===draftId).unread=0;
  });
  const router=createRouter({history:createMemoryHistory(),routes:[{name:'scheduled',path:'/scheduled',component:Scheduled}]});
  await router.push('/scheduled');
  const wrapper=shallowMount(Scheduled,{global:{plugins:[pinia,router]}});
  try {
    await flushPromises();
    await wrapper.get('[aria-label="Next"]').trigger('click');
    const pageRead=()=>wrapper.getComponent({name:'MailPageActions'}).vm.$emit('mark-read');
    pageRead();await flushPromises();
    expect(wrapper.text()).toContain('Message changed.');
    pageRead();await flushPromises();
    expect(wrapper.text()).not.toContain('Message changed.');
    expect(http.post.mock.calls[1]).toEqual(['/v1/scheduled/read',{messages:[{draftId:51,version:3}],unread:false},
      {noMsg:true,headers:{Authorization:'old-session'}}]);
    expect(messages[0].unread).toBe(1);
    await wrapper.get('[aria-label="Previous"]').trigger('click');
    localStorage.setItem('token','new-session');
    pageRead();await flushPromises();
    expect(http.post).toHaveBeenCalledTimes(2);
  } finally {wrapper.unmount();}
});
