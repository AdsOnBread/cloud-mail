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

it('prints visible message content and keeps private delivery metadata separate from To and Cc',async()=>{
 const {appendPrintedMessage}=await import('../src/components/conversation-view/print');
 const doc=document.implementation.createHTMLDocument();
 const message={emailId:5,userId:1,type:0,name:'A',sendEmail:'a@example.org',toEmail:'envelope@example.org',
   recipient:'[]',cc:'[{"address":"team@example.org"}]',bcc:'[{"address":"secret@example.org"}]',
   content:'<head><title>metadata</title></head><p hidden>hidden text</p><span style="display:none">preheader</span><p>Visible <strong>text</strong></p>',attList:[]};
 await appendPrintedMessage(doc,message,1,()=>true);
 expect(doc.querySelector('article strong:last-child')).toBeTruthy();
 expect(doc.body.textContent).toContain('Visible text');
 for (const hidden of ['metadata','hidden text','preheader','envelope@','secret@']) expect(doc.body.textContent).not.toContain(hidden);
 expect(doc.body.textContent).toContain('Cc: team@example.org');
 const sent=document.implementation.createHTMLDocument();
 await appendPrintedMessage(sent,{...message,type:1},1,()=>true);
 expect(sent.body.textContent).toContain('Bcc: secret@example.org');
 const envelope=document.implementation.createHTMLDocument();
 await appendPrintedMessage(envelope,{...message,cc:[]},1,()=>true);
 expect(envelope.body.textContent).toContain('Delivered to: envelope@example.org');
 expect(envelope.body.textContent).not.toContain('To: envelope@');
});

it('preserves inline photo dimensions when printing a message or draft',()=>{
 const doc=document.implementation.createHTMLDocument();
 renderDraft(doc,{content:'<img src="data:image/png;base64,AA==" width="48" height="24" style="width:48px;height:24px">',attachments:[]});
 const image=doc.querySelector('img');
 expect(image.getAttribute('width')).toBe('48');
 expect(image.getAttribute('height')).toBe('24');
 expect(image.style.width).toBe('48px');expect(image.style.height).toBe('24px');
});
