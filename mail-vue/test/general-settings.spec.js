import {beforeEach,expect,it,vi} from 'vitest';
import {flushPromises,shallowMount} from '@vue/test-utils';
import {createPinia,setActivePinia} from 'pinia';
import {createMemoryHistory,createRouter} from 'vue-router';
import GeneralSettings from '../src/views/setting/index.vue';
import {useUserStore} from '../src/store/user';
import {useMailSignatures} from '../src/store/mail-signatures';
import http from '../src/axios';

vi.mock('../src/axios',()=>({default:{get:vi.fn(),put:vi.fn()}}));
const preferences={version:2,undoSeconds:10,replyAll:false};
const original={version:1,items:[{id:'one',name:'Work',html:'Initial'}],defaults:{},beforeQuote:false};

beforeEach(()=>{
  vi.resetAllMocks();
  localStorage.setItem('token','fixture');
  setActivePinia(createPinia());
  const user=useUserStore();
  user.user={userId:1,email:'one@example.com'};user.authenticatedToken='fixture';
});

it('keeps signature edits while retrying preferences and blocks stale writes after a failed conflict reload',async()=>{
  const router=createRouter({history:createMemoryHistory(),routes:[{path:'/settings',component:GeneralSettings}]});
  await router.push('/settings');
  let prefsFail=true,sigsFail=false;
  http.get.mockImplementation(async path=>{
    if (path.endsWith('signatures')) {
      if (sigsFail) throw Error('Signatures unavailable');
      return original;
    }
    if (prefsFail) throw Error('Preferences unavailable');
    return preferences;
  });
  const wrapper=shallowMount(GeneralSettings,{global:{plugins:[router],stubs:{
    SignatureFields:{props:['form'],template:'<input class="signature-name" v-model="form.items[0].name">'},
  }}});
  try {
    await flushPromises();
    await wrapper.get('.signature-name').setValue('Edited');
    const submit=wrapper.get('button[type="submit"]');
    expect(submit.element.disabled).toBe(false);
    prefsFail=false;
    await wrapper.get('p[role="alert"] button').trigger('click');await flushPromises();
    expect(wrapper.get('.signature-name').element.value).toBe('Edited');
    await wrapper.get('#undo-send-period').setValue('20');
    http.put.mockRejectedValueOnce({code:409,message:'Settings changed elsewhere'});
    await wrapper.get('form').trigger('submit');await flushPromises();
    sigsFail=true;
    await wrapper.get('p[role="alert"] button').trigger('click');await flushPromises();
    expect(wrapper.get('p[role="alert"]').text()).toContain('Signatures unavailable');
    expect(submit.element.disabled).toBe(true);
    expect(wrapper.get('#undo-send-period').element.value).toBe('20');
    expect(wrapper.get('.signature-name').element.value).toBe('Edited');
    sigsFail=false;
    await wrapper.get('p[role="alert"] button').trigger('click');await flushPromises();
    expect(wrapper.find('p[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('.signature-name').element.value).toBe('Work');
    expect(wrapper.get('#undo-send-period').element.value).toBe('10');
  } finally {wrapper.unmount();}
});

it('returns the newer signed-in signature to a composer waiting for a stale read',async()=>{
  const signatures=useMailSignatures();
  let release;
  http.get.mockReturnValueOnce(new Promise(resolve=>{release=resolve;}));
  const pending=signatures.load(true);
  const saved={...original,version:2};
  signatures.rememberSaved(saved);
  release(original);
  expect(await pending).toEqual(saved);
  expect(signatures.data).toEqual(saved);
});
