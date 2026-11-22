import {parseHTML} from 'linkedom/worker';
import {extractDraftImages} from '../../../../shared/draft-inline-images';
import {base64Bytes,fileContentBytes,storedMessageBytes} from "../../../../shared/mail-search-size";
import { MAX_MESSAGE_BYTES, messageSize } from "../../../../shared/message-size";

export const photoTypes = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/avif"];
export const hasFiles = transfer => Array.from(transfer?.types || []).includes("Files");

export function transferFiles(transfer) {
  if (Array.from(transfer.items || []).some(item => item.webkitGetAsEntry?.()?.isDirectory))
    throw new Error("Choose files inside the folder to attach them.");
  const files = Array.from(transfer.files || []);
  if (!files.length) throw new Error("Could not read these files. Choose them from your device.");
  return files;
}

// Clipboard applications sometimes include a bitmap preview of a rich-text selection.
export function hasRichSelection(transfer) {
  const html = transfer.getData("text/html");
  if (!html) return false;
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("style,script,title").forEach(node => node.remove());
  return Boolean(template.content.textContent.trim());
}

export function planFiles(files, mode, form, content) {
  const existing = form.attachments.filter(file => !file.contentId);
  const template = document.createElement("template");
  template.innerHTML = content;
  const embedded = [...template.content.querySelectorAll("img")].filter(image =>
    /^(?:data:image\/|cid:)/i.test(image.getAttribute("src") || ""));
  const photos = [], attachments = [];
  for (const file of files) {
    if (!file.size) throw new Error((file.name || "This file") + " is empty.");
    if (mode === "photos" && !photoTypes.includes(file.type))
      throw new Error("Choose a PNG, JPEG, GIF, WebP, HEIC or AVIF image.");
    if (mode !== "attachments" && !form.plainText && photoTypes.includes(file.type)) photos.push(file);
    else attachments.push(file);
  }
  if (photos.length && embedded.length + photos.length > 10)
    throw new Error("A message can contain up to 10 inline photos.");
  if (attachments.length && existing.length + attachments.length > 10)
    throw new Error("A message can have at most 10 attachments.");
  const filePart = file => ({
    filename: file.name || file.filename,
    type: file.type || file.contentType || file.mimeType || "application/octet-stream",
    size:fileContentBytes(file),
  });
  const parts = [...existing, ...attachments].map(filePart);
  const cid = "cid:" + "0".repeat(32);
  for (const image of embedded) {
    const src = image.getAttribute("src");
    if (src.startsWith("data:")) {
      const type = src.slice(5, src.indexOf(";"));
      parts.push({filename: "inline-image-" + Date.now() + "." + type.slice(6), type, size: base64Bytes(src)});
      image.setAttribute("src", cid);
    } else {
      const file = form.attachments.find(item => item.contentId === src.slice(4));
      if (file) parts.push(filePart(file));
    }
  }
  for (const photo of photos) {
    parts.push(filePart(photo));
    const image = document.createElement("img");
    image.src = cid;
    image.alt = photo.name;
    image.style.maxWidth = "100%";
    template.content.append(image);
  }
  const size = messageSize({
    html: form.plainText ? "" : template.innerHTML,
    text: form.text || template.content.textContent,
    from: {email: form.sendEmail, name: form.name},
    to: form.receiveEmail, cc: form.cc, bcc: form.bcc, subject: form.subject,
    attachments: parts,
  });
  if (size > MAX_MESSAGE_BYTES)
    throw new Error("These files would exceed the 5 MiB message limit, including encoding overhead.");
  return { photos, attachments };
}


// Serialize each distinct embedded image once, before the cloud request is
// built. Repeated signatures in a forwarded thread can share the same image.
export function cloudDraftParts(content, attachments) {
  return extractDraftImages(content,attachments,parseHTML,()=>crypto.randomUUID()) || {content,attachments};
}

// Cloud drafts store inline images as CID references and separate binary files.
export function draftSearchBytes(draft,files=draft.attachments || []) {
  const extracted=extractDraftImages(draft.content,files,parseHTML,()=>'0'.repeat(36));
  const fileBytes=(extracted?.attachments || files).reduce((sum,file)=>sum+fileContentBytes(file),0);
  return storedMessageBytes(extracted ? {...draft,content:extracted.content} : draft,fileBytes);
}

export function inlineImageSources(file) {
  if (!file.contentId) return [];
  const sources = ['cid:' + file.contentId.replace(/^<|>$/g, '')];
  if (file.attachmentId != null) sources.push('/api/v1/drafts/attachments/' + file.attachmentId + '/content');
  if (file.content && typeof file.content === 'string') {
    sources.push(file.content.startsWith('data:') ? file.content : 'data:' + (file.contentType || file.mimeType) + ';base64,' + file.content);
  }
  return sources;
}

export function referencedAttachments(row) {
  const files = row.attachments || [];
  if (!files.some(file => file.contentId)) return files;
  const template = document.createElement('template');
  template.innerHTML = row.content || '';
  const sources = new Set(Array.from(template.content.querySelectorAll('img[src]'), image => image.getAttribute('src')));
  return files.filter(file => !file.contentId || inlineImageSources(file).some(src => sources.has(src)));
}
