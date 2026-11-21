import {attachmentBlob} from "@/components/mail-attachments/content";
import {downloadablePart, inlineImageURL, storedKey} from "@/utils/private-files";
import {headerAddressText, headerRecipients} from "@/utils/recipients";
import {formatDetailDate} from "@/utils/day";

const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

export async function quotedMessage(message, mode, signal, token) {
  const template = document.createElement("template");
  template.innerHTML = message.content || "";
  const files = message.attList || [], contents = new Map();
  async function fileData(file) {
    signal.throwIfAborted();
    if (!contents.has(file)) {
      const blob = await attachmentBlob(file, signal, false, token);
      contents.set(file, await inlineImageURL(blob));
    }
    return contents.get(file);
  }
  for (const image of template.content.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src"), key = storedKey(src);
    const file = files.find(f => key && key === f.key || src.startsWith("cid:") && src.slice(4) === f.contentId?.replace(/^<|>$/g,""));
    if (file) image.src = await fileData(file);
    else if (key || src.startsWith("cid:")) throw new Error("An inline image is unavailable. Reopen the original message and try again.");
  }
  const body = template.innerHTML || '<pre style="font-family:inherit;white-space:pre-wrap">' + escape(message.text) + '</pre>';
  const sender = headerAddressText({address:message.sendEmail, name:message.name});
  const date = message.createTime ? formatDetailDate(message.createTime) : "";
  const attachments = [];
  let quote;
  if (mode === "forward") {
    for (const file of files.filter(downloadablePart)) {
      attachments.push({filename:file.filename || "Attachment", contentType:file.mimeType || "application/octet-stream", content:await fileData(file)});
    }
    const headers = [["From",sender], ["Date",date], ["Subject",message.subject],
      ["To",headerRecipients(message.recipient).map(headerAddressText).join(", ")],
      ["Cc",headerRecipients(message.cc).map(headerAddressText).join(", ")]];
    quote = '<div>---------- Forwarded message ---------<br>' +
      headers.filter(([,value])=>value).map(([label,value])=>label + ": " + escape(value)).join("<br>") + "</div><br>" + body;
  } else {
    quote = "<div>" + escape(date) + " " + escape(sender) + ' wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">' + body + "</blockquote>";
  }
  return {attachments, content:'<div><br></div><div class="cloudmail-reply-quote">' + quote + '</div>'};
}
