<template>
  <section ref="reader" class="conversation-view" aria-label="Conversation" aria-keyshortcuts="N P"
    @focusin="rememberMessage" @pointerdown="rememberMessage">
    <div class="conversation-toolbar">
      <button data-reader-back aria-label="Back to mail" data-tip="Back to mail" @click="back">
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
        :aria-label="threadDrafts.length===1 ? 'Open saved reply' : 'Show saved replies'"
        :data-tip="threadDrafts.length===1 ? 'Open saved reply' : 'Show saved replies'"
        @click="jumpToDraft"
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
      <div class="thread-heading"><h1>{{ threadSubject || "(no subject)" }} <MailImportance v-if="messages.length" :reason="importanceReason" :disabled="busy || loading" @toggle="mutate('importance', { important: $event })" /> <router-link v-for="label in threadLabels" :key="label.id" class="thread-label" :style="labelStyle(label)" :to="{name:'label',params:{labelId:label.id}}">{{ label.name }}</router-link></h1>
        <div v-if="messages.length" class="heading-actions">
          <button v-if="total>1" type="button" :aria-label="expansionTitle" :data-tip="expansionTitle" :disabled="loading" @click="toggleAll"><Icon :icon="allExpanded || expanding ? 'material-symbols:unfold-less' : 'material-symbols:unfold-more'" width="20"/></button>
          <button type="button" aria-label="Print all" data-tip="Print all" :disabled="printing" @click="printMail()"><Icon icon="material-symbols:print-outline" width="20"/></button>
          <ReaderWindowLink v-if="route.query.window!=='1'" :href="windowHref"/>
        </div>
      </div>
      <p v-if="printing || expanding" role="status">{{printing ? 'Preparing to print…' : 'Expanding messages…'}}</p>
      <p v-if="error" role="alert">
        {{ error }} <button @click="load()">Retry</button>
      </p>
      <p v-if="draftFailure" role="alert">
        {{ draftFailure.message }} <button @click="retryDraft">Retry opening draft</button>
      </p>
      <button
        v-if="hasMore"
        class="older"
        :disabled="loading || expanding"
        @click="load(true)"
      >
        Load older messages
      </button>
      <p v-if="loading" role="status">Loading conversation…</p>
      <SavedReplies :drafts="unloadedDrafts" @open="chooseDraft" />
      <template v-for="message in messages" :key="message.emailId">
      <ConversationMessage
        :data-reader-message="message.emailId"
        :message="message"
        :now="readerNow"
        :before-delete="save"
        :replying="activeTarget === message.emailId"
        :expanded="expanded.has(message.emailId)"
        @toggle="toggle(message)"
        @reply="reply(message, $event)"
        @forward="reply(message,false,null,true)"
        @changed="updateMessage(message,$event)"
        @deleted="deleted(message)"
        @print="printMail"
      >
        <MessageComposer
          v-if="activeTarget === message.emailId"
          ref="composer"
          :response-message="message"
          inline
          @sent="sent"
          @closed="inlineClosed(message.emailId)"
        />
      </ConversationMessage>
      <SavedReplies v-if="draftsByMessage.has(message.emailId)" :drafts="draftsByMessage.get(message.emailId)" @open="chooseDraft"/>
      </template>
      <div v-if="messages.length && !activeTarget" class="bottom-replies">
        <el-button v-for="all in replyChoices" :key="String(all)" v-perm="'email:send'" round @click="reply(messages.at(-1),all)">
          <Icon :icon="all ? 'material-symbols:reply-all' : 'material-symbols:reply'" width="20"/>{{all ? 'Reply all' : 'Reply'}}
        </el-button>
        <el-button v-perm="'email:send'" round @click="reply(messages.at(-1),false,null,true)"><Icon icon="material-symbols:forward" width="20"/>Forward</el-button>
      </div>
    </div>
  </section>
