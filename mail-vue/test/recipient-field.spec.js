import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import RecipientField from '../src/components/recipient-field/index.vue';

function field() {
  return mount(defineComponent({ components:{RecipientField}, setup() { return { recipients:ref([]), entry:ref() }; },
    template:'<RecipientField ref="entry" v-model="recipients" label="Bcc" :names="{}" />' }), {attachTo:document.body});
}
describe('recipient entry', () => {
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
    expect(document.activeElement.title).toBe('last@example.com');
    expect(wrapper.vm.recipients).toHaveLength(3);
    await wrapper.get('[title="last@example.com"]').trigger('keydown',{key:'ArrowLeft'});
    expect(document.activeElement.title).toBe('middle@example.com');
    await wrapper.get('[title="middle@example.com"]').trigger('keydown',{key:'F',shiftKey:true});
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
  it('can cancel an address edit and cut the original address', async () => {
    const wrapper=field(), input=wrapper.get('input');
    await input.setValue('blind@example.com'); await input.trigger('blur');
    await wrapper.get('.chip-address').trigger('keydown',{key:'F',shiftKey:true});
    await input.setValue('unfinished'); await input.trigger('keydown',{key:'Escape'});
    expect(wrapper.vm.recipients).toEqual(['blind@example.com']);
    expect(document.activeElement.title).toBe('blind@example.com');
    const clipboard={};
    await wrapper.get('.chip-address').trigger('cut',{clipboardData:{setData:(format,value)=>clipboard[format]=value}});
    expect(clipboard['text/plain']).toBe('blind@example.com'); expect(wrapper.vm.recipients).toEqual([]);
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
  it('splits pasted recipient lists across all supported delimiters', async () => {
    const wrapper=field(); await wrapper.get('input').trigger('paste',{clipboardData:{getData:()=> 'one@example.com;two@example.com\nthree@example.com'}});
    expect(wrapper.vm.recipients).toHaveLength(3); wrapper.unmount();
  });
});
