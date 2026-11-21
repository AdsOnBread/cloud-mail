<template>
  <section class="conversation-view" aria-label="Conversation">
    <div class="conversation-toolbar">
      <button aria-label="Back to mail" data-tip="Back to mail" @click="back">
        <Icon icon="material-symbols:arrow-back" width="22" />
      </button>
      <button :disabled="busy || !messages.length" :aria-label="filingTitle" :data-tip="filingTitle" @click="mutate(filingAction)">
        <Icon :icon="filingAction==='archive'?'material-symbols:archive-outline':'material-symbols:move-to-inbox-outline'" width="20" />
      </button>
      <button
        v-perm="'email:delete'"
        :disabled="busy || !messages.length"
        aria-label="Delete conversation"
        data-tip="Delete conversation"
        @click="remove"
      >
        <Icon icon="material-symbols:delete-outline" width="22" />
      </button>
      <span class="toolbar-separator" aria-hidden="true"></span>
      <button :disabled="busy || !messages.length" :aria-label="readTitle" :data-tip="readTitle" @click="mutate('read',{unread:hasUnread?1:0})">
        <Icon :icon="hasUnread?'material-symbols:mark-email-read-outline':'material-symbols:mark-email-unread-outline'" width="20" />
      </button>
      <MovePicker :show-categories="(route.query.folder==='inbox' && ui.inboxTabs) || categoryFolders.some(item=>item.id===route.query.folder)" @category="id=>mutate('category',{category:id})" :ids="[Number(route.query.emailId)]" :from-label-id="Number(route.query.labelId)||undefined" :disabled="busy || !messages.length" @move="ops=>mutate('move',ops)" />
      <LabelPicker :rows="[{lastEmailId:Number(route.query.emailId),labelIds}]" :disabled="busy || !messages.length" @apply="ops=>mutate('label',ops)" />
      <button
        v-if="threadDrafts.length"
        class="draft-jump"
        data-tip="Show saved replies"
        @click="focusDrafts"
      >
        {{
          threadDrafts.length === 1
            ? "Draft"
            : "Drafts (" + threadDrafts.length + ")"
        }}
      </button>
      <span>{{ total }} message{{ total === 1 ? "" : "s" }}</span>
    </div>
    <div ref="scroll" class="conversation-body">
      <h1>{{ threadSubject || "(no subject)" }} <MailImportance v-if="messages.length" :reason="importanceReason" :disabled="busy || loading" @toggle="mutate('importance', { important: $event })" /> <router-link v-for="label in threadLabels" :key="label.id" class="thread-label" :style="labelStyle(label)" :to="{name:'label',params:{labelId:label.id}}">{{ label.name }}</router-link></h1>
      <p v-if="error" role="alert">
        {{ error }} <button @click="load()">Retry</button>
      </p>
      <button
        v-if="hasMore"
        class="older"
        :disabled="loading"
        @click="load(true)"
      >
        Load older messages
      </button>
      <p v-if="loading" role="status">Loading conversation…</p>
      <div
        v-if="threadDrafts.length"
        ref="draftList"
        class="thread-drafts"
        aria-label="Saved replies"
      >
        <button
          v-for="draft in threadDrafts"
          :key="draft.draftId"
          :aria-pressed="activeDraft === draft.draftId"
          @click="chooseDraft(draft)"
        >
          <Icon icon="material-symbols:edit-outline" width="18" />
          <span class="draft-label">Draft</span>
          <span class="draft-snippet">{{
            draft.preview || draft.recipients || "(empty draft)"
          }}</span>
          <time>{{ mailboxDate(draft.lastDate) }}</time>
        </button>
      </div>
      <ConversationMessage
        v-for="message in messages"
        :key="message.emailId"
        :message="message"
        :before-delete="save"
        :replying="activeTarget === message.emailId"
        :expanded="expanded.has(message.emailId)"
        @toggle="toggle(message)"
        @reply="reply(message, $event)"
        @changed="updateMessage(message,$event)"
        @deleted="deleted(message)"
      >
        <MessageComposer
          v-if="activeTarget === message.emailId"
          ref="composer"
          inline
          @sent="sent"
          @closed="closed"
        />
      </ConversationMessage>
      <div v-if="messages.length && !activeTarget" class="bottom-replies">
        <el-button
          v-perm="'email:send'"
          round
          @click="reply(messages.at(-1), false)"
          ><Icon icon="material-symbols:reply" width="20" />Reply</el-button
        >
        <el-button
          v-perm="'email:send'"
          round
          @click="reply(messages.at(-1), true)"
          ><Icon icon="material-symbols:reply-all" width="20" />Reply
          all</el-button
        >
        <el-button v-perm="'email:send'" round @click="ui.writerRef.openForward(messages.at(-1))"><Icon icon="material-symbols:forward" width="20"/>Forward</el-button>
      </div>
    </div>
  </section>
