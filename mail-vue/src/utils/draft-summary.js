import {containsExcluded,excludedPhrases} from '../../../shared/mail-search-words';
import {matchesSize,sizeCriterion,storedMessageBytes} from '../../../shared/mail-search-size';
import {searchDateBounds,withinDateBounds} from '../../../shared/mail-search-date';
import {matchesPeople,peopleTerms} from '../../../shared/mail-search-people';
import {recipientFields,recipientEntries} from "./recipients";
import {recipientName} from '../../../shared/recipient-names';
import {normalizedSubject} from '../../../shared/mail-subject';
import { tzDayjs } from "./day";

function draftText(draft) {
  if (!draft.content) return {body:draft.text || '',snippet:draft.text || ''};
  const template=document.createElement('template');
  template.innerHTML=draft.content;
  const root=template.content;
  for (const node of root.querySelectorAll('script,style,title')) node.remove();
  for (const br of root.querySelectorAll('br')) br.replaceWith(' ');
  for (const block of root.querySelectorAll('p,div,li')) block.append(' ');
  const text=()=>root.textContent.replace(/\s+/g,' ').trim();
  const body=draft.text?.trim() ? draft.text : text();
  for (const quote of root.querySelectorAll('.cloudmail-reply-quote,blockquote')) quote.remove();
  return {body,snippet:text()};
}

export function draftKey(draft) {
  if (draft.cloudDraftId) return "cloud-" + draft.cloudDraftId;
  if (draft.clientId) return "client-" + draft.clientId;
  return null;
}

export function responseAnchor(draft) {
  if (draft.detachedReply) return 0;
  if (draft.sendType === "forward" && draft.inlineReply) return Number(draft.responseSourceId) || 0;
  return Number(draft.emailId) || 0;
}

export function draftSummary(draft) {
  const {body,snippet}=draftText(draft);
  const recipientPeople=recipientFields.flatMap(field=>recipientEntries(draft[field])).map(person=>({
    address:person.address,name:recipientName(draft.replyRecipientNames,person.address) || person.name || "",
  }));
  return {
    draftId: draft.draftId,
    cloudDraftId: draft.cloudDraftId,
    clientId: draft.clientId,
    emailId: responseAnchor(draft),
    trashSource: Number(draft.trashSource) || undefined,
    hasFiles: Boolean(draft.hasFiles),
    sizeBytes:draft.sizeBytes ?? storedMessageBytes(draft),
    accountId: draft.accountId,
    sender: draft.sendEmail || "",
    senderName: draft.name || "",
    searchBody: body,
    labelIds: draft.labelIds || [],
    starred: Boolean(draft.mailboxStarred),
    reply: draft.sendType === "reply" || Boolean(draft.sendType === "forward" && responseAnchor(draft)),
    subject: draft.subject || "",
    preview: draft.pendingSchedule ? 'Awaiting scheduling confirmation' : draft.schedulingError ? 'Scheduling failed. '+draft.schedulingError : draft.deliveryError ? 'Send status: '+draft.deliveryError : snippet.slice(0,180),
    lastDate: tzDayjs(draft.updatedAt || draft.createTime).valueOf(),
    recipientPeople,
    recipients:recipientPeople.map(person=>person.address).join(", "),
  };
}
export function draftRowSubject(draft,thread) {
  return thread?.subject!=null && normalizedSubject(draft.subject)===normalizedSubject(thread.subject) ? thread.subject : draft.subject;
}
export const newestDraft = (a, b) =>
  b.lastDate - a.lastDate || b.draftId - a.draftId;

export function draftSearchMatcher(query, filters, accounts) {
  if (!query && !Object.keys(filters).length) return ()=>true;
  const bounds=searchDateBounds(filters),size=sizeCriterion(filters);
  const from=peopleTerms(filters,'from'), to=peopleTerms(filters,'to');
  const excluded=excludedPhrases(filters.excluded);
  const words=(query || '').toLowerCase(), subject=(filters.subject || '').toLowerCase();
  return draft=>{
    if (!matchesSize(draft.sizeBytes,size) || filters.isUnread || filters.hasAttachment && !draft.hasFiles || !withinDateBounds(draft.lastDate,bounds)) return false;
    const account=accounts.find(mailbox=>mailbox.accountId===draft.accountId);
    const sender={address:draft.sender || account?.email,name:draft.senderName || account?.name};
    const people=draft.recipientPeople || (draft.recipients || '').split(', ').map(address=>({address}));
    const fields=[draft.subject,draft.searchBody,sender.address,sender.name,...people.flatMap(p=>[p.address,p.name])];
    return !containsExcluded(fields,excluded) && matchesPeople([sender],from) && matchesPeople(people,to) &&
      (draft.subject || '').toLowerCase().includes(subject) && (!words ||
        [...fields,draft.preview].some(value=>value?.toLowerCase().includes(words)));
  };
}
