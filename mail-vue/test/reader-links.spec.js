import { createPinia, setActivePinia } from 'pinia';
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it } from 'vitest';
import MessageContent from '../src/components/shadow-html/message-content.vue';

beforeEach(() => setActivePinia(createPinia()));

const sentence = 'See (https://example.org/a_(b)?n=2), or email demo+mail@example.org.';
for (const props of [{ text: sentence }, { html: '<p>' + sentence + '</p>' }]) {
  it('recognizes addresses without swallowing punctuation in ' + Object.keys(props)[0], async () => {
    const reader = mount(MessageContent, { props });
    await flushPromises();
    expect(reader.text()).toBe(sentence);
    const links = reader.findAll('a');
    expect(links.map(link => link.attributes('href'))).toEqual([
      'https://example.org/a_(b)?n=2', 'mailto:demo+mail@example.org',
    ]);
    for (const link of links) expect(link.attributes('rel')).toBe('noopener noreferrer');
    reader.unmount();
  });
}

it('preserves authored destinations, literal code and formatting in rich mail', async () => {
  const html = '<table><tr><td><a href="https://original.example">www.example.com</a> ' +
    '<code>www.example.com</code> <b>www.example.com</b></td></tr></table>';
  const reader = mount(MessageContent, { props: { html } });
  await flushPromises();
  const frame = reader.get('iframe');
  const doc = new DOMParser().parseFromString(frame.attributes('srcdoc'), 'text/html');
  expect(doc.querySelectorAll('a')).toHaveLength(2);
  expect(doc.querySelector('td > a').href).toBe('https://original.example/');
  expect(doc.querySelector('b > a').href).toBe('https://www.example.com/');
  expect(doc.querySelector('b > a').textContent).toBe('www.example.com');
  expect(doc.querySelector('code').childElementCount).toBe(0);
  expect(doc.querySelector('b > a').rel).toBe('noopener noreferrer');
  reader.unmount();
});

it('recognizes addresses in expanded history and preserves its disclosure state', async () => {
  const html = '<div>New</div><div class="gmail_quote"><blockquote>See https://example.org</blockquote></div>';
  const reader = mount(MessageContent, { props: { html } });
  await flushPromises();
  expect(reader.find('a').exists()).toBe(false);
  await reader.get('button').trigger('click');
  await flushPromises();
  expect(reader.get('blockquote a').attributes('href')).toBe('https://example.org');
  reader.unmount();
});
