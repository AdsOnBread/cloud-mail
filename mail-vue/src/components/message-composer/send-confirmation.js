import {inlineImageSources} from './files';
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
  const photoMarker = crypto.randomUUID();
  const sources = new Set(form.attachments.flatMap(inlineImageSources));
  for (const image of body.querySelectorAll('img')) {
    const src = image.getAttribute('src') || '';
    const uploaded = !form.plainText && (/^data:image\//i.test(src) || sources.has(src));
    image.replaceWith(uploaded ? ' '+photoMarker+' ' : ' ');
  }
  body.querySelectorAll('a[href]').forEach(link => link.removeAttribute('href'));

  const authored = form.content ? plainBodyText(body) : form.text;
  let phrase;
  for (const line of authored.split(/\r?\n/)) {
    // Pasted and imported mail can retain only the visible reply/signature separator.
    if (/^--[ \u00a0]+$/.test(line) || /^On .+ wrote:\s*$/i.test(line.trim()) ||
        /^-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}$/i.test(line.trim())) break;
    if (/^\s*>/.test(line)) continue;
    if (line.includes(photoMarker)) return '';
    phrase ||= line.replace(/\s+/g, ' ').match(attachmentPhrase)?.[0];
  }
  if (phrase) return 'It seems like you forgot to attach a file.\n\nYou wrote "' + phrase + '" in your message, but there are no files attached. Send anyway?';
  return '';
}
