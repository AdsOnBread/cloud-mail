import {copyBody,printDocument} from '@/utils/print-document';
import {downloadablePart,storedKey} from '@/utils/private-files';
import {headerRecipients,headerAddressText} from '@/utils/recipients';
import {formatDetailDate} from '@/utils/day';
import {attachmentBlob,previewMime} from '@/components/mail-attachments/content';

async function loadInlineImages(template,message,current,signal,token) {
  const files=message.attList || [];
  for (const image of template.content.querySelectorAll('img')) {
    if (image.closest('[hidden]')) continue;
    const src=image.getAttribute('src') || '';
    const key=storedKey(src);
    const file=files.find(f=>(key && f.key===key) ||
      (message.scheduledDraftId && f.related && src==='/api/v1/drafts/attachments/'+f.related+'/content') ||
      (src.startsWith('cid:') && f.contentId?.replace(/^<|>$/g,'')===src.slice(4)));
    if (!file) continue;
    if (!current()) return;
    try {
      const blob=await attachmentBlob(file,signal,false,token);
      const type=await previewMime(blob);
      if (!/^image\/(png|jpeg|webp|gif|avif)$/i.test(type)) continue;
      image.src=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(new Error('Could not read the inline image.'));
        reader.readAsDataURL(blob.slice(0,blob.size,type));
      });
    } catch {
      image.removeAttribute('src');
      if (!image.alt) image.alt='[Inline image unavailable]';
    }
  }
}

export async function appendPrintedMessage(doc,message,owner,current,signal,token) {
  const article=doc.createElement('article'),header=doc.createElement('header');
  const sender=doc.createElement('strong');
  sender.textContent=headerAddressText({name:message.name,address:message.sendEmail}) || '';
  const time=doc.createElement('time');time.textContent=message.createTime ? formatDetailDate(message.createTime) : '';
  header.append(sender,time);
  for (const [label,value] of [['To',message.recipient],['Cc',message.cc],['Bcc',message.type===1 && owner!=null && message.userId===owner ? message.bcc : null]]) {
    const list=headerRecipients(value).map(headerAddressText);
    if (list.length) { const line=doc.createElement('div');line.textContent=label+': '+list.join(', ');header.append(line); }
  }
  if (message.type===0 && message.toEmail && !headerRecipients(message.recipient).length && !headerRecipients(message.cc).length) {
    const line=doc.createElement('div');line.textContent='Delivered to: '+message.toEmail;header.append(line);
  }
  article.append(header);
  if (message.content) {
    const template=doc.createElement('template');
    template.innerHTML=message.content;
    await loadInlineImages(template,message,current,signal,token);
    copyBody(template.content,article,doc);
  } else {
    const pre=doc.createElement('pre');pre.textContent=message.text || '';article.append(pre);
  }
  const files=(message.attList || []).filter(downloadablePart);
  if (files.length) {
    const footer=doc.createElement('footer');footer.textContent='Attachments: '+files.map(f=>f.filename).join(', ');article.append(footer);
  }
  doc.body.append(article);
}

export function printMessages({subject,rows,read,owner,current,signal,token}) {
  return printDocument(async doc=>{
    doc.title=subject || '(no subject)';
    const style=doc.createElement('style');
    style.textContent='article{border-top:1px solid #dadce0;padding:16px 0}article header{border:0;margin:0 0 16px;padding:0;font-size:13px;break-inside:avoid}article time{float:right}article footer{margin-top:16px}h1{font-size:20px}';
    doc.head.append(style);
    const title=doc.createElement('h1');title.textContent=doc.title;doc.body.append(title);
    for (let start=0;start<rows.length;start+=4) {
      if (!current()) return;
      const batch=read ? await Promise.all(rows.slice(start,start+4).map(read)) : rows.slice(start,start+4);
      for (const message of batch) {
        if (!current()) return;
        await appendPrintedMessage(doc,message,owner,current,signal,token);
      }
    }
  },current,signal);
}
