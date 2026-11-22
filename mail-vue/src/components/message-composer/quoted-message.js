import { MAX_MESSAGE_BYTES } from "../../../../shared/message-size";
import { planFiles } from "./files";
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
      const blob = await attachmentBlob(file, signal, false, token);
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
      } catch {
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
  const attachments = [], sections = [];
  let fileBytes = 0, markupLength = 0;
  for await (const message of messages) {
    signal.throwIfAborted();
    const files = (message.attList || []).filter(downloadablePart);
    if (attachments.length + files.length > 10)
      throw new Error("This conversation exceeds the limit of 10 file attachments.");
    if (markupLength + fileBytes + files.reduce((sum,file)=>sum+(Number(file.size)||0),0) > MAX_MESSAGE_BYTES)
      throw new Error("This conversation exceeds the 5 MiB message limit.");
    const part = await quotePart(message, "conversation", signal, token);
    signal.throwIfAborted();
    sections.push(part.quote);
    attachments.push(...part.attachments);
    // Data URLs inflate inline photos in the editor. Count decoded bytes for
    // those images in the final MIME calculation instead of their URL length.
    markupLength += part.quote.replace(/src="data:[^"]*"/gi,'src="cid:image"').length;
    fileBytes += part.attachments.reduce((sum,file)=>sum+file.size,0);
    if (markupLength + fileBytes > MAX_MESSAGE_BYTES)
      throw new Error("This conversation exceeds the 5 MiB message limit.");
  }
  const heading = "<div>Forwarded Conversation<br>Subject: "+escape(subject)+"<br>------------------------</div><br>";
  const content = '<div><br></div><div class="cloudmail-reply-quote cloudmail-forwarded-conversation">'+
    heading + sections.join("<br><br><div>----------</div>") + "</div>";
  planFiles([], "attachments", {attachments,subject}, content);
  return {attachments,content};
}
