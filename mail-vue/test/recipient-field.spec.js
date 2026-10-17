import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import RecipientField from '../src/components/recipient-field/index.vue';

function field() {
  return mount(defineComponent({ components:{RecipientField}, setup() { return { recipients:ref([]), entry:ref() }; },
    template:'<RecipientField ref="entry" v-model="recipients" label="Bcc" />' }));
}
describe('recipient entry', () => {
  it('commits an unfinished address through the public method used by Send and Save', async () => {
    const wrapper=field(); await wrapper.get('input').setValue('blind@example.com');
    wrapper.vm.entry.commit();
    expect(wrapper.vm.recipients).toEqual(['blind@example.com']);
    wrapper.unmount();
  });
  it('preserves invalid addresses visibly rather than silently dropping them', async () => {
    const wrapper=field(); await wrapper.get('input').setValue('not-an-email'); await wrapper.get('input').trigger('keydown',{key:'Enter'});
    expect(wrapper.vm.recipients).toEqual(['not-an-email']); expect(wrapper.find('.invalid').exists()).toBe(true);
    wrapper.unmount();
  });
  it('commits on blur/Tab and removes the selected chip', async () => {
    const wrapper=field(); await wrapper.get('input').setValue('one@example.com'); await wrapper.get('input').trigger('blur');
    await wrapper.get('input').setValue('two@example.com'); await wrapper.get('input').trigger('keydown',{key:'Tab'});
    expect(wrapper.vm.recipients).toHaveLength(2);
    await wrapper.get('button[aria-label="Remove one@example.com from Bcc"]').trigger('click');
    expect(wrapper.vm.recipients).toEqual(['two@example.com']); wrapper.unmount();
  });
  it('splits pasted recipient lists across all supported delimiters', async () => {
    const wrapper=field(); await wrapper.get('input').trigger('paste',{clipboardData:{getData:()=> 'one@example.com;two@example.com\nthree@example.com'}});
    expect(wrapper.vm.recipients).toHaveLength(3); wrapper.unmount();
  });
});