</template>
<script setup>
import { useMailFeedback } from "@/store/mail-feedback";
import {categoryFolders} from "@/utils/inbox-categories";
const feedback = useMailFeedback();
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import {
  useRoute,
  useRouter,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
} from "vue-router";
import { Icon } from "@iconify/vue";

import {labelStyle} from "@/components/mail-labels/colors";
import MailImportance from "@/components/mail-importance.vue";
import ConversationMessage from "@/components/conversation-message/index.vue";
import MessageComposer from "@/components/message-composer/index.vue";
import {
  conversationMessages,
  conversationAction,
} from "@/request/conversation";
import { useEmailStore } from "@/store/email";
import { useAccountStore } from "@/store/account";
import { userDraftStore } from "@/store/draft";
import { draftKey } from "@/utils/draft-summary";
import { mailboxDate } from "@/utils/day";
import MovePicker from "@/components/mail-labels/move.vue";
import LabelPicker from "@/components/mail-labels/picker.vue";
import { useMailLabels } from "@/store/mail-labels";
import { useUiStore } from "@/store/ui";
const labels=useMailLabels(), ui=useUiStore(), labelIds=ref([]);
watch(()=>labels.moved,change=>{
  if(change && !change.trash && change.path===route.fullPath && change.ids.includes(Number(route.query.emailId)))back();
});
watch(()=>labels.applied,change=>{
  if(change?.anchors.includes(Number(route.query.emailId))) labelIds.value=[...new Set([...labelIds.value,change.labelId])];
});
const threadLabels=computed(()=>labels.items.filter(label=>labelIds.value.includes(label.id)));
const importanceReason = ref(null);
let importanceRevision = 0;
const unreadCount=ref(0), incoming=ref(0), filedAway=ref(false);
const hasUnread=computed(()=>unreadCount.value>0);
function updateMessage(message,change) {
  if (message.type===0 && change.unread!==undefined && change.unread!==message.unread)
    unreadCount.value=Math.max(0,unreadCount.value+(change.unread===0?1:-1));
  Object.assign(message,change);
}
const readTitle=computed(()=>hasUnread.value?"Mark conversation read":"Mark conversation unread");
const filingAction=computed(()=>filedAway.value?"inbox":"archive");
const filingTitle=computed(()=>filingAction.value==="archive"?"Archive":"Move to Inbox");
const drafts = userDraftStore();
const threadId = ref(null);
const draftList = ref(null);
function focusDrafts() {
  draftList.value?.querySelector("button")?.focus();
  draftList.value?.scrollIntoView({ block: "nearest" });
}
const activeDraft = ref(null);
const threadDrafts = computed(() => {
  const ids = new Set(messages.value.map((message) => message.emailId));
  if (messages.value.length) ids.add(Number(route.query.emailId));
  return drafts.items.filter(
    (draft) =>
      draft.reply &&
      (ids.has(draft.emailId) ||
        (threadId.value && drafts.threads[draft.emailId] === threadId.value)),
  );
});
function closed() {
  activeTarget.value = 0;
  activeDraft.value = null;
}
const accountStore = useAccountStore();
const route = useRoute(),
  router = useRouter(),
  store = useEmailStore();
