import { addresses } from "./recipients";
import { tzDayjs } from "./day";

function preview(draft) {
  if (!draft.content) return draft.text || "";
  const template = document.createElement("template");
  template.innerHTML = draft.content;
  for (const quote of template.content.querySelectorAll(
    ".cloudmail-reply-quote, blockquote, script, style",
  ))
    quote.remove();
  for (const br of template.content.querySelectorAll("br")) br.replaceWith(" ");
  for (const block of template.content.querySelectorAll("p,div,li"))
    block.append(" ");
  return template.content.textContent.replace(/\s+/g, " ").trim().slice(0, 180);
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
    reply: draft.sendType === "reply",
    subject: draft.subject || "",
    preview: draft.pendingSchedule ? 'Awaiting scheduling confirmation' : draft.schedulingError ? 'Scheduling failed. '+draft.schedulingError : preview(draft),
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
