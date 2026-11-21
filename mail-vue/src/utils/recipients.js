import { isEmail } from './verify-utils.js';

export const recipientFields = ['receiveEmail', 'cc', 'bcc'];
export function splitRecipients(value = '') {
  const tokens = [];
  let token = '', quoted = false, escaped = false;
  function finish() {
    const text = token.trim();
    const named = text.match(/^[^<>]*<([^<>]+)>$/);
    if (text) tokens.push(named && isEmail(named[1].trim()) ? named[1].trim() : text);
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

export function recipientEntries(value) {
  try {
    const entries=typeof value==="string" ? JSON.parse(value || "[]") : value;
    if (!Array.isArray(entries)) return [];
    return entries.map(entry=>typeof entry==="string" ? {address:entry} : entry)
      .filter(entry=>typeof entry?.address==="string" && entry.address.trim());
  } catch { return []; }
}

export function normalizeRecipients(form, pending = {}) {
  const seen = new Set();
  const result = { errors: {} };
  for (const field of recipientFields) {
    const entered = [...addresses(form[field]), ...splitRecipients(pending[field])];
    const invalid = entered.filter(address => !isEmail(address.trim()));
    if (invalid.length) result.errors[field] = `Invalid email address: ${invalid.join(', ')}`;
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
  const to = addresses(message.recipient);
  const cc = addresses(message.cc);
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
    bcc: copyOnly && !cc.length ? unique(addresses(message.bcc)) : [],
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

export function draftFingerprint(draft) {
  return JSON.stringify([draft.subject, draft.content, ...recipientFields.map(field => draft[field] || []),
    (draft.attachments || []).map(file => [file.filename, file.content]), ...(draft.plainText ? [true] : []), ...draftFilingFingerprint(draft)]);
}

export function hasReplyAll(message, ownAddresses) {
  if (!message) return false;
  const own=new Set(ownAddresses.map(address=>address.toLowerCase()));
  const people=[message.sendEmail,...addresses(message.recipient),...addresses(message.cc)]
    .filter(Boolean).map(address=>address.trim().toLowerCase()).filter(address=>!own.has(address));
  return new Set(people).size>1;
}
