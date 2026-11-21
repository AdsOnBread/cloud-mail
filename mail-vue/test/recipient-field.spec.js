import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import {recipientDragSession} from '../src/components/recipient-field/drag';
import RecipientField from '../src/components/recipient-field/index.vue';

vi.mock('@/axios',()=>({default:{get:vi.fn()}}));
import http from '@/axios';

function field() {
  return mount(defineComponent({ components:{RecipientField}, setup() { return { recipients:ref([]), entry:ref() }; },
    template:'<RecipientField ref="entry" v-model="recipients" label="Bcc" :names="{}" />' }), {attachTo:document.body});
}
describe('recipient entry', () => {
  it.each([true,false])('retains an earlier address edit when a later chip drag completes or cancels (%s)', async complete=>{
    const wrapper=mount(defineComponent({
      components:{RecipientField},
      setup:()=>({to:ref(['a@example.test','b@example.test','c@example.test']),bcc:ref([])}),
      template:'<div><RecipientField label="To" v-model="to"/><RecipientField label="Bcc" v-model="bcc"/></div>'
    }),{attachTo:document.body,global:{provide:{[recipientDragSession]:()=>'current'}}});
    try {
      const [from,destination]=wrapper.findAllComponents(RecipientField);
      await from.get('[aria-label="a@example.test"]').trigger('keydown',{key:'F',shiftKey:true});
      await from.get('input').setValue('first@example.test, second@example.test');
      const chip=from.get('[aria-label="b@example.test"]');
      vi.spyOn(chip.element,'getClientRects').mockReturnValue([{}]);
      await chip.trigger('pointerdown',{pointerType:'mouse',button:0});
      await from.get('input').trigger('blur',{relatedTarget:chip.element});
      const values=new Map();
      const dataTransfer={get types(){return [...values.keys()]},setData:(k,v)=>values.set(k,v),getData:k=>values.get(k),setDragImage:vi.fn()};
      await chip.trigger('dragstart',{dataTransfer});
      if (complete) await destination.get('input').trigger('drop',{dataTransfer});
      await chip.trigger('dragend');
      const addresses=w=>w.findAll('.chip-address').map(e=>e.attributes('aria-label'));
      expect(addresses(from)).toEqual(['first@example.test','second@example.test',...(complete?[]:['b@example.test']),'c@example.test']);
      expect(addresses(destination)).toEqual(complete?['b@example.test']:[]);
    } finally {wrapper.unmount();}
  });
  it('commits an unfinished address through the public method used by Send and Save', async () => {
    const wrapper=field(); await wrapper.get('input').setValue('blind@example.com');
    wrapper.vm.entry.commit();
    expect(wrapper.vm.recipients).toEqual(['blind@example.com']);
    wrapper.unmount();
  });
  it('preserves invalid addresses visibly rather than silently dropping them', async () => {
    const wrapper=field(); await wrapper.get('input').setValue('constructor'); await wrapper.get('input').trigger('keydown',{key:'Enter'});
    expect(wrapper.vm.recipients).toEqual(['constructor']); expect(wrapper.find('.invalid').exists()).toBe(true);
    wrapper.unmount();
  });
  it('commits on blur/Tab and removes the selected chip', async () => {
    const wrapper=field(); await wrapper.get('input').setValue('one@example.com'); await wrapper.get('input').trigger('blur');
    await wrapper.get('input').setValue('two@example.com'); await wrapper.get('input').trigger('keydown',{key:'Tab'});
    expect(wrapper.vm.recipients).toHaveLength(2);
    await wrapper.get('button[aria-label="Remove one@example.com from Bcc"]').trigger('click');
    expect(wrapper.vm.recipients).toEqual(['two@example.com']); wrapper.unmount();
  });
  it('selects before deleting and edits a middle chip in place', async () => {
    const wrapper=field(), input=wrapper.get('input');
    await input.setValue('first@example.com,middle@example.com,last@example.com');
    await input.trigger('keydown',{key:'Enter'});
    input.element.focus();
    await input.trigger('keydown',{key:'Backspace'});
    expect(document.activeElement.getAttribute('aria-label')).toBe('last@example.com');
    expect(wrapper.vm.recipients).toHaveLength(3);
    await wrapper.get('[aria-label="last@example.com"]').trigger('keydown',{key:'ArrowLeft'});
    expect(document.activeElement.getAttribute('aria-label')).toBe('middle@example.com');
    await wrapper.get('[aria-label="middle@example.com"]').trigger('keydown',{key:'F',shiftKey:true});
    expect(input.element.value).toBe('middle@example.com');
    await input.setValue('replacement@example.com');
    wrapper.vm.entry.commit();
    expect(wrapper.vm.recipients).toEqual(['first@example.com','replacement@example.com','last@example.com']);
    wrapper.unmount();
  });
  it('removes an emptied edit from the recipients used for Send and Save', async () => {
    const wrapper=field(), input=wrapper.get('input');
    await input.setValue('former@example.com'); await input.trigger('blur');
    await wrapper.get('.chip-address').trigger('keydown',{key:'F',shiftKey:true});
    await input.setValue(''); wrapper.vm.entry.commit();
    expect(wrapper.vm.recipients).toEqual([]);
    wrapper.unmount();
  });
  it('keeps both edits when removing a different chip by pointer', async () => {
    const wrapper=field(), input=wrapper.get('input');
    await input.setValue('first@example.com,next@example.com,last@example.com'); await input.trigger('blur');
    await wrapper.get('.chip-address').trigger('keydown',{key:'F',shiftKey:true});
    await input.setValue('');
    await wrapper.get('[aria-label="Remove next@example.com from Bcc"]').trigger('click');
    expect(wrapper.vm.recipients).toEqual(['last@example.com']);
    wrapper.unmount();
  });
  it('can cancel an address edit and cut the original address', async () => {
    const wrapper=field(), input=wrapper.get('input');
    await input.setValue('blind@example.com'); await input.trigger('blur');
    await wrapper.get('.chip-address').trigger('keydown',{key:'F',shiftKey:true});
    await input.setValue('unfinished'); await input.trigger('keydown',{key:'Escape'});
    expect(wrapper.vm.recipients).toEqual(['blind@example.com']);
    expect(document.activeElement.getAttribute('aria-label')).toBe('blind@example.com');
    const clipboard={};
    await wrapper.get('.chip-address').trigger('cut',{clipboardData:{setData:(format,value)=>clipboard[format]=value}});
    expect(clipboard['text/plain']).toBe('blind@example.com'); expect(wrapper.vm.recipients).toEqual([]);
    wrapper.unmount();
  });
  it('renames a chip independently of its delivery address and preserves commas',async()=>{
    const wrapper=mount(RecipientField,{attachTo:document.body,props:{label:'To',modelValue:['sam@example.net'],names:{'sam@example.net':'Sam'}}});
    const button=wrapper.get('.chip-address'),input=wrapper.get('input');
    await button.trigger('keydown',{key:'E',shiftKey:true});
    expect(input.element.value).toBe('Sam');
    await input.setValue('Rivera, Sam');
    const comma=new KeyboardEvent('keydown',{key:',',bubbles:true,cancelable:true});input.element.dispatchEvent(comma);
    expect(comma.defaultPrevented).toBe(false);
    wrapper.vm.commit();
    expect(wrapper.emitted('choosePerson').at(-1)).toEqual([{email:'sam@example.net',name:'Rivera, Sam'}]);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    wrapper.unmount();
  });
  it('returns keyboard navigation to the field when leaving the address menu', async () => {
    const wrapper=field(), input=wrapper.get('input');
    await input.setValue('menu@example.com'); await input.trigger('blur');
    const button=wrapper.get('.chip-address');
    for (const reverse of [false,true]) {
      await button.trigger('keydown',{key:'Enter'});
      const action=document.querySelector('.recipient-menu button');
      expect(document.activeElement).toBe(action);
      action.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:reverse,bubbles:true}));
      expect(document.activeElement).toBe(reverse ? wrapper.get('.field-label').element : input.element);
    }
    wrapper.unmount();
  });
  it('keeps the blind-copy address out of To suggestions and accepts a highlighted name on Tab',async()=>{
    const wrapper=mount(RecipientField,{attachTo:document.body,props:{label:'To',owner:'owner',accountId:1,
      otherRecipients:['secret@example.net'],recent:['secret@example.net','safe@example.net'],
      names:{'safe@example.net':'Sample Safe','secret@example.net':'Sample Secret'}}});
    const input=wrapper.get('input'); await input.setValue('Sample');
    const choices=document.querySelectorAll('.recipient-suggestions [role=option]');
    expect(choices.length).toBe(1); expect(choices[0].textContent).toContain('Sample Safe');
    await input.trigger('keydown',{key:'Tab'});
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([['safe@example.net']]);
    wrapper.unmount();
  });
  it.each(['Enter','Tab'])('preserves a complete typed address on %s when a longer address previously matched',async key=>{
    const wrapper=mount(RecipientField,{props:{label:'To',owner:'owner',accountId:1,recent:['alexandra@example.com.au']}});
    const input=wrapper.get('input');
    await input.setValue('alexandra');
    expect(input.attributes('aria-activedescendant')).toBeTruthy();
    await input.setValue('alexandra@example.com');
    expect(input.attributes('aria-activedescendant')).toBeUndefined();
    await input.trigger('keydown',{key});
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([['alexandra@example.com']]);
    wrapper.unmount();
  });
  it('keeps removed mailbox contacts hidden even when the server finds their messages',async()=>{
    vi.useFakeTimers();
    const wrapper=mount(RecipientField,{props:{label:'Cc',owner:'first',accountId:1,removed:['removed@example.net']}});
    try {
      http.get.mockResolvedValueOnce([{email:'Removed@example.net',name:'Removed'}]);
      await wrapper.get('input').setValue('Rem');await vi.advanceTimersByTimeAsync(150);
      expect(wrapper.get('input').attributes('aria-expanded')).toBe('false');
    } finally {wrapper.unmount();vi.useRealTimers();}
  });
  it('ignores late mailbox matches after the sending identity changes',async()=>{
    vi.useFakeTimers();
    const wrapper=mount(RecipientField,{props:{label:'Cc',owner:'first',accountId:1}});
    try {
      let resolve; http.get.mockImplementationOnce(()=>new Promise(done=>{resolve=done}));
      await wrapper.get('input').setValue('Ada');await vi.advanceTimersByTimeAsync(150);
      await wrapper.setProps({owner:'second',accountId:2});
      resolve([{email:'ada@example.net',name:'Ada'}]);await vi.advanceTimersByTimeAsync(0);
      expect(wrapper.get('input').attributes('aria-expanded')).toBe('false');
    } finally {wrapper.unmount();vi.useRealTimers();}
  });
  it('splits pasted recipient lists across all supported delimiters', async () => {
    const wrapper=field(); await wrapper.get('input').trigger('paste',{clipboardData:{getData:()=> 'one@example.com;two@example.com\nthree@example.com'}});
    expect(wrapper.vm.recipients).toHaveLength(3); wrapper.unmount();
  });
});
