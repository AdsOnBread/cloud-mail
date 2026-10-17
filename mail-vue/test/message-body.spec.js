import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import MessageBody from '../src/components/shadow-html/index.vue';
import { useUiStore } from '../src/store/ui.js';
vi.mock('../src/utils/private-files',()=>({privateFileURL:vi.fn(),storedKey:src=>src?.includes('attachments/')?'attachments/test.png':null}));
beforeEach(()=>{setActivePinia(createPinia());vi.stubGlobal('URL', class extends URL { static revokeObjectURL=vi.fn(); });});
afterEach(()=>vi.unstubAllGlobals());
describe('isolated message rendering',()=>{
 it('mounts the iframe only once the complete sanitized document is ready',async()=>{
  const wrapper=mount(MessageBody,{props:{html:'<p>Hello</p><script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">link</a>'}});
  expect(wrapper.find('iframe').exists()).toBe(false);await flushPromises();
  const frame=wrapper.get('iframe');expect(frame.attributes('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox');
  const document=frame.attributes('srcdoc');expect(document).toContain('<p>Hello</p>');expect(document).not.toContain('alert(1)');
  expect(document).toContain("default-src 'none'");expect(wrapper.find('button').exists()).toBe(false);wrapper.unmount();
 });
 it('offers opt-in remote images only when present and preserves content when the theme changes',async()=>{
  const wrapper=mount(MessageBody,{props:{html:'<p>Hello</p><img src="https://example.net/photo.png">'}});await flushPromises();
  expect(wrapper.get('button').text()).toBe('Load remote images');
  const original=wrapper.get('iframe').attributes('srcdoc');expect(original).toContain('img-src blob: data: ;');
  useUiStore().dark=true;await flushPromises();expect(wrapper.get('iframe').attributes('srcdoc')).toContain('Hello');
  expect(wrapper.get('iframe').attributes('srcdoc')).toContain('#242529');
  await wrapper.get('button').trigger('click');await flushPromises();expect(wrapper.get('iframe').attributes('srcdoc')).toContain('img-src blob: data: https: http:');wrapper.unmount();
 });
});
