import {searchDateBounds,withinDateBounds} from '../../../shared/mail-search-date';
import {matchesPeople,peopleTerms} from '../../../shared/mail-search-people';
import { addresses } from "./recipients";
import { tzDayjs } from "./day";

function draftText(draft) {
  if (!draft.content) return {body:draft.text || '',snippet:draft.text || ''};
  const template=document.createElement('template');
  template.innerHTML=draft.content;
  const root=template.content;
  for (const node of root.querySelectorAll('script,style')) node.remove();
  for (const br of root.querySelectorAll('br')) br.replaceWith(' ');
  for (const block of root.querySelectorAll('p,div,li')) block.append(' ');
  const text=()=>root.textContent.replace(/\s+/g,' ').trim();
  const body=draft.text || text();
  for (const quote of root.querySelectorAll('.cloudmail-reply-quote,blockquote')) quote.remove();
  return {body,snippet:text()};
}

export function draftKey(draft) {
  if (draft.cloudDraftId) return "cloud-" + draft.cloudDraftId;
  if (draft.clientId) return "client-" + draft.clientId;
  return null;
}

export function draftSummary(draft) {
  const {body,snippet}=draftText(draft);
  return {
    draftId: draft.draftId,
    cloudDraftId: draft.cloudDraftId,
    clientId: draft.clientId,
    emailId: Number(draft.emailId),
    hasFiles: Boolean(draft.hasFiles),
    accountId: draft.accountId,
    sender: draft.sendEmail || "",
    senderName: draft.name || "",
    searchBody: body,
    labelIds: draft.labelIds || [],
    starred: Boolean(draft.mailboxStarred),
    reply: draft.sendType === "reply",
    subject: draft.subject || "",
    preview: draft.pendingSchedule ? 'Awaiting scheduling confirmation' : draft.schedulingError ? 'Scheduling failed. '+draft.schedulingError : snippet.slice(0,180),
    lastDate: tzDayjs(draft.updatedAt || draft.createTime).valueOf(),
    recipients: [
      ...addresses(draft.receiveEmail),
      ...addresses(draft.cc),
      ...addresses(draft.bcc),
    ].join(", "),
  };
}
export const newestDraft = (a, b) =>
  b.lastDate - a.lastDate || b.draftId - a.draftId;

export function draftSearchMatcher(query, filters, accounts) {
  if (!query && !Object.keys(filters).length) return ()=>true;
  const bounds=searchDateBounds(filters);
  const from=peopleTerms(filters,'from'), to=peopleTerms(filters,'to');
  const words=(query || '').toLowerCase(), subject=(filters.subject || '').toLowerCase();
  return draft=>{
    if (filters.isUnread || filters.hasAttachment && !draft.hasFiles || !withinDateBounds(draft.lastDate,bounds)) return false;
    const account=accounts.find(mailbox=>mailbox.accountId===draft.accountId);
    const sender={address:draft.sender || account?.email,name:draft.senderName || account?.name};
    return matchesPeople([sender],from) && matchesPeople((draft.recipients || '').split(', '),to) &&
      (draft.subject || '').toLowerCase().includes(subject) && (!words ||
        [draft.subject,draft.searchBody,draft.preview,sender.address,sender.name,draft.recipients].some(value=>value?.toLowerCase().includes(words)));
  };
}
