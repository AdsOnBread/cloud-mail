import {createPinia,setActivePinia} from 'pinia';
import {mount,flushPromises} from '@vue/test-utils';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import MessageContent from '../src/components/shadow-html/message-content.vue';
import {messageParts} from '../src/components/shadow-html/quoted-content';
beforeEach(()=>{setActivePinia(createPinia());vi.stubGlobal('URL',class extends URL {static revokeObjectURL=vi.fn();});});
afterEach(()=>vi.unstubAllGlobals());
const source=html=>new DOMParser().parseFromString(html,'text/html').body;
const content=parts=>parts.map(part=>[Boolean(part.quote),source(part.html).textContent.trim()]);
const quote='<div class="gmail_quote"><div class="gmail_attr">On Tuesday, Sam wrote:</div><blockquote class="gmail_quote">Older answer</blockquote></div>';

it('keeps inline replies on both sides and groups nested citations into one disclosure',()=>{
 const html='<div dir="rtl">First'+quote+'Middle'+quote.replace('Older answer','Earlier question')+'Last</div>';
 const parts=messageParts({html,subject:'Re: Notes'});
 expect(content(parts)).toEqual([[false,'First'],[true,'On Tuesday, Sam wrote:Older answer'],[false,'Middle'],[true,'On Tuesday, Sam wrote:Earlier question'],[false,'Last']]);
 for(const part of parts)expect(source(part.html).querySelector('[dir=rtl]')).toBeTruthy();
});
it('keeps authored blockquotes, a forwarded reply subject and forwarded Gmail content visible',()=>{
 for(const html of ['<p>A quotation</p><blockquote>From the book</blockquote>','<div><br></div><div class="cloudmail-reply-quote"><p>The approved budget</p></div>',
  '<div class="gmail_quote"><div>---------- Forwarded message ---------</div><p>Invite</p></div>']) {
  expect(messageParts({html,subject:'Re: Budget'})).toEqual([{html}]);
 }
});
it('folds plain-text reply sections independently without changing CRLF or hiding new answers',()=>{
 const text='New response\r\nOn Tuesday, Sam wrote:\r\n> Question one\r\nMy answer\r\n> Question two\r\nEnd.';
 const parts=messageParts({text,subject:'Re: Budget'});
 expect(parts.map(p=>p.text).join('')).toBe(text);
 expect(parts.filter(p=>p.quote).map(p=>p.text)).toEqual(['On Tuesday, Sam wrote:\r\n> Question one\r\n','> Question two\r\n']);
 expect(messageParts({text:'Measurements\n> 4',subject:'Re: Budget'})).toEqual([{text:'Measurements\n> 4'}]);
});
it('defers private files until a quote is opened, retains focus, and resets on a different body',async()=>{
 const resolveFileUrl=vi.fn(async()=>'data:image/png;base64,dGVzdA==');
 const wrapper=mount(MessageContent,{attachTo:document.body,props:{html:'<div>New response</div>'+quote.replace('Older answer','<img src="attachments/quote.png">'),fileKey:src=>src?.startsWith('attachments/') ? src : null,resolveFileUrl}});
 await flushPromises();
 const button=wrapper.get('button');expect(button.attributes('aria-label')).toBe('Show trimmed content');expect(resolveFileUrl).not.toHaveBeenCalled();
 button.element.focus();await button.trigger('click');await flushPromises();
 expect(document.activeElement).toBe(button.element);expect(button.attributes('aria-expanded')).toBe('true');expect(resolveFileUrl).toHaveBeenCalledTimes(1);
 await button.trigger('click');await button.trigger('click');await flushPromises();expect(resolveFileUrl).toHaveBeenCalledTimes(1);
 await wrapper.setProps({html:'<p>Another reply</p>'+quote});expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');wrapper.unmount();
});
it('keeps ordinary reply formatting outside a scroll frame and rich sender markup inside one',async()=>{
 const html='<div dir="ltr">New <b>answer</b></div><div class="cloudmail-reply-quote"><div>Today Sam &lt;s@example.org&gt; wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">Original</blockquote></div>';
 const wrapper=mount(MessageContent,{props:{html,subject:'Re: Notes'}});await flushPromises();
 expect(wrapper.get('.natural-flow b').text()).toBe('answer');await wrapper.get('button').trigger('click');await flushPromises();
 expect(wrapper.get('.natural-flow blockquote').text()).toBe('Original');
 await wrapper.setProps({html:html.replace('New <b>answer</b>','<a href="javascript:alert(1)">New answer</a>')});
 await flushPromises();expect(wrapper.get('iframe').attributes('sandbox')).not.toContain('allow-scripts');expect(wrapper.get('iframe').attributes('srcdoc')).not.toContain('javascript:');wrapper.unmount();
});

