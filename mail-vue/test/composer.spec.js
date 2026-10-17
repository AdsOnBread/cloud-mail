import { beforeEach, describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Composer from '../src/layout/write/index.vue';
import { useUserStore } from '../src/store/user.js';
import { useAccountStore } from '../src/store/account.js';
import { emailSend } from '../src/request/email.js';

const state = vi.hoisted(() => ({ drafts:new Map(), attachments:new Map(), next:1 }));
vi.mock('../src/db/db.js', () => {
  const table = map => ({
    add:vi.fn(async value => {const id=state.next++;map.set(id,structuredClone(value));return id;}),
    put:vi.fn(async value => {map.set(value.draftId,structuredClone(value));}),
    delete:vi.fn(async id => {map.delete(id);}),
  });
  return {default:{value:{draft:table(state.drafts),att:table(state.attachments),transaction:async (...args)=>args.at(-1)()}}};
});
vi.mock('../src/request/email.js', () => ({emailSend:vi.fn(),emailDetail:vi.fn()}));
vi.mock('../src/request/my.js', () => ({loginUserInfo:vi.fn(async()=>({userId:1,email:'me@example.com',permKeys:['*'],account:{accountId:1,email:'me@example.com'}}))}));
vi.mock('element-plus', () => ({ElMessage:Object.assign(vi.fn(),{error:vi.fn(),info:vi.fn()}),ElNotification:{success:vi.fn(),warning:vi.fn()},ElMessageBox:{confirm:vi.fn(async()=>{})}}));
vi.mock('../src/components/tiny-editor/index.vue', async () => {
  const { defineComponent, ref, watch }=await import('vue');
  return {default:defineComponent({props:['defValue'],emits:['change'],setup(props,{emit,expose}) {
    const body=ref(props.defValue || '');watch(()=>props.defValue,value=>{body.value=value;});
    expose({clearEditor:()=>{body.value='';},getContent:()=>body.value});return {body,update:()=>emit('change',body.value,body.value)};
  },template:'<textarea aria-label="Message body" v-model="body" @input="update" />'})};
});
const button = { props:['loading'], template:'<button type="button" :disabled="loading"><slot /></button>' };
function composer() {
  return mount(Composer,{global:{components:{ElButton:button},stubs:{ElDialog:{template:'<div />'},Icon:true,ElTable:true,ElTableColumn:true}}});
}
async function populate(wrapper) {
  wrapper.vm.open();await flushPromises();
  await wrapper.get('[aria-label="To recipients"]').setValue('person@example.com');
  await wrapper.get('[aria-label="Subject"]').setValue('Report');
  await wrapper.get('[aria-label="Message body"]').setValue('<p>Hello</p>');
  await wrapper.findAll('button').find(button=>button.text()==='Cc').trigger('click');
  await wrapper.findAll('button').find(button=>button.text()==='Bcc').trigger('click');
  await wrapper.get('[aria-label="Cc recipients"]').setValue('copy@example.com');
  await wrapper.get('[aria-label="Bcc recipients"]').setValue('private@example.com');
}
beforeEach(()=>{
  setActivePinia(createPinia());state.drafts.clear();state.attachments.clear();state.next=1;
  useUserStore().user={userId:1,email:'me@example.com',name:'Me',permKeys:['*'],account:{accountId:1,email:'me@example.com'}};
  useAccountStore().currentAccount={accountId:1,email:'me@example.com',name:'Me'};
  vi.mocked(emailSend).mockReset();
});
describe('composer persistence and sending',()=>{
  it('commits pending To/Cc/Bcc on Send, submits separate arrays, and removes the saved draft after success',async()=>{
    vi.mocked(emailSend).mockResolvedValue([{emailId:20,subject:'Report'}]);
    const wrapper=composer();await populate(wrapper);
    await wrapper.findAll('button').find(button=>button.text()==='Send').trigger('click');await flushPromises();
    expect(emailSend).toHaveBeenCalledWith(expect.objectContaining({receiveEmail:['person@example.com'],cc:['copy@example.com'],bcc:['private@example.com']}),expect.any(Function));
    expect(state.drafts.size).toBe(0); expect(state.attachments.size).toBe(0);wrapper.unmount();
  });
  it('keeps recipient fields and a saved draft after a network failure',async()=>{
    vi.mocked(emailSend).mockRejectedValue(new Error('Network failed'));
    const wrapper=composer();await populate(wrapper);
    await wrapper.findAll('button').find(button=>button.text()==='Send').trigger('click');await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Network failed');
    expect(wrapper.text()).toContain('private@example.com');
    expect([...state.drafts.values()][0]).toMatchObject({cc:['copy@example.com'],bcc:['private@example.com']});
    expect(wrapper.get('[aria-label="Subject"]').element.value).toBe('Report');wrapper.unmount();
  });
  it('saves a Bcc-only draft without requiring the Drafts screen to be mounted',async()=>{
    const wrapper=composer();wrapper.vm.open();await flushPromises();
    await wrapper.findAll('button').find(button=>button.text()==='Bcc').trigger('click');
    await wrapper.get('[aria-label="Bcc recipients"]').setValue('private@example.com');
    await wrapper.get('[aria-label="Close and save draft"]').trigger('click');await flushPromises();
    expect([...state.drafts.values()][0]).toMatchObject({receiveEmail:[],cc:[],bcc:['private@example.com']});wrapper.unmount();
  });
  it('removes an emptied existing draft when it is closed',async()=>{
    state.drafts.set(5,{subject:'Old'});state.attachments.set(5,{draftId:5,attachments:[]});
    const wrapper=composer();wrapper.vm.openDraft({draftId:5,receiveEmail:[],cc:[],bcc:[],subject:'',content:''});await flushPromises();
    await wrapper.get('[aria-label="Close and save draft"]').trigger('click');await flushPromises();
    expect(state.drafts.size).toBe(0);expect(state.attachments.size).toBe(0);wrapper.unmount();
  });
  it('opens older drafts with empty Cc/Bcc and opens populated rows for new drafts',async()=>{
    const wrapper=composer();wrapper.vm.openDraft({draftId:12,subject:'Old',receiveEmail:['one@example.com'],content:'Hello'});await flushPromises();
    expect(wrapper.find('[aria-label="Cc recipients"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Bcc recipients"]').exists()).toBe(false);wrapper.unmount();
    const another=composer();another.vm.openDraft({draftId:13,receiveEmail:['one@example.com'],cc:['copy@example.com'],bcc:['private@example.com']});await flushPromises();
    expect(another.find('[aria-label="Cc recipients"]').exists()).toBe(true);
    expect(another.find('[aria-label="Bcc recipients"]').exists()).toBe(true);another.unmount();
  });
});
