<template>
  <section class="conversation-view" aria-label="Conversation">
    <div class="conversation-toolbar">
      <button aria-label="Back to mail" @click="back">
        <Icon icon="material-symbols:arrow-back" width="22" />
      </button>
      <button
        :disabled="busy || !messages.length"
        aria-label="Mark conversation read"
        @click="mutate('read')"
      >
        <Icon icon="material-symbols:mark-email-read-outline" width="22" />
      </button>
      <button
        :disabled="busy || !messages.length"
        aria-label="Mark conversation unread"
        @click="mutate('read', { unread: 0 })"
      >
        <Icon icon="material-symbols:mark-email-unread-outline" width="22" />
      </button>
      <button
        v-perm="'email:delete'"
        :disabled="busy || !messages.length"
        aria-label="Delete conversation"
        @click="remove"
      >
        <Icon icon="material-symbols:delete-outline" width="22" />
      </button>
      <span>{{ total }} message{{ total === 1 ? "" : "s" }}</span>
    </div>
    <div ref="scroll" class="conversation-body">
      <h1>{{ messages.at(-1)?.subject || "Conversation" }}</h1>
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
      <ConversationMessage
        v-for="message in messages"
        :key="message.emailId"
        :message="message"
        :before-delete="save"
        :expanded="expanded.has(message.emailId)"
        @toggle="toggle(message)"
        @reply="reply(message, $event)"
        @changed="Object.assign(message, $event)"
        @deleted="deleted(message)"
      >
        <MessageComposer
          v-if="activeTarget === message.emailId"
          ref="composer"
          inline
          @sent="sent"
          @closed="activeTarget = 0"
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
      </div>
    </div>
  </section>
</template>
<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import {
  useRoute,
  useRouter,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
} from "vue-router";
import { Icon } from "@iconify/vue";
import { ElMessageBox } from "element-plus";
import ConversationMessage from "@/components/conversation-message/index.vue";
import MessageComposer from "@/components/message-composer/index.vue";
import {
  conversationMessages,
  conversationAction,
} from "@/request/conversation";
import { useEmailStore } from "@/store/email";
import { useAccountStore } from "@/store/account";
const accountStore = useAccountStore();
const route = useRoute(),
  router = useRouter(),
  store = useEmailStore();
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
let generation = 0,
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
    if (older && scroll.value)
      scroll.value.scrollTop += scroll.value.scrollHeight - prior;
    if (!older) {
      const draft = store.pendingReplyDraft;
      if (draft && Number(draft.emailId) === anchor) {
        handledReply = true;
        store.pendingReplyDraft = null;
        await reply({ emailId: anchor }, false, draft);
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
  () => route.query.emailId,
  () => {
    handledReply = false;
    activeTarget.value = 0;
    expanded.value = new Set();
    messages.value = [];
    load();
  },
  { immediate: true },
);
async function reply(message, all, draft) {
  if (switching) return;
  switching = true;
  try {
    if (!(await save())) return;
    // A restored draft may target a message older than the currently loaded page.
    if (!messages.value.some((item) => item.emailId === message.emailId)) {
      const detail = await store.ensureDetail(message);
      messages.value.push(detail);
      messages.value.sort((a, b) => a.emailId - b.emailId);
    }
    expanded.value = new Set([...expanded.value, message.emailId]);
    activeTarget.value = message.emailId;
    await nextTick();
    const editor = currentComposer();
    if (draft) editor.openDraft(draft);
    else await editor[all ? "openReplyAll" : "openReply"](message);
    await nextTick();
    scroll.value
      ?.querySelector(".send.inline")
      ?.scrollIntoView({ block: "nearest" });
  } catch (e) {
    error.value = e.message || "Could not open reply.";
  } finally {
    switching = false;
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
      route.query.folder === "sent"
        ? "/sent"
        : route.query.folder === "starred"
          ? "/starred"
          : "/inbox",
    );
}
async function mutate(action, extra = {}) {
  if (busy.value || !(await save())) return;
  busy.value = true;
  try {
    await conversationAction(action, [Number(route.query.emailId)], extra);
    store.conversationRevision++;
    if (action === "delete") back();
    else
      messages.value.forEach((message) => {
        message.unread = extra.unread ?? 1;
        if (store.detailMap[message.emailId])
          store.detailMap[message.emailId].unread = message.unread;
      });
  } catch (e) {
    error.value = e.message || "Could not update conversation.";
  } finally {
    busy.value = false;
  }
}
async function remove() {
  try {
    await ElMessageBox.confirm(
      `Delete 1 conversation containing ${total.value} messages?`,
      {
        confirmButtonText: "Delete",
        cancelButtonText: "Cancel",
        type: "warning",
      },
    );
    await mutate("delete");
  } catch {}
}
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
    event.key === "Escape" &&
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
  generation++;
  window.removeEventListener("keydown", keydown);
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>
<style scoped>
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
