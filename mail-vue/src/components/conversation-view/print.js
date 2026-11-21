import {copyBody,printDocument} from '@/utils/print-document';
import {downloadablePart,storedKey} from '@/utils/private-files';
import {recipientEntries} from '@/utils/recipients';
import {formatDetailDate} from '@/utils/day';
import {attachmentBlob,previewMime} from '@/components/mail-attachments/content';

function address({name,address}) {
  return name && name!==address ? name+' <'+address+'>' : address;
}
async function loadInlineImages(template,message,current) {
  const files=message.attList || [];
  for (const image of template.content.querySelectorAll('img')) {
    const src=image.getAttribute('src') || '';
    const key=storedKey(src);
    const file=files.find(f=>(key && f.key===key) || (src.startsWith('cid:') && f.contentId?.replace(/^<|>$/g,'')===src.slice(4)));
    if (!file) continue;
    if (!current()) return;
    const blob=await attachmentBlob(file);
    const type=await previewMime(blob);
    if (!/^image\/(png|jpeg|webp|gif|avif)$/i.test(type)) continue;
    image.src=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(new Error('Could not read the inline image.'));
      reader.readAsDataURL(blob.slice(0,blob.size,type));
    });
  }
}

export async function appendPrintedMessage(doc,message,owner,current) {
  const article=doc.createElement('article'),header=doc.createElement('header');
  const sender=doc.createElement('strong');
  sender.textContent=address({name:message.name,address:message.sendEmail}) || '';
  const time=doc.createElement('time');time.textContent=message.createTime ? formatDetailDate(message.createTime) : '';
  header.append(sender,time);
  for (const [label,value] of [['To',message.recipient],['Cc',message.cc],['Bcc',message.type===1 && owner!=null && message.userId===owner ? message.bcc : null]]) {
    const list=recipientEntries(value).map(address);
    if (!list.length && label==='To' && message.toEmail && message.type===0) list.push(message.toEmail);
    if (list.length) { const line=doc.createElement('div');line.textContent=label+': '+list.join(', ');header.append(line); }
  }
  article.append(header);
  if (message.content) {
    const template=doc.createElement('template');
    template.innerHTML=message.content;
    await loadInlineImages(template,message,current);
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

export function printMessages({subject,rows,read,owner,current}) {
  return printDocument(async doc=>{
    doc.title=subject || '(no subject)';
    const style=doc.createElement('style');
    style.textContent='article{border-top:1px solid #dadce0;padding:16px 0}article header{border:0;margin:0 0 16px;padding:0;font-size:13px;break-inside:avoid}article time{float:right}article footer{margin-top:16px}h1{font-size:20px}';
    doc.head.append(style);
    const title=doc.createElement('h1');title.textContent=doc.title;doc.body.append(title);
    for (const row of rows) {
      if (!current()) return;
      const message=await read(row);
      if (!current()) return;
      await appendPrintedMessage(doc,message,owner,current);
    }
  },current);
}
