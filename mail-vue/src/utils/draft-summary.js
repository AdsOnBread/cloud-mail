import {searchDateBounds,withinDateBounds} from '../../../shared/mail-search-date';
import {matchesPeople,peopleTerms} from '../../../shared/mail-search-people';
import { addresses } from "./recipients";
import { tzDayjs } from "./day";

function bodyText(draft, snippet) {
  if (!draft.content) return draft.text || "";
  const template = document.createElement("template");
  template.innerHTML = draft.content;
  for (const quote of template.content.querySelectorAll(
    snippet ? ".cloudmail-reply-quote, blockquote, script, style" : "script, style",
  ))
    quote.remove();
  for (const br of template.content.querySelectorAll("br")) br.replaceWith(" ");
  for (const block of template.content.querySelectorAll("p,div,li"))
    block.append(" ");
  return template.content.textContent.replace(/\s+/g, " ").trim();
}

export function draftKey(draft) {
  if (draft.cloudDraftId) return "cloud-" + draft.cloudDraftId;
  if (draft.clientId) return "client-" + draft.clientId;
  return null;
}

export function draftSummary(draft) {
  return {
    draftId: draft.draftId,
    cloudDraftId: draft.cloudDraftId,
    clientId: draft.clientId,
    emailId: Number(draft.emailId),
    hasFiles: Boolean(draft.hasFiles),
    accountId: draft.accountId,
    sender: draft.sendEmail || "",
    senderName: draft.name || "",
    searchBody: draft.text || bodyText(draft,false),
    labelIds: draft.labelIds || [],
    starred: Boolean(draft.mailboxStarred),
    reply: draft.sendType === "reply",
    subject: draft.subject || "",
    preview: draft.pendingSchedule ? 'Awaiting scheduling confirmation' : draft.schedulingError ? 'Scheduling failed. '+draft.schedulingError : bodyText(draft,true).slice(0,180),
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