it('preserves stylesheet-dependent messages and structural elements in one document',()=>{
 for (const html of ['<div>Intro</div><style>.teaser{display:none}</style>'+quote+'<div class="teaser">Preheader</div>',
  '<ol start="3"><li>'+quote+'</li><li>Continue</li></ol>']) expect(messageParts({html})).toEqual([{html}]);
});

it('preserves safe direction and link targets when expanding a right-to-left reply',async()=>{
 const html='<html lang="ar" dir="rtl"><body><p>رد</p>'+quote.replace('Older answer','<a href="mailto:a@example.org">كاتب</a>')+'</body></html>';
 const wrapper=mount(MessageContent,{props:{html}});await flushPromises();await wrapper.get('button').trigger('click');await flushPromises();
 const link=wrapper.get('.natural-flow a');expect(link.attributes('rel')).toBe('noopener noreferrer');expect(link.element.closest('[dir=rtl]').lang).toBe('ar');wrapper.unmount();
});

it('keeps nested history inside a forward and uses each adjacent quote marker once',()=>{
 const forward='<div class="cloudmail-reply-quote"><p>Original message</p>'+quote+'</div>';
 expect(messageParts({html:forward,subject:'Re: Budget'})).toEqual([{html:forward}]);
 const parts=messageParts({html:'<div>New</div><div class="gmail_quote">On Tuesday, Pat wrote:</div><div class="gmail_quote">Earlier</div>'});
 expect(content(parts)).toEqual([[false,'New'],[true,'On Tuesday, Pat wrote:'],[true,'Earlier']]);
});
it('groups wrapped plain-text date and address lines with their quoted text',()=>{
 const header='On Tue, 10 Nov 2026 at 15:44,\r\nPat & Co <pat@example.org> wrote:\r\n';
 const text='My answer.\r\n'+header+'> Old reply\r\nNext answer';
 const parts=messageParts({text});
 expect(parts.map(p=>[!!p.quote,p.text])).toEqual([[false,'My answer.\r\n'],[true,header+'> Old reply\r\n'],[false,'Next answer']]);
});

it('recognizes a wrapped reply header after the time or the sender address',()=>{
 for(const instruction of ['On Tuesday please update slide 2\n','On Nov 10, please update slide 2\n','On Nov 10, our meeting is at 3 PM\n']){
  expect(messageParts({text:instruction+'Pat <pat@example.org> wrote:\n> Slide deck attached'})[0]).toEqual({text:instruction});
 }
 for(const header of ['On Tue, Nov 10, 2026 at 3:44 PM,\nAlexandria Jordan-Griffith, Director of International Partnerships\n<alexandria.jordan-griffith@example.org> wrote:', 'On Tue, Nov 10, 2026 at 3:44 PM\nPat <pat@example.org> wrote:', 'On Tue, Nov 10, 2026 at 3:44 PM Pat <pat@example.org>\nwrote:']){
   const parts=messageParts({text:'Answer\n'+header+'\n> Question'});
   expect(parts).toEqual([{text:'Answer\n'},{text:header+'\n> Question',quote:true}]);
 }
});
