import {expect, it} from 'vitest';
import {sendConfirmation} from '../src/components/message-composer/send-confirmation';

const draft = (content, extra = {}) => ({subject:'Report', text:'', attachments:[], content, ...extra});

it('quotes the phrase as written, including mixed styles, capitalization and apostrophes', () => {
  expect(sendConfirmation(draft('<p>Please see <b>the attached</b> report.</p>'))).toContain('"see the attached"');
  expect(sendConfirmation(draft('<p>I’ve attached the receipt.</p>'))).toContain('"I’ve attached"');
  expect(sendConfirmation(draft('See ATTACHMENTS for details'))).toContain('"See ATTACHMENTS"');
});

it('checks the new message and skips signatures, earlier conversations and image descriptions', () => {
  const html = '<div>Thanks!</div><blockquote>Please see attached</blockquote><div class="cloudmail-signature">See my signature <img alt="see attached"></div><div class="cloudmail-reply-quote">I attached a file</div>';
  expect(sendConfirmation(draft(html))).toBe('');
  expect(sendConfirmation(draft('', {text:'Hello!\n> See attached',plainText:true}))).toBe('');
  expect(sendConfirmation(draft('<div><img alt="see attached" src="https://example.org/art.png"></div>'))).toBe('');
  expect(sendConfirmation(draft('I sometimes feel attached to the neighborhood.'))).toBe('');
});

it('recognizes text-only signature and message-history separators in imported replies', () => {
  for (const divider of ['-- ', 'On Wed, 18 Nov 2026, Pat wrote:', '---------- Forwarded message ---------', '-----Original Message-----']) {
    expect(sendConfirmation(draft('', {text:'Thanks!\n'+divider+'\nPlease see attached.', plainText:true}))).toBe('');
    expect(sendConfirmation(draft('', {text:'Please see attached.\n'+divider+'\nOld message', plainText:true}))).toContain('"see attached"');
  }
});

it('distinguishes files and uploaded photos from removed images and signature artwork', () => {
  const content = '<b>See attached.</b>';
  const inline = {contentId:'<part>', attachmentId:23};
  expect(sendConfirmation(draft(content, {attachments:[{filename:'file.pdf'}]}))).toBe('');
  for (const src of ['cid:part','/api/v1/drafts/attachments/23/content','data:image/png;base64,YQ==']) {
    expect(sendConfirmation(draft(content+'<img src="'+src+'">', {attachments:[inline]}))).toBe('');
  }
  for (const divider of ['-- ', 'On Wed, Pat wrote:']) {
    expect(sendConfirmation(draft(content+'<div>'+divider+'</div><div><img src="cid:part"></div>',{attachments:[inline]}))).toContain('"See attached"');
  }
  expect(sendConfirmation(draft(content+'<div class="cloudmail-signature"><img src="cid:part"></div>',{attachments:[inline]}))).toContain('"See attached"');
});

it('preserves the blank-message prompt and ignores a subject-only mention', () => {
  expect(sendConfirmation(draft('<p><br></p>',{subject:''}))).toBe('Send this message without a subject or text in the body?');
  expect(sendConfirmation(draft('',{subject:'See attached'}))).toBe('');
});
