<template>
  <section class="trash-view" aria-label="Trash">
    <div class="mail-toolbar">
      <button
        v-if="messageId"
        class="mail-icon"
        data-tip="Back to Trash"
        aria-label="Back to Trash"
        @click="back"
      >
        <Icon icon="material-symbols:arrow-back" width="20" />
      </button>
      <label v-else class="check-target" data-tip="Select">
        <input
          type="checkbox"
          aria-label="Select messages"
          :checked="messages.length > 0 && selected.length === messages.length"
          :indeterminate="
            selected.length > 0 && selected.length < messages.length
          "
          :disabled="busy || loading"
          @change="
            selected = $event.target.checked
              ? messages.map((m) => m.emailId)
              : []
          "
        />
      </label>
      <template v-if="targets.length">
        <button
          v-if="canDelete"
          class="mail-icon"
          data-tip="Restore"
          aria-label="Restore messages"
          :disabled="busy"
          @click="act('restore', targets)"
        >
          <Icon icon="material-symbols:restore-from-trash-outline" width="20" />
        </button>
        <button
          v-if="canDelete"
          class="toolbar-text"
          :disabled="busy"
          @click="act('purge', targets)"
        >
          Delete forever
        </button>
      </template>
      <button
        v-else-if="!messageId"
        class="mail-icon"
        data-tip="Refresh"
        aria-label="Refresh Trash"
        :disabled="busy || loading"
        @click="load()"
      >
        <Icon icon="material-symbols:refresh" width="20" />
      </button>
      <template v-if="!messageId">
        <span class="total">{{
          messages.length
            ? offset +
              1 +
              "–" +
              (offset + messages.length) +
              (nextCursor ? "" : " of " + (offset + messages.length))
            : ""
        }}</span>
        <button
          class="mail-icon"
          aria-label="Previous page"
          data-tip="Previous page"
          :disabled="!history.length || busy || loading"
          @click="previous"
        >
          <Icon icon="material-symbols:chevron-left" width="20" />
        </button>
        <button
          class="mail-icon"
          aria-label="Next page"
          data-tip="Next page"
          :disabled="!nextCursor || busy || loading"
          @click="next"
        >
          <Icon icon="material-symbols:chevron-right" width="20" />
        </button>
      </template>
    </div>
    <p v-if="error" role="alert">
      {{ error }} <button class="text-button" @click="reload">Retry</button>
    </p>
    <div v-if="messageId" class="trash-detail">
      <article v-if="detail">
        <h1>{{ detail.subject || "(no subject)" }}</h1>
        <div class="sender">
          <span class="initial">{{
            (detail.name || detail.sendEmail || "?")[0].toUpperCase()
          }}</span>
          <div>
            <strong>{{ detail.name || detail.sendEmail }}</strong>
            <span v-if="detail.name">&lt;{{ detail.sendEmail }}&gt;</span>
            <div>
              to {{ addresses(detail.recipient).join(", ") || detail.toEmail }}
            </div>
          </div>
          <time>{{ formatDetailDate(detail.createTime) }}</time>
        </div>
        <div class="message-body">
          <ShadowHtml
            v-if="detail.content"
            :key="detail.emailId"
            :html="detail.content"
            :resolve-file-url="inlineFileURL"
          />
          <pre v-else>{{ detail.text }}</pre>
          <button
            v-for="file in detail.attList"
            :key="file.attId"
            class="attachment"
            @click="download(file)"
          >
            <Icon icon="material-symbols:attach-file" width="18" />{{
              file.filename
            }}
          </button>
        </div>
      </article>
      <p v-else-if="loading" role="status">Loading message…</p>
    </div>
    <div v-else class="trash-list">
      <div class="retention">
        Messages that have been in Trash more than 30 days will be automatically
        deleted.
        <button
          v-if="canDelete && messages.length && !search.query"
          class="text-button"
          :disabled="busy || loading"
          @click="emptyTrash"
        >
          Empty Trash now
        </button>
      </div>
      <MailRow
        v-for="message in messages"
        :key="message.emailId"
        hide-star
        :participants="message.name || message.sendEmail"
        :subject="message.subject"
        :preview="message.preview"
        :unread="message.unread === 0"
        :selected="selected.includes(message.emailId)"
        :date="mailboxDate(message.createTime)"
        :date-title="formatDetailDate(message.createTime)"
        :open-label="'Open ' + (message.subject || '(no subject)')"
        @open="open(message)"
        @select="toggle(message.emailId)"
      >
        <template v-if="canDelete" #actions>
          <button
            class="mail-icon"
            data-tip="Restore"
            aria-label="Restore message"
            :disabled="busy"
            @click="act('restore', [message.emailId])"
          >
            <Icon
              icon="material-symbols:restore-from-trash-outline"
              width="20"
            />
          </button>
          <button
            class="mail-icon"
            data-tip="Delete forever"
            aria-label="Delete forever"
            :disabled="busy"
            @click="act('purge', [message.emailId])"
          >
            <Icon icon="material-symbols:delete-forever-outline" width="20" />
          </button>
        </template>
      </MailRow>
      <p v-if="!messages.length && !error" class="empty" role="status">
        {{
          loading
            ? "Loading…"
            : search.query
              ? "No messages match your search."
              : "No conversations in Trash."
        }}
      </p>
    </div>
    <div v-if="notice" class="snackbar" role="status">{{ notice }}</div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import { ElMessageBox } from "element-plus";
