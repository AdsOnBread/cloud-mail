import { describe, it, expect } from 'vitest';
import { normalizeRecipients, replyAllRecipients, restoreDraft, hasDraftContent, draftFingerprint, splitRecipients, addresses } from '../src/utils/recipients.js';
import { createRequestGuard } from '../src/utils/request-guard.js';

describe('recipient and draft behavior', () => {
  it('commits pending addresses and accepts comma, semicolon, newline and pasted full-width commas', () => {
    expect(splitRecipients(' a@example.com;b@example.com\nc@example.com，d@example.com, ')).toHaveLength(4);
    expect(normalizeRecipients({ receiveEmail:['a@example.com'], cc:[], bcc:[] }, { bcc:'private@example.com' }).bcc).toEqual(['private@example.com']);
  });
  it('deduplicates across fields case-insensitively with To/Cc/Bcc precedence', () => {
    expect(normalizeRecipients({ receiveEmail:['A@example.com'], cc:['a@example.com','B@example.com'], bcc:['b@example.com','c@example.com'] })).toEqual({ receiveEmail:['a@example.com'], cc:['b@example.com'], bcc:['c@example.com'], errors:{} });
  });
  it('reports invalid input in its field and enforces the combined recipient limit', () => {
    expect(normalizeRecipients({ receiveEmail:['ok@example.com'], cc:['broken'], bcc:[] }).errors.cc).toContain('broken');
    const result = normalizeRecipients({ receiveEmail:['ok@example.com'], cc:Array.from({length:50}, (_,i) => `p${i}@example.com`) });
    expect(result.errors.receiveEmail).toContain('50 recipients');
  });
  it('restores old drafts, handles malformed metadata and preserves Cc/Bcc-only drafts', () => {
    expect(restoreDraft({ subject:'Old' })).toMatchObject({ receiveEmail:[], cc:[], bcc:[], attachments:[] });
    expect(addresses('{invalid')).toEqual([]);
    expect(hasDraftContent(restoreDraft({cc:['copy@example.com']}))).toBe(true);
    expect(hasDraftContent(restoreDraft({bcc:['blind@example.com']}))).toBe(true);
    expect(hasDraftContent(restoreDraft({attachments:[{filename:'a.txt'}]}))).toBe(true);
    expect(hasDraftContent(restoreDraft())).toBe(false);
  });
  it('copies recipient arrays and attachments and notices Cc/Bcc edits in replies', () => {
    const form = restoreDraft({cc:['one@example.com'], bcc:['private@example.com'],attachments:[{filename:'a'}]});
    const saved = restoreDraft(form);
    const before = draftFingerprint(form);
    form.cc.push('two@example.com'); form.bcc.splice(0); form.attachments[0].filename='changed';
    expect(saved.cc).toEqual(['one@example.com']); expect(saved.bcc).toEqual(['private@example.com']);
    expect(saved.attachments[0].filename).toBe('a'); expect(draftFingerprint(form)).not.toBe(before);
  });
  it('replies to sender and original To/Cc while excluding all owned aliases and Bcc', () => {
    const message = { sendEmail:'Sender@example.com', recipient:JSON.stringify([{address:'ME@example.com'},{address:'other@example.com'},{address:'alias@example.com'}]), cc:JSON.stringify([{address:'Other@example.com'},{address:'copy@example.com'},{address:'Alias@example.com'}]), bcc:'[{"address":"private@example.com"}]' };
    expect(replyAllRecipients(message,['me@example.com','alias@example.com'])).toEqual({receiveEmail:['Sender@example.com','other@example.com'],cc:['copy@example.com'],bcc:[]});
  });
});

describe('list request generations', () => {
  it('ignores an old search completion and keeps the newer request locked', () => {
    const guard = createRequestGuard();
    const old = guard.begin(); const current = guard.begin(true);
    expect(guard.current(old)).toBe(false); expect(guard.current(current)).toBe(true);
    guard.finish(old); expect(guard.begin()).toBeNull();
    guard.finish(current); expect(guard.begin()).toBe(current);
  });
  it('allows a failed current request to retry without accepting earlier results', () => {
    const guard = createRequestGuard(); const old=guard.begin(); const current=guard.begin(true);
    guard.finish(current); const retry=guard.begin();
    expect(retry).toBe(current); expect(guard.current(old)).toBe(false);
  });
});
