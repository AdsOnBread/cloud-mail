import { isEmail } from './verify-utils.js';

export const recipientFields = ['receiveEmail', 'cc', 'bcc'];
export function splitRecipients(value = '') {
  return String(value).split(/[,，;\n\r]+/).map(address => address.trim()).filter(Boolean);
}

export function addresses(value) {
  try {
    const list = typeof value === 'string' ? JSON.parse(value || '[]') : value;
    return Array.isArray(list) ? list.map(item => typeof item === 'string' ? item : item?.address).filter(Boolean) : [];
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

export function replyAllRecipients(message, ownAddresses) {
  const seen = new Set(ownAddresses.map(address => address.toLowerCase()));
  const unique = list => list.filter(address => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    receiveEmail: unique([message.sendEmail, ...addresses(message.recipient)].filter(Boolean)),
    cc: unique(addresses(message.cc)),
    bcc: [],
  };
}

export function restoreDraft(draft = {}) {
  return { ...draft, receiveEmail: addresses(draft.receiveEmail), cc: addresses(draft.cc),
    bcc: addresses(draft.bcc), attachments: (draft.attachments || []).map(file => ({ ...file })) };
}

export function hasDraftContent(draft) {
  return !!(draft.subject || draft.content || draft.attachments?.length ||
    recipientFields.some(field => draft[field]?.length));
}

export function draftFingerprint(draft) {
  return JSON.stringify([draft.subject, draft.content, ...recipientFields.map(field => draft[field] || []),
    (draft.attachments || []).map(file => [file.filename, file.content])]);
}
