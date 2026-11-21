<template>
  <section ref="root" class="trash-view" aria-label="Trash">
    <FolderFilters v-if="!messageId" folder="trash" :account-id="mailbox" />
    <div class="mail-toolbar" :class="{'has-selection':selected.length && !messageId}">
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
      <el-dropdown v-if="!messageId" trigger="click" placement="bottom-start" :show-arrow="false" popper-class="mail-action-menu" @command="selectGroup">
        <button class="mail-icon select-options" aria-label="Selection options" data-tip="Select"><Icon icon="material-symbols:arrow-drop-down" width="16"/></button>
        <template #dropdown><el-dropdown-menu><el-dropdown-item v-for="option in ['All','None','Read','Unread']" :key="option" :command="option">{{ option }}</el-dropdown-item></el-dropdown-menu></template>
      </el-dropdown>
      <template v-if="targets.length">
        <button v-if="canDelete" class="toolbar-text" :disabled="busy" @click="act('purge', targets)">Delete forever</button>
        <span v-if="canDelete" class="toolbar-divider" aria-hidden="true"></span>
        <button class="mail-icon" :data-tip="readLabel(targetUnread)" :aria-label="readLabel(targetUnread)" :disabled="busy || loading"
          @click="setRead(targets,targetUnread)">
          <Icon :icon="readIcon(targetUnread)" width="20"/>
        </button>
        <MovePicker trash v-if="canDelete" :ids="targets" :disabled="busy || loading" @move="moveTo"/>
        <el-dropdown trigger="click" placement="bottom-start" :show-arrow="false" popper-class="mail-action-menu">
          <button ref="moreButton" class="mail-icon" aria-label="More Trash actions" data-tip="More" :disabled="busy || loading"><Icon icon="material-symbols:more-vert" width="20"/></button>
          <template #dropdown><el-dropdown-menu>
            <el-dropdown-item @click="trashPicker?.show()">Label as</el-dropdown-item>
            <el-dropdown-item v-if="canDelete" @click="act('restore',targets)">Restore to previous location</el-dropdown-item>
            <template v-if="!messageId">
              <el-dropdown-item class="compact-trash-pager" :disabled="!history.length || busy || loading" @click="previous">Previous page</el-dropdown-item>
              <el-dropdown-item class="compact-trash-pager" :disabled="!nextCursor || busy || loading" @click="next">Next page</el-dropdown-item>
            </template>
          </el-dropdown-menu></template>
        </el-dropdown>
        <LabelPicker v-if="moreButton" ref="trashPicker" trash external :reference="moreButton" :rows="labelRows"
          :disabled="busy || loading" @apply="setLabels"/>
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
      <el-dropdown v-if="!messageId && !targets.length" trigger="click" :show-arrow="false" popper-class="mail-action-menu">
        <button class="mail-icon" aria-label="More Trash options" data-tip="More"><Icon icon="material-symbols:more-vert" width="20"/></button>
        <template #dropdown><el-dropdown-menu><el-dropdown-item @click="search.filters={}; search.query=''; load([])">Clear filters and refresh</el-dropdown-item></el-dropdown-menu></template>
      </el-dropdown>
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
          class="mail-icon pager"
          aria-label="Previous page"
          data-tip="Previous page"
          :disabled="!history.length || busy || loading"
          @click="previous"
        >
          <Icon icon="material-symbols:chevron-left" width="20" />
        </button>
        <button
          class="mail-icon pager"
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
        <div class="trash-subject">
          <h1>{{detail.subject || "(no subject)"}}</h1>
          <span class="trash-folder-chip">
            <button type="button" aria-label="Show all messages in Trash" data-tip="Show all messages in Trash" @click="showTrash">Trash</button>
            <button v-if="canDelete" type="button" aria-label="Remove Trash label" data-tip="Remove Trash label"
              :disabled="busy || loading" @click="act('restore',[detail.emailId])">×</button>
          </span>
          <span v-for="label in rowLabels(detail,true)" :key="label.id" class="trash-label" :style="labelStyle(label)">{{label.name}}</span>
        </div>
        <div class="sender">
          <span class="initial" aria-hidden="true">{{(detail.name || detail.sendEmail || "?")[0].toUpperCase()}}</span>
          <div class="sender-info">
            <div class="sender-name"><strong>{{detail.name || detail.sendEmail}}</strong>
              <span v-if="detail.name && detail.name!==detail.sendEmail">&lt;{{detail.sendEmail}}&gt;</span>
            </div>
            <MessageRecipients :message="detail"/>
          </div>
          <time>{{formatDetailDate(detail.createTime)}}</time>
        </div>
        <div class="message-body">
          <ShadowHtml
            v-if="detail.content"
            :key="detail.emailId"
            :html="detail.content"
            :resolve-file-url="inlineFileURL"
          />
          <pre v-else>{{ detail.text }}</pre>
          <AttachmentTiles :key="detail.emailId" :files="(detail.attList || []).filter(downloadablePart)" @error="error=$event"/>
        </div>
      </article>
      <p v-else-if="loading" role="status">Loading message…</p>
    </div>
    <div v-else class="trash-list">
      <div class="retention">
        Messages that have been in Trash more than 30 days will be automatically
        deleted.
        <button
          v-if="canDelete && messages.length && !search.query && !filtered"
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
        :data-message-id="message.emailId"
        hide-star
        trash
        :participants="message.name || message.sendEmail"
        :subject="message.subject"
        :labels="rowLabels(message)"
        :attachments="message.attachments" :attachment-count="message.attachmentCount"
        :preview="message.preview"
        :unread="message.unread === 0"
        :selected="selected.includes(message.emailId)"
        :date="mailboxDate(message.createTime)"
        :date-title="formatDetailDate(message.createTime)"
        :open-label="'Open ' + (message.subject || '(no subject)')"
        @open="open(message)"
        @select="toggle(message.emailId)"
      >
        <template #actions>
          <button class="mail-icon" :data-tip="readLabel(message.unread===0)" :aria-label="readLabel(message.unread===0)" :disabled="busy || loading"
            @click="setRead([message.emailId],message.unread===0)">
            <Icon :icon="readIcon(message.unread===0)" width="20"/>
          </button>
          <button
            class="mail-icon"
            v-if="canDelete"
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
            v-if="canDelete"
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
            : search.query || filtered
              ? "No messages match your search."
              : "No conversations in Trash."
        }}
      </p>
    </div>
    <div v-if="notice" class="snackbar" role="status">{{ notice }}</div>
  </section>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import { ElMessageBox } from "element-plus";
