import { MAX_MESSAGE_BYTES, messageSize } from "../../../../shared/message-size";
import { parseHTML } from "linkedom/worker";
import { extractDraftImages } from "../../../../shared/draft-inline-images";
import { fileContentBytes } from "../../../../shared/mail-search-size";
import { attachmentBlob } from "@/components/mail-attachments/content";
import {
  downloadablePart,
  inlineImageURL,
  storedKey,
} from "@/utils/private-files";
import { headerAddressText, headerRecipients } from "@/utils/recipients";
import { formatDetailDate } from "@/utils/day";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

async function quotePart(message, mode, signal, token) {
  const template = document.createElement("template");
  template.innerHTML = message.content || "";
  const files = message.attList || [],
    contents = new Map();
  async function fileData(file) {
    signal.throwIfAborted();
    if (!contents.has(file)) {
      if (mode === "conversation" && file.size > MAX_MESSAGE_BYTES)
        throw new Error("This conversation exceeds the 5 MiB message limit.");
      const blob = await attachmentBlob(file, signal, false, token);
      signal.throwIfAborted();
      if (mode === "conversation" && blob.size > MAX_MESSAGE_BYTES)
        throw new Error("This conversation exceeds the 5 MiB message limit.");
      const type = file.mimeType || blob.type || "application/octet-stream";
      contents.set(file, {
        content: await inlineImageURL(blob.slice(0, blob.size, type)),
        size: blob.size,
        contentType: type,
      });
    }
    return contents.get(file);
  }
  for (const image of template.content.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src"),
      key = storedKey(src);
    const file = files.find(
      (f) =>
        (key && key === f.key) ||
        (src.startsWith("cid:") &&
          src.slice(4) === f.contentId?.replace(/^<|>$/g, "")),
    );
    if (!file && !key && !src.startsWith("cid:")) continue;
    if (file) {
      try {
        image.src = (await fileData(file)).content;
        continue;
      } catch (error) {
        if (mode === "conversation") throw error;
        signal.throwIfAborted();
      }
    }
    image.replaceWith(
      document.createTextNode(image.alt || "[Inline image unavailable]"),
    );
  }
  const body =
    template.innerHTML ||
    '<pre style="font-family:inherit;white-space:pre-wrap">' +
      escape(message.text) +
      "</pre>";
  const sender = headerAddressText({
    address: message.sendEmail,
    name: message.name,
  });
  const date = message.createTime ? formatDetailDate(message.createTime) : "";
  const attachments = [];
  let quote;
  if (mode !== "reply") {
    for (const file of files.filter(downloadablePart)) {
      attachments.push({
        filename: file.filename || "Attachment",
        ...(await fileData(file)),
      });
    }
    const headers = [
      ["From", sender],
      ["Date", date],
      ["Subject", mode === "forward" && message.subject],
      [
        "To",
        headerRecipients(message.recipient).map(headerAddressText).join(", "),
      ],
      ["Cc", headerRecipients(message.cc).map(headerAddressText).join(", ")],
    ];
    quote =
      (mode === "forward" ? "<div>---------- Forwarded message ---------<br>" : "<div>") +
      headers
        .filter(([, value]) => value)
        .map(([label, value]) => label + ": " + escape(value))
        .join("<br>") +
      "</div><br>" +
      body;
  } else {
    quote =
      "<div>" +
      escape(date) +
      " " +
      escape(sender) +
      ' wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">' +
      body +
      "</blockquote>";
  }
  return {attachments, quote};
}

export async function quotedMessage(message, mode, signal, token) {
  const {attachments, quote} = await quotePart(message, mode, signal, token);
  return {attachments, content:'<div><br></div><div class="cloudmail-reply-quote">'+quote+'</div>'};
}

// Read one original at a time so a paginated thread does not hold every full
// message and its downloaded files in memory alongside the composed draft.
export async function quotedConversation(subject, messages, signal, token) {
  const attachments = [], sections = [], wireSections = [];
  let inlineFiles = [], fileBytes = 0, markupBytes = 0;
  const tooLarge = () => new Error("This conversation exceeds the 5 MiB message limit.");
  for await (const message of messages) {
    signal.throwIfAborted();
    const files = (message.attList || []).filter(downloadablePart);
    if (attachments.length + files.length > 10)
      throw new Error("This conversation exceeds the limit of 10 file attachments.");
    if (markupBytes + fileBytes + files.reduce((sum,file)=>sum+(Number(file.size)||0),0) > MAX_MESSAGE_BYTES)
      throw tooLarge();
    const part = await quotePart(message, "conversation", signal, token);
    signal.throwIfAborted();
    // The cloud draft represents repeated inline photos using one CID, even
    // when each source email gave the same image a different identifier.
    const extracted = extractDraftImages(part.quote,inlineFiles,parseHTML,()=>crypto.randomUUID(),
      ()=>new Error("This conversation contains an unsupported inline image."));
    inlineFiles = extracted?.attachments || inlineFiles;
    if (inlineFiles.length > 10) throw new Error("This conversation exceeds the limit of 10 inline photos.");
    const wire = extracted?.content || part.quote;
    markupBytes += new TextEncoder().encode(wire).byteLength;
    fileBytes += part.attachments.reduce((sum,file)=>sum+file.size,0);
    if (markupBytes + fileBytes + inlineFiles.reduce((sum,file)=>sum+fileContentBytes(file),0) > MAX_MESSAGE_BYTES)
      throw tooLarge();
    sections.push(part.quote);
    wireSections.push(wire);
    attachments.push(...part.attachments);
  }
  signal.throwIfAborted();
  const heading = "<div>Forwarded Conversation<br>Subject: "+escape(subject)+"<br>------------------------</div><br>";
  const wrap = parts => '<div><br></div><div class="cloudmail-reply-quote cloudmail-forwarded-conversation">'+
    heading + parts.join("<br><br><div>----------</div>") + "</div>";
  const html = wrap(wireSections), template = document.createElement("template");
  template.innerHTML = html;
  const parts = [...attachments,...inlineFiles].map(file=>({filename:file.filename,size:fileContentBytes(file),type:file.contentType}));
  if (messageSize({html,text:template.content.textContent,subject,attachments:parts}) > MAX_MESSAGE_BYTES) throw tooLarge();
  return {attachments,content:wrap(sections)};
}
