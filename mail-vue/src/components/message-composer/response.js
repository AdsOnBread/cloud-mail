import {plainMarkup} from "./plain-text";

export function responseSubject(subject,mode) {
  subject=subject || "";
  const reply=mode==="reply";
  return (reply ? /^re:/i : /^fwd:/i).test(subject) ? subject : (reply ? "Re: " : "Fwd: ")+subject;
}

// Switching response type changes the generated attribution. Keep the body
// already in the draft, including edits to the quoted message and its images.
function plainHeaderLength(lines) {
  const first=lines[0]?.textContent || "";
  if (first.endsWith(" wrote:")) return 1;
  if (!first.startsWith("---------- Forwarded message")) return 0;
  let end=1;
  while (end<lines.length && /^(From|Date|Subject|To|Cc):/.test(lines[end].textContent)) end++;
  return end;
}
export function changeQuotedBody(html,generated,plainText,mode) {
  const previous=document.createElement("template"), next=document.createElement("template");
  previous.innerHTML=html;
  const old=Array.from(previous.content.children).find(el=>el.classList.contains("cloudmail-reply-quote"));
  if (!old) return html;
  next.innerHTML=plainText ? plainMarkup(generated).content : generated;
  const quote=next.content.querySelector(".cloudmail-reply-quote");
  if (!quote) return html;
  if (old.classList.contains("cloudmail-forwarded-conversation")) {
    old.replaceWith(quote);
    return previous.innerHTML;
  }
  if (plainText) {
    const original=Array.from(old.childNodes), updated=Array.from(quote.childNodes);
    const heading=updated.slice(0,plainHeaderLength(updated));
    const body=original.slice(plainHeaderLength(original));
    // The forwarded header is followed by a generated blank separator. A
    // reply instead prefixes every body line with a single quote marker.
    if (mode==="reply" && body.length && !body[0].textContent.trim()) body.shift();
    if (mode==="forward") {
      const separator=document.createElement("div");
      separator.append(document.createElement("br"));
      heading.push(separator);
    }
    const lines=body.map(node=>{
      const line=document.createElement("div"), text=node.textContent;
      line.textContent=mode==="reply" ? "> "+text : text.replace(/^> ?/,"");
      if (!line.textContent) line.append(document.createElement("br"));
      return line;
    });
    quote.replaceChildren(...heading,...lines);
  } else if (mode==="forward") {
    const attribution=old.firstElementChild;
    if (attribution?.textContent.trimEnd().endsWith(" wrote:")) attribution.remove();
    const body=Array.from(old.children).find(el=>el.tagName==="BLOCKQUOTE");
    if (body) body.replaceWith(...body.childNodes);
    const header=quote.firstElementChild;
    quote.replaceChildren(header,document.createElement("br"),...old.childNodes);
  } else {
    const header=old.firstElementChild;
    if (header?.textContent.startsWith("---------- Forwarded message")) {
      if (header.nextSibling?.nodeName==="BR") header.nextSibling.remove();
      header.remove();
    }
    quote.querySelector("blockquote").replaceChildren(...old.childNodes);
  }
  old.replaceWith(quote);
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