import LabelPicker from "@/components/mail-labels/picker.vue";
import {labelStyle} from "@/components/mail-labels/colors";
import MovePicker from "@/components/mail-labels/move.vue";
import {useMailLabels} from "@/store/mail-labels";
import FolderFilters from "@/components/mail-folder-filters.vue";
import MailRow from "@/components/mail-row/index.vue";
import AttachmentTiles from "@/components/mail-attachments/tiles.vue";
import {downloadablePart} from "@/utils/private-files";
import ShadowHtml from "@/components/shadow-html/index.vue";
import { mailboxDate, formatDetailDate } from "@/utils/day";
import MessageRecipients from "@/components/message-recipients.vue";
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
const root=ref();
const account = useAccountStore();
const labels = useMailLabels();
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
const moreButton=ref(),trashPicker=ref();
const labelRows=computed(()=>(messageId.value ? [detail.value].filter(Boolean) : messages.value.filter(m=>selected.value.includes(m.emailId)))
  .map(m=>({lastEmailId:m.emailId,labelIds:m.labelIds})));
function rowLabels(message,reader=false) {
  return labels.items.filter(label=>message.labelIds?.includes(label.id) && (reader || label.messages!=="hide"));
}
function updateLabels(ids,{add,remove}) {
  for (const message of [...messages.value, detail.value]) {
    if (message && ids.includes(message.emailId)) {
      message.labelIds=[...new Set([...(message.labelIds || []).filter(id=>!remove.includes(id)),...add])];
    }
  }
}
async function setLabels(ops,ids) {
  if (busy.value || loading.value || !ids.length) return;
  busy.value=true;
  const request=revision;
  try {
    await http.post("/v1/messages/trash-labels",{emailIds:ids,...ops});
    mail.conversationRevision++;
    if (!disposed && revision===request) { updateLabels(ids,ops); notify("Labels updated."); }
  } catch(e) {
    if (!disposed && revision===request) error.value=e.message || "Could not update labels.";
  } finally {
    busy.value=false;
    await nextTick();
    if (!disposed && revision===request && document.activeElement===document.body) moreButton.value?.focus();
  }
}
watch(()=>labels.applied, change=>{
  if (change?.trash) updateLabels(change.anchors,{add:[change.labelId],remove:[]});
});
const targetUnread=computed(()=>messageId.value ? detail.value?.unread===0 : messages.value.some(m=>selected.value.includes(m.emailId) && m.unread===0));
const readIcon=unread=>unread ? 'material-symbols:drafts-outline' : 'material-symbols:mail-outline';
const readLabel=unread=>unread ? 'Mark as read' : 'Mark as unread';
async function reloadAfterRemoval(index) {
  const expected=revision+1;
  await load();
  await nextTick();
  if (disposed || expected!==revision || !root.value) return;
  const active=document.activeElement;
  if (active && active!==document.body && active.getClientRects().length) return;
  const buttons=root.value.querySelectorAll('.conversation-open');
  const next=buttons[Math.min(Math.max(0,index),buttons.length-1)];
  (next || root.value.querySelector('.select-options'))?.focus();
}
async function setRead(ids,read) {
  if (busy.value || loading.value || !ids.length) return;
  busy.value=true;
  const request=revision;
  try {
    await http.post('/v1/messages/trash-read',{emailIds:ids,read});
    mail.conversationRevision++;
    if (disposed || request!==revision) return;
    if (detail.value && ids.includes(detail.value.emailId)) {
      detail.value.unread=Number(read);
      if (!read) back();
    } else if (search.filters.isUnread && read) await reloadAfterRemoval(messages.value.findIndex(m=>ids.includes(m.emailId)));
    else for (const message of messages.value) if (ids.includes(message.emailId)) message.unread=Number(read);
  } catch(e) {
    if (!disposed && request===revision) error.value=e.message || 'Could not update read status.';
  } finally {busy.value=false;}
}
function moveTo({labelId},ids) {
  const name=labelId ? labels.items.find(item=>item.id===labelId)?.name : 'Inbox';
  if (name) return act('move-from-trash',ids,{labelId,name});
}
const filtered=computed(()=>Object.keys(search.filters).length>0);
function selectGroup(option) {
  if (busy.value || loading.value) return;
  selected.value=messages.value.filter(m=>option==='All' || (option==='Read' && m.unread!==0) || (option==='Unread' && m.unread===0)).map(m=>m.emailId);
}
const offset = computed(() => history.value.length * 50);
let returnFocus;
let revision = 0,
  noticeTimer,
  disposed = false;