const threadSubject = ref("");
const messages = ref([]),
  expanded = ref(new Set()),
  activeTarget = ref(0),
  composer = ref(),
  scroll = ref(),
  loading = ref(false),
  busy = ref(false),
  error = ref(""),
  total = ref(0),
  hasMore = ref(false),
  cursor = ref(null);
let viewEpoch = 0,
  generation = 0,
  switching = false,
  handledReply = false;
const currentComposer = () =>
  Array.isArray(composer.value) ? composer.value[0] : composer.value;
async function save() {
  return (await currentComposer()?.saveAndClose()) ?? true;
}
onBeforeRouteLeave(async () => await save());
onBeforeRouteUpdate(async () => await save());
async function load(older = false) {
  if (older && loading.value) return;
  const requestedImportanceRevision = importanceRevision;
  const request = ++generation,
    anchor = Number(route.query.emailId);
  loading.value = true;
  error.value = "";
  try {
    const data = await conversationMessages({
      emailId: anchor,
      before: older ? cursor.value : undefined,
      limit: 30,
    });
    if (request !== generation) return;
    if (data.ownedAddresses)
      accountStore.recipientOwnAddresses = data.ownedAddresses;
    const prior = scroll.value?.scrollHeight || 0;
    messages.value = older
      ? [
          ...data.messages,
          ...messages.value.filter(
            (item) =>
              !data.messages.some(
                (newItem) => item.emailId === newItem.emailId,
              ),
          ),
        ]
      : data.messages;
    threadId.value = data.threadId;
    labelIds.value=data.labelIds || [];
    unreadCount.value=data.unreadCount ?? messages.value.filter(m=>m.type===0 && m.unread===0).length;
    incoming.value=data.incoming ?? messages.value.filter(m=>m.type===0).length;
    if (importanceRevision === requestedImportanceRevision) importanceReason.value = data.importanceReason;
    filedAway.value=Boolean(data.filedAway);
    threadSubject.value = data.subject ?? messages.value[0]?.subject;
    total.value = data.total;
    hasMore.value = data.hasMore;
    cursor.value = data.nextCursor;
    const open = new Set(expanded.value);
    data.messages.forEach((message) => {
      if (message.unread === 0) open.add(message.emailId);
    });
    if (!older && data.messages.length) open.add(data.messages.at(-1).emailId);
    expanded.value = open;
    await nextTick();
    if (request !== generation) return;
    if (older && scroll.value)
      scroll.value.scrollTop += scroll.value.scrollHeight - prior;
    if (!older) {
      if (route.query.draft && !handledReply) {
        await openRequestedDraft();
      } else if (route.query.reply && !handledReply && data.messages.length) {
        handledReply = true;
        await reply(data.messages.at(-1), route.query.reply === "replyAll");
      }
    }
  } catch (e) {
    if (request === generation)
      error.value = e.message || "Could not load conversation.";
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch(
  [() => route.query.emailId, () => route.query.draft],
  () => {
    viewEpoch++;
    switching = false;
    handledReply = false;
    threadSubject.value = "";
    threadId.value = null;
    labelIds.value=[];
    closed();
    expanded.value = new Set();
    messages.value = [];
    load();
  },
  { immediate: true },
);
function matchingDraft() {
  const key = route.query.draft;
  if (!key) return;
  return threadDrafts.value.find(
    (d) =>
      d.emailId === Number(route.query.emailId) &&
      (draftKey(d) === key || (d.clientId && "client-" + d.clientId === key)),
  );
}
async function openRequestedDraft() {
  const draft = matchingDraft();
  if (!draft || handledReply || switching || !messages.value.length) return;
  handledReply = true;
  await editSavedDraft(draft);
}
watch([matchingDraft, loading], () => {
  if (!loading.value && route.query.draft) openRequestedDraft();
});
async function chooseDraft(draft) {
  if (draft.draftId === activeDraft.value) {
    scroll.value
      ?.querySelector(".send.inline")
      ?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (switching) return;
  if (!draftKey(draft) || matchingDraft()?.draftId === draft.draftId)
    await editSavedDraft(draft);
  else
    await router.replace({
      path: route.path,
      query: {
        ...route.query,
        emailId: draft.emailId,
        draft: draftKey(draft),
        reply: undefined,
      },
    });
}
async function editSavedDraft(summary) {
  const request = viewEpoch;
  try {
    const { readSavedDraft } = await import("@/services/draft-list");
    const draft = await readSavedDraft(summary.draftId);
    if (request === viewEpoch)
      await reply({ emailId: summary.emailId }, false, draft);
  } catch (e) {
    if (request === viewEpoch)
      error.value = e.message || "Could not open draft.";
  }
}
async function reply(message, all, draft) {
  if (switching) return;
  const request = viewEpoch;
  switching = true;
  try {
    if (!(await save()) || request !== viewEpoch) return;
    // A restored draft may target a message older than the currently loaded page.
    if (!messages.value.some((item) => item.emailId === message.emailId)) {
      const detail = await store.ensureDetail(message);
      if (request !== viewEpoch) return;
      messages.value.push(detail);
      messages.value.sort((a, b) => a.emailId - b.emailId);
    }
    expanded.value = new Set([...expanded.value, message.emailId]);
    activeTarget.value = message.emailId;
    await nextTick();
    if (request !== viewEpoch) return;
    const editor = currentComposer();
    activeDraft.value = draft?.draftId ?? null;
    if (draft) await editor.openDraft(draft);
    else await editor[all ? "openReplyAll" : "openReply"](message);
    await nextTick();
    if (request !== viewEpoch) return;
    scroll.value
      ?.querySelector(".send.inline")
      ?.scrollIntoView({ block: "nearest" });
  } catch (e) {
    if (request === viewEpoch)
      error.value = e.message || "Could not open reply.";
  } finally {
    if (request === viewEpoch) switching = false;
  }
}
async function toggle(message) {
  if (
    activeTarget.value === message.emailId &&
    expanded.value.has(message.emailId) &&
    !(await save())
  )
    return;
  const next = new Set(expanded.value);
  next.has(message.emailId)
    ? next.delete(message.emailId)
    : next.add(message.emailId);
  expanded.value = next;
}
async function sent() {
  activeTarget.value = 0;
  await load();
  store.conversationRevision++;
  await nextTick();
  scroll.value?.scrollTo({
    top: scroll.value.scrollHeight,
    behavior: "smooth",
  });
}
function back() {
  if (window.history.state.back) router.back();
  else
    router.push(
      {
        inbox: {name:"email",query:route.query.category?{category:route.query.category}:{}},
        all: "/all",
        label: route.query.labelId ? "/label/"+route.query.labelId : "/all",
        sent: "/sent",
        starred: "/starred",
        draft: "/drafts",
        archived: "/archived",
        snoozed: "/snoozed",
        important: "/important",
      }[route.query.folder] || (categoryFolders.some(item=>item.id===route.query.folder) ? {name:route.query.folder} : "/inbox"),
    );
}
async function mutate(action, extra = {}) {
  if (busy.value) return;
  const epoch=viewEpoch, anchor=Number(route.query.emailId);
  busy.value = true;
  try {
    if ((!["label", "importance"].includes(action) && !(await save())) || epoch!==viewEpoch) return;
    const result = await conversationAction(action, [anchor], extra);
    if (action === "delete") feedback.trashed(result?.emailIds || []);
    store.conversationRevision++;
    if (epoch!==viewEpoch) return;
    if (["delete","archive","inbox","move","category"].includes(action)) back();
    else if (action === "importance") {
      importanceRevision++;
      importanceReason.value = extra.important ? "user" : null;
    }
    else if (action === "label") labelIds.value=[...new Set([...labelIds.value,...extra.add])].filter(id=>!extra.remove.includes(id));
    else {
      unreadCount.value=extra.unread===0?incoming.value:0;
      messages.value.forEach((message) => {
        message.unread = extra.unread ?? 1;
        if (store.detailMap[message.emailId])
          store.detailMap[message.emailId].unread = message.unread;
      });
    }
  } catch (e) {
    if (epoch===viewEpoch) error.value = e.message || "Could not update conversation.";
  } finally {
    busy.value = false;
  }
}
function remove() { return mutate("delete"); }
watch(() => feedback.restored, () => { if (!activeTarget.value) load(); });
async function deleted(message) {
  if (activeTarget.value === message.emailId && !(await save())) return;
  messages.value = messages.value.filter(
    (item) => item.emailId !== message.emailId,
  );
  total.value--;
  if (!messages.value.length) {
    back();
    return;
  }
  if (Number(route.query.emailId) === message.emailId)
    await router.replace({
      path: "/mail",
      query: {
        ...route.query,
        emailId: messages.value.at(-1).emailId,
        reply: undefined,
      },
    });
  else await load();
}
function keydown(event) {
  if (
    event.key === "Escape" && !event.defaultPrevented &&
    ![...document.querySelectorAll(".el-popper,.el-dialog")].some(el=>el.getClientRects().length) &&
    !activeTarget.value &&
    !document.querySelector(".el-message-box,.tox-dialog") &&
    ![...document.querySelectorAll(".send:not(.inline)")].some(
      (node) => node.offsetParent !== null,
    )
  )
    back();
}
function beforeUnload(event) {
  if (activeTarget.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => {
  window.addEventListener("keydown", keydown);
  window.addEventListener("beforeunload", beforeUnload);
});
onUnmounted(() => {
  viewEpoch++;
  generation++;
  window.removeEventListener("keydown", keydown);
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>
<style scoped>
.conversation-toolbar .toolbar-separator { flex:none; margin:0 6px; height:20px; width:1px; background:var(--light-border-color); }
.thread-label { display:inline-block; font-size:12px; vertical-align:middle; line-height:18px; font-weight:500; text-decoration:none; color:var(--regular-text-color); background:var(--mail-hover); border-radius:4px; padding:0 6px; margin-right:4px; }

.conversation-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.conversation-toolbar {
  height: 48px;
  flex-shrink: 0;
  padding: 0 12px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.conversation-toolbar button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  color: var(--regular-text-color);
}
.conversation-toolbar button:hover {
  background: var(--mail-hover);
}
.conversation-toolbar .draft-jump {
  width: auto;
  padding: 0 12px;
  border-radius: 18px;
  color: var(--mail-draft);
  font:
    500 14px Arial,
    sans-serif;
}
.conversation-toolbar span {
  margin-left: auto;
  font-size: 12px;
  color: var(--regular-text-color);
}
.conversation-body {
  overflow: auto;
  flex: 1;
  padding: 20px 32px 80px;
  min-height: 0;
}
h1 {
  font-size: 24px;
  font-weight: 400;
  margin: 0 0 16px 48px;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.thread-drafts {
  margin: 0 0 12px;
  border-block: 1px solid var(--light-border-color);
}
.thread-drafts button {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 8px;
  color: var(--regular-text-color);
  text-align: left;
  font: inherit;
}
.thread-drafts button:hover {
  background: var(--mail-read);
}
.thread-drafts button[aria-pressed="true"] {
  background: var(--mail-search);
}
.thread-drafts button + button {
  border-top: 1px solid var(--light-border-color);
}
.draft-label {
  color: var(--mail-draft);
  font-size: 14px;
}
.draft-snippet {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 14px;
}
.thread-drafts time {
  font-size: 12px;
}
.older {
  display: block;
  margin: 0 auto 12px;
  padding: 12px 20px;
  border: 1px solid var(--light-border-color);
  border-radius: 24px;
  cursor: pointer;
  color: var(--regular-text-color);
}
.bottom-replies {
  display: flex;
  gap: 8px;
  margin: 24px 0 0 48px;
}
.bottom-replies svg {
  margin-right: 8px;
}
@media (max-width: 767px) {
  .conversation-body {
    padding: 16px 16px 100px;
  }
  h1 {
    margin-left: 0;
    font-size: 22px;
  }
  .bottom-replies {
    margin-left: 0;
  }
  .conversation-toolbar {
    gap: 4px;
  }
}
</style>
