import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {flushPromises,mount} from '@vue/test-utils';
import {createPinia,setActivePinia} from 'pinia';
import Card from '../src/components/recipient-field/contact-card.vue';
import {useUserStore} from '../src/store/user';
import {useWriterStore} from '../src/store/writer';
import http from '@/axios';

vi.mock('@/axios',()=>({default:{get:vi.fn(),put:vi.fn()}}));
const owner='owner@example.org',email='person@example.org';
let anchor,wrapper;

beforeEach(()=>{
  setActivePinia(createPinia());
  const user=useUserStore();
  user.user={email:owner};
  user.authenticatedToken='card-session';
  localStorage.setItem('token','card-session');
  anchor=document.body.appendChild(document.createElement('button'));
  anchor.getClientRects=()=>[anchor.getBoundingClientRect()];
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  http.get.mockResolvedValue(null);
});

afterEach(()=>{
  wrapper?.unmount();
  wrapper=null;
  anchor.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each([true,false])('finishes a dismissed card’s save and only updates its original session (%s)',async sameSession=>{
  let acknowledge;
  http.put.mockImplementation(()=>new Promise(resolve=>{acknowledge=resolve;}));
  const store=useWriterStore();
  wrapper=mount(Card,{props:{owner,accountId:1,email,name:'Person',anchor},global:{stubs:{Icon:true}}});
  await flushPromises();
  await wrapper.get('button[aria-label="Add to contacts"]').trigger('click');
  wrapper.unmount();
  wrapper=null;
  if (!sameSession) localStorage.setItem('token','next-session');
  acknowledge({name:'Person',email});
  await flushPromises();
  expect(store.contactRevision).toBe(sameSession ? 1 : 0);
  expect(http.put).toHaveBeenCalledWith('/v1/contacts',{email,name:'Person',accountId:1,saved:true},
    {headers:{Authorization:'card-session'},noMsg:true});
});
