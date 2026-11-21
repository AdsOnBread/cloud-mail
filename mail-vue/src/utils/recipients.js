import {storedRecipients, mailboxEntries} from '../../../shared/stored-recipients';
import {cleanRecipientName,recipientName} from '../../../shared/recipient-names';
import { isEmail } from './verify-utils.js';

export const recipientFields = ['receiveEmail', 'cc', 'bcc'];
export function formatRecipient(address,name) {
  const text=cleanRecipientName(name);
  if (!isEmail(address) || !text || text.toLowerCase()===address.toLowerCase()) return address;
  const phrase=/[()<>@,，;:."\\[\]]/u.test(text) ? '"'+text.replace(/["\\]/g,'\\$&')+'"' : text;
  return phrase+' <'+address+'>';
}
export function splitRecipients(value='') { return parseRecipientList(value).map(person=>person.address); }
export function parseRecipientList(value = '') {
  const tokens = [];
  let token = '', quoted = false, escaped = false;
  function finish() {
    const text = token.trim();
    const named = text.match(/^((?:[^"<>]|"(?:[^"\\]|\\.)*")*)<([^<>]+)>$/u);
    // Discard only a valid display name. A copied Bcc header must still fail recipient validation.
    const phrase=named?.[1].trim() || '';
    const unquoted=phrase.replace(/"(?:[^"\\]|\\.)*"/g,'');
    const address=named?.[2].trim();
    if (named && !/[":@;,，()\[\]\\]/.test(unquoted) && isEmail(address)) {
      const name=phrase.replace(/"((?:[^"\\]|\\.)*)"/g,(_,part)=>part.replace(/\\(.)/gu,'$1'));
      tokens.push({address,name:cleanRecipientName(name)});
    } else if (text) tokens.push({address:text,name:''});
    token = '';
  }
  for (const character of String(value)) {
    if (!quoted && /[,，;\r\n]/.test(character)) { finish(); continue; }
    token += character;
    if (escaped) escaped = false;
    else if (quoted && character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
  }
  finish();
  return tokens;
}

export function addresses(value) {
  return recipientEntries(value).map(entry=>entry.address);
}

// Incoming address lists can include RFC 5322 groups as well as individual mailboxes.
export {storedRecipients};
export function recipientEntries(value) {
  return storedRecipients(value).filter(entry=>typeof entry?.address==="string" && entry.address.trim());
}

export function headerRecipients(value) {
  return storedRecipients(value).filter(entry =>
    typeof entry?.address === "string" && entry.address.trim() ||
    typeof entry?.name === "string" && entry.name.trim() && Array.isArray(entry.group)
  );
}

export function headerAddressText(entry) {
  if (Array.isArray(entry.group)) {
    const members = recipientEntries(entry.group).map(headerAddressText);
    return entry.name + ":" + (members.length ? " " + members.join(", ") : "") + ";";
  }
  const {name, address} = entry;
  return name && address && name !== address ? name + " <" + address + ">" : address || name || "";
}

export function normalizeRecipients(form, pending = {}) {
  const seen = new Set();
  const result = { errors: {} };
  for (const field of recipientFields) {
    const entered = [...addresses(form[field]), ...splitRecipients(pending[field])];
    const invalid = entered.filter(address => !isEmail(address.trim()));
    if (invalid.length) {
      result.errors[field] = `Invalid email address: ${invalid.join(', ')}`;
      result.firstInvalid ??= {field,address:invalid[0]};
    }
    result[field] = entered.map(address => address.trim().toLowerCase()).filter(address => {
      if (seen.has(address)) return false;
      seen.add(address);
      return true;
    });
  }
  if (seen.size > 50) result.errors.receiveEmail = 'A message can have at most 50 recipients across To, Cc, and Bcc.';
  return result;
}

export function replyRecipients(message, ownAddresses, all = false) {
  const sent = message.type === 1;
  const to = mailboxEntries(message.recipient).map(person => person.address);
  const cc = mailboxEntries(message.cc).map(person => person.address);
  const copyOnly = sent && !to.length;
  const targets = sent ? to : [message.sendEmail, ...(all ? to : [])].filter(Boolean);
  const seen = new Set(all ? ownAddresses.map(address => address.toLowerCase()) : []);
  const unique = list => list.filter(address => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    receiveEmail: unique(targets),
    cc: all || copyOnly ? unique(cc) : [],
    bcc: copyOnly && !cc.length ? unique(mailboxEntries(message.bcc).map(person => person.address)) : [],
  };
}

export function restoreDraft(draft = {}) {
  return { ...draft, receiveEmail: addresses(draft.receiveEmail), cc: addresses(draft.cc),
    bcc: addresses(draft.bcc), attachments: (draft.attachments || []).map(file => ({ ...file })) };
}

export function hasDraftContent(draft) {
  return !!(draft.labelIds?.length || draft.mailboxStarred || draft.subject || draft.content || draft.attachments?.some(file => !file.contentId) ||
    recipientFields.some(field => draft[field]?.length));
}

export function draftEditBase(row) {
  return row.starEditBase || row.editToken || JSON.stringify([row.cloudVersion ?? null,row.localRevision ?? null]);
}

// Omit empty filing choices so fingerprints from older versions still compare equal.
export function draftFilingFingerprint(draft) {
  return [
    ...(draft.labelIds?.length ? [{labels:[...draft.labelIds].sort((a,b)=>a-b)}] : []),
    ...(draft.mailboxStarred ? [{starred:true}] : []),
  ];
}

export function draftRecipientNames(draft) {
  const names=[];
  for (const field of recipientFields) for (const address of addresses(draft[field])) {
    const name=recipientName(draft.replyRecipientNames,address);
    if (name) names.push([address.toLowerCase(),name]);
  }
  return names;
}
export function draftFingerprint(draft) {
  return JSON.stringify([draft.subject, draft.content, ...recipientFields.map(field => draft[field] || []),
    (draft.attachments || []).map(file => [file.filename, file.content]), ...(draft.plainText ? [true] : []), ...draftFilingFingerprint(draft), ...draftRecipientNames(draft)]);
}

export function hasReplyAll(message, ownAddresses) {
  if (!message) return false;
  const own=new Set(ownAddresses.map(address=>address.toLowerCase()));
  const people=[message.sendEmail,...[...mailboxEntries(message.recipient), ...mailboxEntries(message.cc)].map(person => person.address)]
    .filter(Boolean).map(address=>address.trim().toLowerCase()).filter(address=>!own.has(address));
  return new Set(people).size>1;
}