import MailRow from "@/components/mail-row/index.vue";
import ShadowHtml from "@/components/shadow-html/index.vue";
import { mailboxDate, formatDetailDate } from "@/utils/day";
import { addresses } from "@/utils/recipients";
import { hasPerm } from "@/perm/perm";
import { useMailSearchStore } from "@/store/mail-search";
import { useAccountStore } from "@/store/account";
import { useMailFeedback } from "@/store/mail-feedback";
import { useEmailStore } from "@/store/email";
import http from "@/axios";

const route = useRoute(),
  router = useRouter(),
  search = useMailSearchStore(),
  mail = useEmailStore();
const account = useAccountStore();
const mailbox = computed(() =>
  account.currentAccount.allReceive ? undefined : account.currentAccountId,
);
const canDelete = computed(() => hasPerm("email:delete"));
const messages = ref([]),
  selected = ref([]),
  history = ref([]),
  nextCursor = ref(null);
const detail = ref(null),
  busy = ref(false),
  loading = ref(false),
  error = ref(""),
  notice = ref("");
const messageId = computed(() => Number(route.query.message) || 0);
const targets = computed(() =>
  messageId.value
    ? detail.value
      ? [detail.value.emailId]
      : []
    : selected.value,
);
const offset = computed(() => history.value.length * 50);
let revision = 0,
  noticeTimer,
  disposed = false;
