import http from "@/axios";
import {privateFile} from "@/utils/private-files";

export function attachmentBlob(file,signal,textSample=false,token) {
  if (!file.attachmentId && !file.attId && file.key) return privateFile(file.key,signal,token);
  const path=file.attachmentId ? "/v1/drafts/attachments/"+encodeURIComponent(file.attachmentId)
    : "/v1/attachments/"+encodeURIComponent(file.attId);
  return http.get(path+"/content",{params:textSample ? {preview:"text"} : undefined,responseType:"blob",signal,noMsg:true,headers:token ? {Authorization:token} : undefined});
}
export function saveAttachment(blob,filename) {
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;
  link.download=filename || "attachment";
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function previewKind(mime="",name="") {
  if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(mime)) return "image";
  if (mime==="application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mime.startsWith("text/") || ["application/json","application/xml"].includes(mime) || /\.(txt|csv|md|log)$/i.test(name)) return "text";
  return "other";
}
export async function previewMime(blob) {
  const mime=blob.type.split(";")[0].toLowerCase();
  if (mime && mime!=="application/octet-stream") return mime;
  const bytes=new Uint8Array(await blob.slice(0,12).arrayBuffer());
  const prefix=String.fromCharCode(...bytes);
  if (bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return "image/jpeg";
  if (prefix.startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (/^GIF8[79]a/.test(prefix)) return "image/gif";
  if (prefix.startsWith("RIFF") && prefix.slice(8)==="WEBP") return "image/webp";
  return mime;
}
