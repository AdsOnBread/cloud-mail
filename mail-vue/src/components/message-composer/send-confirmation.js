import {referencedAttachments} from './files';
import {plainBodyText} from './plain-text';

const emptyMessage = 'Send this message without a subject or text in the body?';
const attachmentPhrase = /\b(?:see (?:the )?attach(?:ed|ments?)|see included|(?:is|are) attached|attached (?:to this (?:email|message)|files?|is|are)|I(?:['’]m| am) attaching|I(?:['’]ve| have) attached|I attach(?:ed)?|find (?:the )?(?:attached|included))\b/i;

export function sendConfirmation(form) {
  if (form.attachments.some(file => !file.contentId)) return '';

  const template = document.createElement('template');
  template.innerHTML = form.content || '';
  const body = template.content;
  const text = form.plainText ? form.text : body.textContent;
  if (!form.subject.trim() && !text.trim() && (form.plainText || !body.querySelector('img,hr,table')))
    return emptyMessage;

  body.querySelectorAll('.cloudmail-signature,.cloudmail-reply-quote,.gmail_signature,.gmail_quote,blockquote,script,style').forEach(node => node.remove());
  // An uploaded photo in the new message is an outgoing MIME part. Old inline
  // attachments retained by a draft, remote URLs and signature images are not.
  if (!form.plainText && (body.querySelector('img[src^="data:image/" i]') || referencedAttachments(form, body).length)) return '';
  body.querySelectorAll('img').forEach(image => image.replaceWith(' '));
  body.querySelectorAll('a[href]').forEach(link => link.removeAttribute('href'));

  const authored = form.content ? plainBodyText(body) : form.text;
  for (const line of authored.split(/\r?\n/)) {
    if (/^\s*>/.test(line)) continue;
    const phrase = line.replace(/\s+/g, ' ').match(attachmentPhrase)?.[0];
    if (phrase) return 'It seems like you forgot to attach a file.\n\nYou wrote "' + phrase + '" in your message, but there are no files attached. Send anyway?';
  }
  return '';
}
