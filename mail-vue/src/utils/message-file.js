import { parseHTML } from "linkedom";
import { recipientEntries } from "./recipients";
import { tzDayjs } from "./day";
import { storedKey } from "./private-files";

const eol = "\r\n";
const utf8 = new TextEncoder();
const clean = (value) =>
  String(value ?? "")
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .trim();
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));

// Keep each encoded word under the 75-character RFC 2047 limit, including its wrapper.
function encodedWords(value) {
  const words = [];
  let chunk = [];
  for (const character of clean(value)) {
    const bytes = utf8.encode(character);
    if (chunk.length + bytes.length > 45) {
      words.push(base64(chunk));
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length) words.push(base64(chunk));
  return words.map((word) => "=?UTF-8?B?" + word + "?=").join(eol + " ");
}

function mailbox({ address, name }) {
  const addr = clean(address);
  if (!addr || /[<>]/.test(addr)) return "";
  return name && name !== address
    ? encodedWords(name) + " <" + addr + ">"
    : addr;
}

function filenameParams(value) {
  // RFC 2231 continuation segments keep long and non-ASCII filenames on folded lines.
  const bytes = utf8.encode(clean(value) || "attachment");
  const params = [];
  for (let i = 0; i < bytes.length; i += 18) {
    const encoded = Array.from(
      bytes.subarray(i, i + 18),
      (b) => "%" + b.toString(16).padStart(2, "0"),
    ).join("");
    params.push(
      "filename" +
        (bytes.length > 18 ? "*" + params.length : "") +
        "*=" +
        (i ? "" : "UTF-8''") +
        encoded,
    );
  }
  return params.join(";" + eol + " ");
}

async function base64Body(blob, signal) {
  const parts = [];
  // 57 bytes encode to one 76-character MIME line. Chunk boundaries never introduce padding.
  const stride = 57 * 256;
  for (let i = 0; i < blob.size; i += stride) {
    signal.throwIfAborted();
    const data = new Uint8Array(await blob.slice(i, i + stride).arrayBuffer());
    parts.push(
      base64(data)
        .match(/.{1,76}/g)
        .join(eol) + eol,
    );
  }
  return new Blob(parts);
}

function multipart(type, children) {
  if (children.length === 1) return children[0];
  const boundary = "=_cloudmail_" + crypto.randomUUID();
  const parts = [
    "Content-Type: multipart/" +
      type +
      '; boundary="' +
      boundary +
      '"' +
      eol +
      eol,
  ];
  for (const child of children) parts.push("--" + boundary + eol, child, eol);
  parts.push("--" + boundary + "--" + eol);
  return new Blob(parts);
}

async function textPart(type, text, signal) {
  return new Blob([
    "Content-Type: text/" + type + "; charset=UTF-8" + eol,
    "Content-Transfer-Encoding: base64" + eol + eol,
    await base64Body(new Blob([text.replace(/\r\n|\r|\n/g, eol)]), signal),
  ]);
}

function inlineHTML(html, files) {
  if (!html || !files.length) return html;
  const { document } = parseHTML(html);
  let changed = false;
  for (const image of document.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src");
    const key = storedKey(src);
    const file = files.find(
      (f) =>
        (key && key === f.file.key) ||
        (f.file.related &&
          src === "/api/v1/drafts/attachments/" + f.file.related + "/content"),
    );
    if (file) {
      image.setAttribute("src", "cid:" + file.id);
      changed = true;
    }
  }
  return changed ? document.toString() : html;
}

export function messageFilename(subject) {
  const safe = clean(subject)
    .replace(/[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/^\.+|[. ]+$/g, "");
  let filename = "";
  for (const character of safe) {
    if (utf8.encode(filename + character).length > 230) break;
    filename += character;
  }
  return (filename || "(no subject)") + ".eml";
}

export async function messageFile(message, owner, readFile, signal) {
  const headers = [
    "MIME-Version: 1.0",
    "Subject: " + encodedWords(message.subject),
  ];
  const sender = mailbox({ address: message.sendEmail, name: message.name });
  if (sender) headers.push("From: " + sender);
  for (const [header, value] of [
    ["To", message.recipient],
    ["Cc", message.cc],
    [
      "Bcc",
      message.type === 1 && owner != null && message.userId === owner
        ? message.bcc
        : null,
    ],
  ]) {
    const addresses = recipientEntries(value).map(mailbox).filter(Boolean);
    if (addresses.length)
      headers.push(header + ": " + addresses.join("," + eol + " "));
  }
  if (message.type === 0 && message.toEmail)
    headers.push("Delivered-To: " + clean(message.toEmail));
  const date = tzDayjs(message.createTime);
  if (message.createTime && date.isValid())
    headers.push(
      "Date: " + date.toDate().toUTCString().replace("GMT", "+0000"),
    );
  for (const [header, value] of [
    ["Message-ID", message.messageId],
    ["In-Reply-To", message.inReplyTo],
    ["References", message.relation],
  ]) {
    const ids = clean(value).match(/<[^<>\s]+>/g);
    if (ids?.length) headers.push(header + ": " + ids.join(eol + " "));
  }

  const inline = [],
    attached = [],
    images = [];
  for (const file of message.attList || []) {
    signal.throwIfAborted();
    const data = await readFile(file, signal);
    const mime = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(file.mimeType)
      ? file.mimeType
      : "application/octet-stream";
    const inlinePart =
      Number(file.type) === 1 ||
      file.disposition?.toLowerCase() === "inline" ||
      (file.contentId && file.disposition?.toLowerCase() !== "attachment");
    const originalId = clean(file.contentId).replace(/^<|>$/g, "");
    const id =
      originalId && !/[<>\s]/.test(originalId)
        ? originalId
        : inlinePart
          ? crypto.randomUUID() + "@cloudmail"
          : "";
    // Encapsulated mail must remain readable as a message, including its own headers (RFC 2046).
    const nestedMessage = /^message\/(rfc822|global)$/i.test(mime);
    const fields = [
      "Content-Type: " + mime,
      "Content-Transfer-Encoding: " + (nestedMessage ? "binary" : "base64"),
      "Content-Disposition: " +
        (inlinePart ? "inline" : "attachment") +
        ";" +
        eol +
        " " +
        filenameParams(file.filename),
    ];
    if (id) {
      fields.push("Content-ID: <" + id + ">");
      images.push({ file, id });
    }
    (inlinePart ? inline : attached).push(
      new Blob([
        fields.join(eol) + eol + eol,
        nestedMessage ? data : await base64Body(data, signal),
      ]),
    );
  }
  const alternatives = [];
  if (message.text || !message.content)
    alternatives.push(await textPart("plain", message.text || "", signal));
  if (message.content)
    alternatives.push(
      multipart("related", [
        await textPart("html", inlineHTML(message.content, images), signal),
        ...inline,
      ]),
    );
  signal.throwIfAborted();
  return new Blob(
    [
      headers.join(eol) + eol,
      multipart("mixed", [
        multipart("alternative", alternatives),
        ...(!message.content ? inline : []),
        ...attached,
      ]),
    ],
    { type: "message/rfc822" },
  );
}
