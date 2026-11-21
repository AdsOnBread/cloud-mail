import {plainMarkup} from "./plain-text";

export function responseSubject(subject,mode) {
  subject=subject || "";
  const reply=mode==="reply";
  return (reply ? /^re:/i : /^fwd:/i).test(subject) ? subject : (reply ? "Re: " : "Fwd: ")+subject;
}

export function changeQuotedBody(html,generated,plainText) {
  const previous=document.createElement("template"), next=document.createElement("template");
  previous.innerHTML=html;
  next.innerHTML=plainText ? plainMarkup(generated).content : generated;
  const quote=next.content.querySelector(".cloudmail-reply-quote");
  const old=Array.from(previous.content.children).find(el=>el.classList.contains("cloudmail-reply-quote"));
  if (old) old.replaceWith(quote);
  else previous.content.append(quote);
  return previous.innerHTML;
}

// Cloud attachment IDs change on upload. A multiset of file signatures lets a
// downloaded forward distinguish its inherited attachments from user additions.
async function fileSignature(file) {
  const bytes=new TextEncoder().encode(String(file.content || "").split(",").at(-1));
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  const hex=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
  return JSON.stringify([file.filename,hex]);
}
export async function responseFileSignatures(files) {
  return Promise.all(files.filter(file=>file.fromResponse).map(fileSignature));
}
export async function restoreResponseFiles(files,signatures) {
  if (!Array.isArray(signatures) || !signatures.length) return;
  const remaining=[...signatures];
  for (const file of files) {
    if (file.contentId) continue;
    const index=remaining.indexOf(await fileSignature(file));
    if (index<0) continue;
    file.fromResponse=true;
    remaining.splice(index,1);
    if (!remaining.length) break;
  }
}