function list(cursor, q, accountId = mailbox.value) {
  return http.get("/v1/messages", {
    params: {
      folder: "trash",
      accountId,
      cursor: cursor || undefined,
      limit: 50,
      q,
    },
  });
}
async function load(pages = history.value) {
  const request = ++revision;
  error.value = "";
  loading.value = true;
  try {
    let page = await list(pages.at(-1), search.query);
    while (!page.messages.length && pages.length && request === revision) {
      pages = pages.slice(0, -1);
      page = await list(pages.at(-1), search.query);
    }
    if (request !== revision) return;
    history.value = pages;
    messages.value = page.messages;
    nextCursor.value = page.nextCursor;
    selected.value = [];
  } catch (e) {
    if (request === revision)
      error.value = e.message || "Could not load Trash.";
  } finally {
    if (request === revision) loading.value = false;
  }
}
function next() {
  load([...history.value, nextCursor.value]);
}
function previous() {
  load(history.value.slice(0, -1));
}
function toggle(id) {
  if (busy.value || loading.value) return;
  selected.value = selected.value.includes(id)
    ? selected.value.filter((n) => n !== id)
    : [...selected.value, id];
}
function open(message) {
  router.push({ path: route.path, query: { message: message.emailId } });
}
function back() {
  if (window.history.state.back === route.path) router.back();
  else router.replace({ path: route.path });
}
async function loadDetail(id) {
  const request = ++revision;
  detail.value = null;
  loading.value = true;
  error.value = "";
  try {
    const value = await http.get("/v1/messages/" + id);
    if (request === revision) {
      if (
        !value.trashedAt ||
        (mailbox.value && value.accountId !== mailbox.value)
      )
        throw new Error("This message is no longer in Trash.");
      detail.value = value;
    }
  } catch (e) {
    if (request === revision)
      error.value = e.message || "Could not open this message.";
  } finally {
    if (request === revision) loading.value = false;
  }
}
function reload() {
  return messageId.value ? loadDetail(messageId.value) : load();
}
watch(() => useMailFeedback().restored, reload);
watch(messageId, reload, { immediate: true });
watch([() => search.query, mailbox], () => {
  history.value = [];
  messages.value = [];
  selected.value = [];
  nextCursor.value = null;
  if (messageId.value) back();
  else load([]);
});
function notify(message) {
  clearTimeout(noticeTimer);
  notice.value = message;
  noticeTimer = setTimeout(() => {
    notice.value = "";
  }, 5000);
}
async function emptyTrash() {
  await act("purge", null);
}
async function act(action, ids) {
  if (busy.value || !canDelete.value) return;
  busy.value = true;
  error.value = "";
  let changed = 0;
  const scope = mailbox.value;
  const scopeLabel = scope
    ? account.currentAccount.email
    : "all your mailboxes";
  const request = revision;
  try {
    if (!ids) {
      ids = [];
      let cursor;
      do {
        const page = await list(cursor, "", scope);
        if (request !== revision) return;
        ids.push(...page.messages.map((m) => m.emailId));
        cursor = page.nextCursor;
      } while (cursor && !disposed);
    }
    if (!ids.length || disposed) return;
    const count = ids.length === 1 ? "1 message" : ids.length + " messages";
    if (action === "purge")
      await ElMessageBox.confirm(
        "This will permanently delete " +
          count +
          " and any attachments" +
          (scopeLabel ? " from " + scopeLabel : "") +
          ".",
        "Delete forever?",
        {
          confirmButtonText: "Delete forever",
          cancelButtonText: "Cancel",
          confirmButtonClass: "delete-confirm",
          customClass: "mail-confirm",
          showClose: false,
          autofocus: false,
        },
      );
    if (disposed || request !== revision) return;
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      await http.post("/v1/messages/" + action, { emailIds: batch });
      changed += batch.length;
    }
    if (!disposed)
      notify(
        count + (action === "purge" ? " permanently deleted." : " restored."),
      );
  } catch (e) {
    if (e !== "cancel" && e !== "close") {
      error.value =
        (changed ? changed + " messages updated. " : "") +
        (e.message || "Could not update Trash.");
    }
  } finally {
    if (changed) {
      mail.conversationRevision++;
      if (!disposed) {
        const originalError = error.value;
        if (messageId.value) back();
        else await load();
        if (originalError) error.value = originalError;
      }
    }
    busy.value = false;
  }
}
function attachmentBlob(file) {
  return http.get("/v1/attachments/" + file.attId + "/content", {
    responseType: "blob",
  });
}
async function inlineFileURL(key) {
  const file = detail.value?.attList?.find((file) => file.key === key);
  if (!file) throw new Error("Attachment unavailable.");
  return URL.createObjectURL(await attachmentBlob(file));
}
async function download(file) {
  try {
    const blob = await attachmentBlob(file);
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = file.filename || "attachment";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    error.value = e.message || "Could not download attachment.";
  }
}
onBeforeUnmount(() => {
  disposed = true;
  revision++;
  clearTimeout(noticeTimer);
});
</script>
<style scoped>
.trash-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--el-text-color-primary);
}
.trash-list,
.trash-detail {
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.retention,
.empty {
  padding: 14px 16px;
  text-align: center;
  font-size: 14px;
  line-height: 20px;
}
.retention {
  box-shadow: inset 0 -1px var(--light-border-color);
  color: var(--regular-text-color);
}
.empty {
  margin: 0;
}
.text-button,
.toolbar-text {
  color: var(--el-color-primary);
  font:
    500 14px/20px Arial,
    sans-serif;
  cursor: pointer;
}
.text-button:hover {
  text-decoration: underline;
}
.retention .text-button {
  margin-left: 8px;
}
.toolbar-text {
  color: var(--regular-text-color);
  padding: 8px 12px;
  border-radius: 18px;
}
.toolbar-text:hover,
.attachment:hover {
  background: var(--mail-hover);
}
.trash-detail {
  padding: 20px 32px;
}
h1 {
  font-size: 24px;
  font-weight: 400;
  margin: 0 0 24px 52px;
  overflow-wrap: anywhere;
}
.sender {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 13px;
  color: var(--regular-text-color);
  overflow-wrap: anywhere;
}
.sender strong {
  color: var(--el-text-color-primary);
}
.initial {
  display: grid;
  place-items: center;
  flex: 0 0 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--mail-selected);
}
.sender time {
  margin-left: auto;
  font-size: 12px;
}
.message-body {
  margin: 16px 0 0 52px;
}
pre {
  font:
    14px/1.6 Arial,
    sans-serif;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.attachment {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--light-border-color);
  border-radius: 8px;
  cursor: pointer;
}
[role="alert"] {
  padding: 0 16px;
  font-size: 14px;
}
.snackbar {
  position: fixed;
  z-index: 50;
  bottom: 24px;
  left: 24px;
  padding: 14px 24px;
  border-radius: 6px;
  background: #303134;
  color: white;
  box-shadow: 0 2px 6px #0003;
  font-size: 14px;
}
@media (max-width: 767px) {
  .trash-detail {
    padding: 16px;
  }
  h1,
  .message-body {
    margin-left: 0;
  }
  .retention {
    padding: 10px 16px;
  }
  .snackbar {
    bottom: 16px;
    left: 16px;
  }
}
</style>
