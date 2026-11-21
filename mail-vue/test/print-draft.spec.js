import {expect,it} from 'vitest';
import {renderDraft} from '../src/components/message-composer/print-draft';

it('prints just the selected draft, preserving formatting without fetching external content', () => {
  const doc = document.implementation.createHTMLDocument();
  renderDraft(doc, {subject:'A <subject>',sendEmail:'author@example.com',cc:['one@example.com'],
    content:'<table><tr><th colspan="2" rowspan="2">Title</th></tr></table><b>Bold</b><img src="https://example.com/pixel" alt="Photo"><script>bad()</script>',
    attachments:[{filename:'one.pdf'},{filename:'inline',contentId:'cid'}]});
  expect(doc.title).toBe('A <subject>');
  expect(doc.querySelector('main b').textContent).toBe('Bold');
  expect(doc.querySelector('main').textContent).toBe('TitleBoldPhoto');
  expect(doc.querySelector('th')).toMatchObject({colSpan:2,rowSpan:2});
  expect(doc.querySelector('img,script,subject')).toBeNull();
  expect(doc.querySelector('footer').textContent).toBe('Attachments: one.pdf');
});