</template>
<script setup>
import {useNow} from '@vueuse/core';
import {hasReplyAll} from '@/utils/recipients';
import {useUserStore} from '@/store/user';
import {emailDetail} from '@/request/email';
import {printMessages} from './print';
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
import ReaderWindowLink from "@/components/reader-window-link.vue";
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
import { draftKey, responseAnchor } from "@/utils/draft-summary";
import SavedReplies from './saved-replies.vue';
import MovePicker from "@/components/mail-labels/move.vue";
import LabelPicker from "@/components/mail-labels/picker.vue";
import { useMailLabels } from "@/store/mail-labels";
import { useUiStore } from "@/store/ui";
const readerNow=useNow({interval:60000});
const labels=useMailLabels(), ui=useUiStore(), labelIds=ref([]);
watch(()=>labels.moved,change=>{
  if(change && !change.trash && change.path===route.fullPath && change.ids.includes(Number(route.query.emailId)))back();
});
watch(()=>labels.applied,change=>{
  if(change && !change.trash && change.anchors.includes(Number(route.query.emailId))) labelIds.value=[...new Set([...labelIds.value,change.labelId])];
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
function jumpToDraft() {
  if (threadDrafts.value.length===1) return chooseDraft(threadDrafts.value[0]);
  const first=scroll.value?.querySelector('.thread-drafts button');
  first?.focus({preventScroll:true});
  first?.scrollIntoView({block:'nearest'});
}
const activeDraft = ref(null), draftFailure=ref(null);
const reader=ref(null), currentMessage=ref(null);
let draftRun=0, sessionEpoch=0, firstPagedId=null;
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
const draftsByMessage=computed(()=>{
  const groups=new Map();
  for (const draft of threadDrafts.value) {
    if (draft.draftId===activeDraft.value) continue;
    if (!groups.has(draft.emailId)) groups.set(draft.emailId,[]);
    groups.get(draft.emailId).push(draft);
  }
  return groups;
});
const unloadedDrafts=computed(()=>{
  const loaded=new Set(messages.value.map(message=>message.emailId));
  return threadDrafts.value.filter(draft=>!loaded.has(draft.emailId) && draft.draftId!==activeDraft.value);
});
function closed() {
  activeTarget.value = 0;
  activeDraft.value = null;
}
let savingInline=0;
async function inlineClosed(id) {
  const draft=activeDraft.value, current=readerCurrent();
  const focus=document.activeElement;
  const restore=!savingInline && !switching && (focus===document.body || Boolean(focus?.closest('.send.inline')));
  closed();
  if (!restore) return;
  await nextTick();
  if (!current() || activeTarget.value || document.activeElement!==document.body || readerObscured()) return;
  const row=draft && scroll.value?.querySelector('[data-reader-draft="'+draft+'"]');
  (row || scroll.value?.querySelector('[data-reader-message="'+id+'"] .message-toggle'))?.focus({preventScroll:true});
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
const user=useUserStore(),printing=ref(false),expanding=ref(false);
const replyChoices=computed(()=>hasReplyAll(messages.value.at(-1),accountStore.ownAddresses) ? [user.defaultReplyAll,!user.defaultReplyAll] : [false]);
let printRun=0,expandRun=0,printController;
const allExpanded=computed(()=>!hasMore.value && messages.value.every(m=>expanded.value.has(m.emailId)));
const expansionTitle=computed(()=>allExpanded.value || expanding.value ? 'Collapse all' : 'Expand all');
const windowHref=computed(()=>{
  const {emailId,folder,labelId,category}=route.query;
  const draft=threadDrafts.value.find(item=>item.draftId===activeDraft.value);
  const requested=draft && draftKey(draft);
  return router.resolve({path:'/mail',query:{emailId:requested ? draft.emailId : emailId,folder,labelId,category,
    ...(requested ? {draft:requested} : {}),window:'1'}}).href;
});
function readerCurrent() {
  const session=sessionEpoch,epoch=viewEpoch,token=localStorage.getItem('token'),owner=user.user.userId,account=accountStore.currentAccountId;
  return ()=>session===sessionEpoch && epoch===viewEpoch && token===localStorage.getItem('token') && owner===user.user.userId && account===accountStore.currentAccountId;
}
async function allRows(current) {
  const ids=new Map(messages.value.map(m=>[m.emailId,m]));
  let before=hasMore.value ? cursor.value : null;
  while (before && current()) {
    const page=await conversationMessages({emailId:Number(route.query.emailId),before,limit:100});
    if (!current()) return [];
    if (page.threadId!==threadId.value || (page.hasMore && !(page.nextCursor>0 && page.nextCursor<before))) throw new Error('Conversation changed. Reopen it and try again.');
    for (const m of page.messages) ids.set(m.emailId,m);
    before=page.hasMore ? page.nextCursor : null;
  }
  return [...ids.values()].sort((a,b)=>a.emailId-b.emailId);
}
async function printMail(message) {
  if (printing.value) return;
  const run=++printRun,current=readerCurrent();
  printController?.abort();
  const controller=printController=new AbortController();
  printing.value=true;error.value='';
  try {
    const rows=message ? [message] : await allRows(current);
    if (current()) await printMessages({subject:message?.subject || threadSubject.value,owner:user.user.userId,rows,current,signal:controller.signal,read:row=>emailDetail(row.emailId,{signal:controller.signal})});
  } catch(e) {if(!controller.signal.aborted && current())error.value=e.message || 'Could not print the message.';}
  finally {if(run===printRun)printing.value=false;}
}
watch([()=>user.user.userId,()=>user.user.email,()=>user.authenticatedToken,()=>accountStore.currentAccountId],()=>{
  sessionEpoch++;draftRun++;draftFailure.value=null;currentMessage.value=null;
  printController?.abort();
  if (loading.value && !messages.value.length) {
    const current=readerCurrent();
    nextTick(()=>{ if (current() && user.user.userId && user.authenticatedToken) load(); });
  }
},{flush:'sync'});
async function toggleAll() {
  if (loading.value) return;
  const run=++expandRun,valid=readerCurrent(),current=()=>valid() && run===expandRun;
  if (allExpanded.value || expanding.value) {
    expanding.value=false;
    expanded.value=new Set([messages.value.at(-1)?.emailId,activeTarget.value].filter(Boolean));
    return;
  }
  expanding.value=true;error.value='';
  try {
    const rows=await allRows(current);
    if (!current()) return;
    messages.value=rows;hasMore.value=false;cursor.value=null;
    const pending=rows.filter(m=>!expanded.value.has(m.emailId));
    for (let i=0;i<pending.length;i+=4) {
      const batch=pending.slice(i,i+4);
      const details=await Promise.all(batch.map(m=>store.detailMap[m.emailId] || emailDetail(m.emailId)));
      if (!current()) return;
      store.applyFullList(details);
      expanded.value=new Set([...expanded.value,...batch.map(m=>m.emailId)]);
    }
  } catch(e) {if(current())error.value=e.message || 'Could not expand the conversation.';}
  finally {if(run===expandRun)expanding.value=false;}
}
async function save() {
  savingInline++;
  try { return (await currentComposer()?.saveAndClose()) ?? true; }
  finally { savingInline--; }
}
onBeforeRouteLeave(async () => await save());
onBeforeRouteUpdate(async () => await save());
async function load(older = false) {
  if (older && (loading.value || expanding.value)) return;
  expandRun++;expanding.value=false;
  const current=readerCurrent();
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
    if (request !== generation || !current()) return;
    if (data.ownedAddresses)
      accountStore.recipientOwnAddresses = data.ownedAddresses;
    const prior = scroll.value?.scrollHeight || 0;
    if (older && ((threadId.value && data.threadId!==threadId.value) ||
        (data.hasMore && !(data.nextCursor>0 && data.nextCursor<cursor.value))))
      throw new Error('Conversation changed. Reopen it and try again.');
    if (older) {
      const joined=new Map(messages.value.map(message=>[message.emailId,message]));
      for (const message of data.messages) joined.set(message.emailId,message);
      messages.value=[...joined.values()].sort((a,b)=>a.emailId-b.emailId);
    } else messages.value=data.messages;
    firstPagedId=data.messages[0]?.emailId ?? (older ? firstPagedId : null);
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
    if (request !== generation || !current()) return;
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
    return true;
  } catch (e) {
    if (request === generation && current())
      error.value = e.message || "Could not load conversation.";
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch(
  [() => route.query.emailId, () => route.query.draft],
  () => {
    printController?.abort();
    viewEpoch++;printRun++;expandRun++;printing.value=false;expanding.value=false;
    switching = false;
    handledReply = false;
    draftRun++;draftFailure.value=null;currentMessage.value=null;
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
  return drafts.items.find(
    (d) =>
      d.reply && d.emailId === Number(route.query.emailId) &&
      (draftKey(d) === key || (d.clientId && "client-" + d.clientId === key)),
  );
}
async function openRequestedDraft() {
  const draft = matchingDraft();
  if (!draft || handledReply || switching) return;
  handledReply = true;
  await editSavedDraft(draft);
}
watch([matchingDraft, loading], () => {
  if (!loading.value && route.query.draft) openRequestedDraft();
});
async function chooseDraft(draft) {
  if (switching) return;
  if (draft.draftId === activeDraft.value) {
    draftRun++;draftFailure.value=null;
    currentComposer()?.focusBody?.();
    scroll.value
      ?.querySelector(".send.inline")
      ?.scrollIntoView({ block: "nearest" });
    return;
  }
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
  const run=++draftRun, current=readerCurrent();
  draftFailure.value=null;
  try {
    if (await ui.writerRef?.focusDraft?.(summary.draftId)) return;
    const {readSavedDraft}=await import("@/services/draft-list");
    if (!current() || run!==draftRun) return;
    const draft=await readSavedDraft(summary.draftId);
    if (!current() || run!==draftRun) return;
    if (responseAnchor(draft)!==Number(summary.emailId) ||
        (summary.accountId && Number(summary.accountId)!==Number(draft.accountId)) ||
        (summary.cloudDraftId && String(summary.cloudDraftId)!==String(draft.cloudDraftId)) ||
        (summary.clientId && draft.clientId!==summary.clientId) ||
        (draft.ownerEmail && draft.ownerEmail!==user.user.email))
      throw new Error('This draft is no longer available.');
    if (!messages.value.length) {
      await openWithoutConversation(draft,current);
    } else if (draft.responseView) await ui.writerRef.openDraft(draft);
    else await reply({emailId:summary.emailId},false,draft);
  } catch (e) {
    if (current() && run===draftRun) draftFailure.value={summary,current,message:e.message || "Could not open draft."};
  }
}
async function openWithoutConversation(draft,current) {
  const opened=await ui.writerRef.openDraft(draft);
  if (opened && current()) await router.replace({path:"/drafts",query:route.query.window==="1" ? {window:"1"} : {}});
}
function retryDraft() {
  const failure=draftFailure.value;
  draftFailure.value=null;
  if (!failure?.current()) return;
  const item=drafts.items.find(d=>d.draftId===failure.summary.draftId);
  if (item && item.emailId===failure.summary.emailId &&
      (!failure.summary.cloudDraftId || item.cloudDraftId===failure.summary.cloudDraftId) &&
      (!failure.summary.clientId || item.clientId===failure.summary.clientId)) editSavedDraft(item);
}
async function reply(message, all, draft, forward=false) {
  if (switching) return;
  if (!draft) { draftRun++;draftFailure.value=null; }
  const request = viewEpoch, current=readerCurrent();
  switching = true;
  try {
    if (!(await save()) || !current()) return;
    // A restored draft may target a message older than the currently loaded page.
    if (!messages.value.some((item) => item.emailId === message.emailId)) {
      let detail;
      try {
        detail=await store.ensureDetail(message);
        if (detail?.emailId!==message.emailId) throw new Error("The original message is no longer available.");
      }
      catch (e) {
        if (!draft) throw e;
        if (current()) await openWithoutConversation(draft,current);
        return;
      }
      if (!current()) return;
      messages.value.push(detail);
      messages.value.sort((a, b) => a.emailId - b.emailId);
    }
    expanded.value = new Set([...expanded.value, message.emailId]);
    activeTarget.value = message.emailId;
    await nextTick();
    if (!current()) return;
    const editor = currentComposer();
    if (draft) {
      try { await editor.openDraft(draft); }
      catch (e) { if (current()) closed(); throw e; }
    }
    else if (await editor[forward ? "openForward" : all ? "openReplyAll" : "openReply"](message) === false) {
      if (current()) closed();
      return;
    }
    await nextTick();
    if (!current()) return;
    activeDraft.value=draft?.draftId ?? null;
    scroll.value
      ?.querySelector(".send.inline")
      ?.scrollIntoView({ block: "nearest" });
  } catch (e) {
    if (draft) throw e;
    if (request === viewEpoch)
      error.value = e.message || "Could not open reply.";
  } finally {
    if (request === viewEpoch) switching = false;
  }
}
async function toggle(message) {
  expandRun++;expanding.value=false;
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
let pendingDelivery=null;
watch([()=>feedback.deliveredReply,activeTarget],([delivery,target],[previous])=>{
  if (delivery && delivery!==previous && messages.value.some(message=>message.emailId===delivery.emailId)) pendingDelivery=delivery;
  if (pendingDelivery && !target) {
    if (messages.value.some(message=>message.emailId===pendingDelivery.emailId)) load();
    pendingDelivery=null;
  }
});
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
function rememberMessage(event) {
  const card=event.target.closest?.('[data-reader-message],[data-draft-anchor]');
  if (card) currentMessage.value=Number(card.dataset.readerMessage ?? card.dataset.draftAnchor);
}
function canNavigate(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode===229 ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || loading.value || switching) return false;
  const target=event.target;
  if (target!==document.body && target!==document.documentElement && !reader.value?.contains(target)) return false;
  if (event.composedPath().some(node=>node.isContentEditable || node.matches?.(
    'input,textarea,select,.send,[role="textbox"],[role="combobox"],[role="menu"],[role="dialog"]'))) return false;
  return !readerObscured();
}
function readerObscured() {
  return [...document.querySelectorAll('dialog[open],.el-overlay,.el-dropdown__popper,.compose-format-popup,.send[aria-modal="true"]')]
    .some(node=>node.getClientRects().length);
}
async function stepMessage(event,step) {
  if (!canNavigate(event) || !messages.value.length) return;
  const origin=currentMessage.value;
  let index=messages.value.findIndex(message=>message.emailId===origin);
  if (index<0) index=step>0 ? -1 : messages.value.length;
  event.preventDefault();
  const current=readerCurrent(), focused=document.activeElement;
  // A deep-linked draft can insert a single anchor before the loaded pages.
  // Fetch the intervening history before calling two messages adjacent.
  while (origin!=null && hasMore.value && (origin<firstPagedId || (origin===firstPagedId && step<0))) {
    if (expanding.value || !(await load(true))) return;
    if (!current() || document.activeElement!==focused || currentMessage.value!==origin ||
        switching || loading.value || readerObscured()) return;
    index=messages.value.findIndex(message=>message.emailId===origin);
  }
  const next=messages.value[index+step];
  if (!next) return;
  const button=scroll.value?.querySelector('[data-reader-message="'+next.emailId+'"] .message-toggle');
  button?.focus({preventScroll:true});
  button?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function keydown(event) {
  if (event.key==="n" || event.key==="p") return stepMessage(event,event.key==="n" ? 1 : -1);
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
  printController?.abort();
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
  padding: 20px 16px 80px;
  min-height: 0;
}
.thread-heading {display:flex;align-items:flex-start;gap:8px;margin-bottom:16px;}
.thread-heading h1 {flex:1;min-width:0;}
.heading-actions {display:flex;align-items:center}
.heading-actions :is(button,a) {display:grid;place-items:center;height:40px;width:40px;border-radius:50%;color:var(--regular-text-color);cursor:pointer}
.heading-actions :is(button,a):is(:hover,:focus-visible) {background:var(--mail-hover)}
.heading-actions button:disabled {opacity:.45;cursor:default}
h1 {
  font-size: 24px;
  font-weight: 400;
  margin: 0 0 0 56px;
  overflow-wrap: anywhere;
  line-height: 1.4;
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
  flex-wrap: wrap;
  gap: 8px;
  margin: 24px 0 0 56px;
}
.bottom-replies .el-button {
  height:36px;
  margin:0;
  padding:0 16px;
  border:1px solid var(--secondary-text-color);
  border-radius:18px;
  color:var(--regular-text-color);
  background:transparent;
  font:500 14px/20px Arial,sans-serif;
}
.bottom-replies .el-button:is(:hover,:focus-visible){background:var(--mail-hover);color:var(--el-text-color-primary)}
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
  .thread-heading {flex-wrap:wrap;}
  .bottom-replies {
    margin-left: 0;
  }
  .conversation-toolbar {
    gap: 4px;
  }
}
</style>
