import {mailboxSession} from './mailbox-session';
import {draftSearchBytes} from '@/components/message-composer/files';
import { watch } from "vue";
import db from "@/db/db";
import { userDraftStore } from "@/store/draft";
import { useEmailStore } from "@/store/email";
import { useUiStore } from "@/store/ui";
import http from "@/axios";
import { draftKey, responseAnchor, draftSummary, newestDraft } from "@/utils/draft-summary";

export function startDraftList() {
  const store = userDraftStore(),
    email = useEmailStore();
  let cache = new Map();
  const stopList = watch(
    [db, () => store.refreshList],
    async ([database], old, onCleanup) => {
      let active = true;
      onCleanup(() => {
        active = false;
      });
      if (database !== old?.[0]) {
        store.items = [];
        store.threads = {};
        store.threadSummaries = {};
        cache = new Map();
      }
      try {
        const rows = await database.draft.toArray();
        if (!active) return;
        const next = new Map();
        for (const row of rows) {
          if (row.deleted || (row.syncState==='holding' && !row.dirty)) continue;
          const revision = [
            row.editToken,
            row.cloudVersion,
            row.localRevision,
            row.updatedAt,
            row.pendingSchedule?.sendAt,
            row.schedulingError,
          ].join("|");
          const cached = cache.get(row.draftId);
          if ((row.hasFiles == null || row.sizeBytes == null) && cached?.revision !== revision) {
            const files=await database.att.get(row.draftId);
            if(!active)return;
            row.hasFiles=Boolean(files?.attachments?.some(file=>!file.contentId));
            row.sizeBytes=draftSearchBytes(row,files?.attachments || []);
          }
          next.set(
            row.draftId,
            cached?.revision === revision
              ? cached
              : { revision, item: draftSummary(row) },
          );
        }
        cache = next;
        store.items = [...next.values()]
          .map((entry) => entry.item)
          .sort(newestDraft);
        store.listError = "";
      } catch (error) {
        if (active) store.listError = error.message || "Could not load drafts.";
      }
    },
    { immediate: true },
  );
  const anchors = () =>
    [
      ...new Set(
        store.items.filter((d) => d.reply && d.emailId).map((d) => d.emailId),
      ),
    ]
      .sort((a, b) => a - b)
      .join(",");
  const stopThreads = watch(
    [db, anchors, () => email.conversationRevision, () => store.refreshList],
    async ([database, ids], old, onCleanup) => {
      // A cloud refresh can change thread membership even when the set of drafts is identical.
      if (!ids) {
        store.threads = {};
        store.threadSummaries = {};
        return;
      }
      let active = true;
      onCleanup(() => {
        active = false;
      });
      const threads = {}, summaries = {};
      try {
        const list = ids.split(",").map(Number);
        for (let i = 0; i < list.length; i += 95) {
          const rows = await http.post(
            "/email/conversation/draft-threads",
            { emailIds: list.slice(i, i + 95) },
            { noMsg: true },
          );
          if (!active || db.value !== database) return;
          for (const row of rows) {
            threads[row.emailId] = row.threadId;
            if (row.senders) summaries[row.threadId] = {senders:row.senders, messageCount:row.messageCount, subject:row.subject, inbox:Boolean(row.inbox), unread:Boolean(row.hasUnread)};
          }
        }
        store.threads = threads;
        store.threadSummaries = summaries;
      } catch {
        /* Offline drafts remain available in Drafts. The next sync retries this lookup. */
      }
    },
    { immediate: true },
  );
  return () => {
    stopList();
    stopThreads();
  };
}

// A popped-out editor updates one row at a time. Refresh that row without
// reloading every draft or fetching the conversation summaries on each edit.
export async function refreshLocalDraft(id) {
  if (!id) return;
  const database = db.value, store = userDraftStore();
  try {
    const row = await database.draft.get(id);
    if (database !== db.value) return;
    const items = store.items.filter(item => item.draftId !== id);
    if (row && !row.deleted && !(row.syncState === "holding" && !row.dirty))
      items.push(draftSummary(row));
    store.items = items.sort(newestDraft);
  } catch (error) {
    if (database === db.value) store.listError = error.message || "Could not refresh draft.";
  }
}

export async function readSavedDraft(draftId) {
  const database = db.value;
  const [draft, files] = await Promise.all([
    database.draft.get(draftId),
    database.att.get(draftId),
  ]);
  if (db.value !== database || !draft || draft.deleted)
    throw new Error("This draft is no longer available.");
  if(draft.pendingSchedule)throw new Error("Awaiting scheduling confirmation. Check Scheduled or Drafts when connected.");
  return { ...draft, attachments: files?.attachments || [] };
}

export async function openSavedDraft(draftId, router, folder, labelId, category, canOpen) {
  const session=mailboxSession(), origin=router.currentRoute.value.fullPath;
  const current=()=>router.currentRoute.value.fullPath===origin && (!canOpen || canOpen());
  session.check();
  const draft = await readSavedDraft(draftId);
  session.check();
  if (!current()) return;
  if (await useUiStore().writerRef?.focusDraft?.(draft.draftId)) return;
  session.check();
  if (!current()) return;
  if (
    draftKey(draft) &&
    !draft.responseView && !draft.trashSource && responseAnchor(draft) &&
    (draft.sendType === "reply" || draft.inlineReply)
  ) {
    await router.push({
      path: "/mail",
      query: { emailId: responseAnchor(draft), draft: draftKey(draft), folder, labelId, ...(router.currentRoute?.value.query.window==="1" ? {window:"1"} : {}), ...(folder==="inbox" && category?{category}:{}) },
    });
  } else await useUiStore().writerRef.openDraft(draft);
}
