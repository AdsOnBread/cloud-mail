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

it('retains one complete link and inline formatting across text nodes', async () => {
  const html = '<div><b>Go https://example.dev/</b><i>billing now</i>, then sales<span>@</span>example.app. ' +
    'Also www.例子.中国. <b>unlinked</b><br>example.org</div>';
  const reader = mount(MessageContent, { props: { html } });
  await flushPromises();
  const doc = new DOMParser().parseFromString(reader.get('iframe').attributes('srcdoc'), 'text/html');
  const links = [...doc.querySelectorAll('a')];
  expect(links.map(link => link.textContent)).toEqual(['https://example.dev/billing', 'sales@example.app', 'www.例子.中国', 'example.org']);
  expect(links[0].querySelector('b').textContent).toBe('https://example.dev/');
  expect(links[0].querySelector('i').textContent).toBe('billing');
  expect(links[1].getAttribute('href')).toBe('mailto:sales@example.app');
  reader.unmount();
});

it('preserves mailto recipients and fields, and encodes delimiters in bare addresses', async () => {
  const uri = 'mailto:one@example.org,two@example.org?subject=Map%20notes&cc=three@example.org';
  const text = uri + '. Contact issue#123@example.com, qa?ops@example.com or tag%40@example.com.';
  const reader = mount(MessageContent, { props: { text } });
  await flushPromises();
  expect(reader.findAll('a').map(link => link.attributes('href'))).toEqual([
    uri, 'mailto:issue%23123@example.com', 'mailto:qa%3Fops@example.com', 'mailto:tag%2540@example.com',
  ]);
  reader.unmount();
});

it('distinguishes soft wraps from hidden and block content', async () => {
  const html = '<div>https://example.org/<wbr>billing https://example.com<span hidden>draft</span>' +
    ' https://example.dev<span style="display:none">test</span>' +
    ' https://example.app<span style="display:block">next</span></div>';
  const reader = mount(MessageContent, { props: { html } });
  await flushPromises();
  const doc = new DOMParser().parseFromString(reader.get('iframe').attributes('srcdoc'), 'text/html');
  expect([...doc.querySelectorAll('a')].map(a => a.textContent)).toEqual([
    'https://example.org/billing', 'https://example.com', 'https://example.dev', 'https://example.app',
  ]);
  reader.unmount();
});

it('ends mail links at sentence boundaries and retains balanced parentheses', async () => {
  const a = 'mailto:a@example.org?subject=Hello', b = 'mailto:b@example.org?body=Meet%20(Friday)';
  const reader = mount(MessageContent, { props: { text: a + '。下一句。 (' + b + ').' } });
  await flushPromises();
  expect(reader.findAll('a').map(link => link.attributes('href'))).toEqual([a, b]);
  reader.unmount();
});

it('leaves ambiguous styled spans intact instead of linking a truncated path', async () => {
  const html = '<style>body{font-family:Arial}</style><div>https://example.org/<b>billing</b> or https://example.org/help.</div>';
  const reader = mount(MessageContent, { props: { html } });
  await flushPromises();
  const doc = new DOMParser().parseFromString(reader.get('iframe').attributes('srcdoc'), 'text/html');
  expect([...doc.querySelectorAll('a')].map(a => a.textContent)).toEqual(['https://example.org/help']);
  expect(doc.body.textContent).toContain('https://example.org/billing');
  reader.unmount();
});

it('keeps named inline destinations intact without linking a misleading prefix', async () => {
  const html = '<div>https://example.org/<span id="destination">billing</span></div>';
  const reader = mount(MessageContent, { props: { html } });
  await flushPromises();
  const doc = new DOMParser().parseFromString(reader.get('iframe').attributes('srcdoc'), 'text/html');
  expect(doc.querySelectorAll('a')).toHaveLength(0);
  expect(doc.querySelectorAll('#destination')).toHaveLength(1);
  expect(doc.body.textContent).toBe('https://example.org/billing');
  reader.unmount();
});