function list(cursor, q, accountId = mailbox.value, filters = search.filters) {
  return http.get("/v1/messages", {
    params: {
      ...filters, folder: "trash",
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
    if (returnFocus) {
      await nextTick();
      if (request===revision && !messageId.value && returnFocus) {
        const {id,scope}=returnFocus;
        returnFocus=null;
        if (scope===mailbox.value && (!document.activeElement || document.activeElement===document.body)) {
          const row=root.value?.querySelector('[data-message-id="'+id+'"] .conversation-open');
          (row || root.value?.querySelector('.select-options'))?.focus();
        }
      }
    }
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
  returnFocus=null;
  router.push({ path: route.path, query: { message: message.emailId } });
}
function showTrash() {
  history.value=[];
  if (search.query || filtered.value) search.$patch({query:"",filters:{}});
  else back();
}
function back() {
  if (messageId.value) returnFocus={id:messageId.value,scope:mailbox.value};
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
      if (value.unread===0) {
        await http.post('/v1/messages/trash-read',{emailIds:[id],read:true});
        mail.conversationRevision++;
        if (request===revision) detail.value.unread=1;
      }
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
watch(()=>labels.moved,change=>{
  if(!change?.trash || change.path!==route.fullPath)return;
  if(messageId.value && change.ids.includes(messageId.value))back();
  else if(!messageId.value)reloadAfterRemoval(messages.value.findIndex(m=>change.ids.includes(m.emailId)));
});
watch(() => useMailFeedback().restored, reload);
watch(messageId, reload, { immediate: true });
watch([() => search.query, () => search.filters, mailbox], () => {
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
async function act(action, ids, destination) {
  if (busy.value || !canDelete.value) return;
  busy.value = true;
  error.value = "";
  let changed = 0;
  const scope = mailbox.value;
  const scopeLabel = scope
    ? account.currentAccount.email
    : "all your mailboxes";
  const request = revision;
  const selectedIndex = ids?.length ? messages.value.findIndex(message=>ids.includes(message.emailId)) : 0;
  try {
    if (!ids) {
      ids = [];
      let cursor;
      do {
        const page = await list(cursor, "", scope, {});
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
      await http.post("/v1/messages/" + action, { emailIds: batch, ...(destination ? {labelId:destination.labelId} : {}) });
      changed += batch.length;
    }
    if (!disposed && request===revision)
      notify(
        count + (destination ? " moved to " + destination.name + "." : action === "purge" ? " permanently deleted." : " restored."),
      );
  } catch (e) {
    if (!disposed && request===revision && e !== "cancel" && e !== "close") {
      error.value =
        (changed ? changed + " messages updated. " : "") +
        (e.message || "Could not update Trash.");
    }
  } finally {
    if (changed) {
      mail.conversationRevision++;
      if (!disposed && request===revision) {
        const originalError = error.value;
        if (messageId.value) back();
        else await reloadAfterRemoval(selectedIndex);
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
:global(.mail-action-menu .compact-trash-pager) { display:none; }
.trash-label { display:inline-block; max-width:100%; padding:1px 5px; border-radius:4px; background:var(--mail-hover); font:500 12px/18px Arial,sans-serif; vertical-align:middle; overflow-wrap:anywhere; }
@media (max-width:600px) {
  :global(.mail-action-menu .compact-trash-pager) { display:flex; }
  .has-selection .pager,.has-selection .total { display:none; }
}
.toolbar-divider { height:20px; border-left:1px solid var(--light-border-color); margin:0 6px; }
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
.toolbar-text:hover {
  background: var(--mail-hover);
}
.trash-detail {
  padding: 16px 24px;
}
.trash-subject { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:0 0 24px 56px; }
h1 { margin:0 6px 0 0; min-width:0; font:400 22px/28px Arial,sans-serif; overflow-wrap:anywhere; }
.trash-folder-chip { display:inline-flex; border-radius:4px; background:var(--light-border-color); }
.trash-folder-chip button { padding:0 4px; font:12px/18px Arial,sans-serif; color:var(--regular-text-color); cursor:pointer; border-radius:inherit; }
.trash-folder-chip button+button { padding:0 3px; }
.trash-folder-chip button:is(:hover,:focus-visible) { background:var(--mail-hover); color:var(--el-text-color-primary); }
.sender { display:flex; gap:16px; align-items:flex-start; min-width:0; color:var(--regular-text-color); }
.sender-info { flex:1; min-width:0; }
.sender-name { font:12px/20px Arial,sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sender-name strong { font-size:14px; }
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
  margin: 16px 0 0 56px;
}
pre {
  font:
    14px/1.6 Arial,
    sans-serif;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
  .trash-subject,
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
