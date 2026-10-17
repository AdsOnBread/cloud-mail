import { beforeEach, describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import en from '../src/i18n/en.js';
import MailList from '../src/components/email-scroll/index.vue';
import { useUserStore } from '../src/store/user.js';
import { useSettingStore } from '../src/store/setting.js';
vi.mock('../src/request/my.js',()=>({loginUserInfo:vi.fn()}));
vi.mock('@vueuse/core',async()=>{
 const actual=await vi.importActual('@vueuse/core');return {...actual,useScroll:()=>({arrivedState:{bottom:false}})};
});
vi.mock('@vueuse/components',()=>({UseVirtualList:{props:['list','options'],setup(props,{expose}){expose({scrollTo:()=>{},setScrollTop:()=>{}});},template:'<div><slot v-for="(data,index) in list" :data="data" :index="index" /></div>'}}));
const row=(emailId,subject)=>({emailId,subject,name:'Sender',createTime:'2026-10-17 12:00:00',status:0});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function list(getEmailList) {
 return mount(MailList,{props:{getEmailList,requestKey:'first',showFirstLoading:false},global:{
  plugins:[createI18n({legacy:false,locale:'en',messages:{en}})],
  stubs:{Icon:true,ElCheckbox:true,ElSkeleton:true,ElSkeletonItem:true,ElTag:true,ElTooltip:true,ElDropdownItem:true,ElDropdownMenu:true,ElDropdown:{template:'<div />'},ElEmpty:{template:'<p>No messages found</p>'}},directives:{perm:()=>{}}}});
}
beforeEach(()=>{setActivePinia(createPinia());useUserStore().user={email:'me@example.com',permKeys:['*']};useSettingStore().settings={manyEmail:0};});
describe('mail list refreshes',()=>{
 it('keeps newer search results when an older response arrives last',async()=>{
  const old=deferred(),current=deferred();const request=vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const wrapper=list(request);await wrapper.setProps({requestKey:'second'});
  current.resolve({list:[row(2,'Current match')],total:1});await flushPromises();
  expect(wrapper.vm.emailList.map(item=>item.subject)).toEqual(['Current match']);
  old.resolve({list:[row(1,'Old match')],total:1});await flushPromises();
  expect(wrapper.vm.emailList.map(item=>item.subject)).toEqual(['Current match']);wrapper.unmount();
 });
 it('allows retry after a failed refresh',async()=>{
  const request=vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({list:[row(1,'Recovered')],total:1});
  const wrapper=list(request);await flushPromises();expect(wrapper.text()).toContain('Offline');
  await wrapper.findAll('button').find(button=>button.text()==='Retry').trigger('click');await flushPromises();
  expect(wrapper.vm.emailList.map(item=>item.subject)).toEqual(['Recovered']);wrapper.unmount();
 });
});
