<template>
  <article
    class="message-card"
    :class="{ collapsed: !expanded }"
    :aria-label="`Message from ${message.name || message.sendEmail}`"
  >
    <div class="message-header">
      <SenderAvatar :name="message.name" :address="message.sendEmail"/>
      <button type="button" class="message-toggle" :aria-expanded="expanded" :aria-describedby="description"
        :aria-label="(expanded ? 'Collapse' : 'Expand')+' message from '+sender" @click="$emit('toggle')">
        <strong dir="auto">{{sender}}</strong>
        <span v-if="expanded && message.name && message.sendEmail && message.name!==message.sendEmail" class="address" dir="ltr">&lt;{{message.sendEmail}}&gt;</span>
      </button>
      <div v-if="expanded" class="conversation-recipients"><MessageRecipients :message="email"/></div>
      <div v-else :id="snippetId" class="snippet" dir="auto">{{message.listText}}</div>
      <div class="message-actions" @click.self="$emit('toggle')">
        <time v-if="stamp" :id="dateId" :datetime="stamp.iso" :data-tip="stamp.full" @click="$emit('toggle')">
          <span class="full-time">{{stamp.label}}</span><span class="short-time">{{stamp.compact}}</span>
        </time>
        <button
          class="icon-button message-star"
          :data-tip="message.isStar ? 'Unstar' : 'Star'"
          :aria-pressed="Boolean(message.isStar)"
          :aria-label="message.isStar ? 'Unstar message' : 'Star message'"
          @click="star"
        >
          <Icon
            :icon="
              message.isStar
                ? 'material-symbols:star'
                : 'material-symbols:star-outline'
            "
            width="20"
          />
        </button>
        <button v-if="expanded && !replying" v-perm="'email:send'" class="icon-button" :aria-label="replyAll ? 'Reply all' : 'Reply to message'" :data-tip="replyAll ? 'Reply all' : 'Reply'" @click="$emit('reply',replyAll)"><Icon :icon="replyAll ? 'material-symbols:reply-all' : 'material-symbols:reply'" width="20" /></button>
        <el-dropdown v-if="expanded" trigger="click" placement="bottom-end" :offset="0" :show-arrow="false" popper-class="mail-action-menu message-action-menu">
          <button class="icon-button" aria-label="More message options" data-tip="More"><Icon icon="material-symbols:more-vert" width="20" /></button>
          <template #dropdown><el-dropdown-menu>
            <el-dropdown-item v-perm="'email:send'" @click="$emit('reply',false)"><Icon icon="material-symbols:reply"/>Reply</el-dropdown-item>
            <el-dropdown-item v-if="hasReplyAll(email,account.ownAddresses)" v-perm="'email:send'" @click="$emit('reply',true)"><Icon icon="material-symbols:reply-all"/>Reply all</el-dropdown-item>
            <el-dropdown-item v-perm="'email:send'" @click="$emit('forward')"><Icon icon="material-symbols:forward"/>Forward</el-dropdown-item>
            <el-dropdown-item divided v-perm="'email:delete'" @click="remove"><Icon icon="material-symbols:delete-outline"/>Delete</el-dropdown-item>
            <el-dropdown-item @click="read"><Icon :icon="message.unread===0?'material-symbols:mark-email-read-outline':'material-symbols:mark-email-unread-outline'"/>{{ message.unread===0 ? 'Mark as read' : 'Mark as unread' }}</el-dropdown-item>
            <el-dropdown-item divided @click="$emit('print',message)"><Icon icon="material-symbols:print-outline"/>Print</el-dropdown-item>
            <el-dropdown-item v-if="email?.sendEmail && !email.scheduledDraftId" @click="filters.fromMessage(email.sendEmail)"><Icon icon="material-symbols:filter-alt-outline"/>Filter messages like these</el-dropdown-item>
              <DownloadMessage :message="detail"/>
          </el-dropdown-menu></template>
        </el-dropdown>
      </div>
    </div>
    <template v-if="expanded">
      <p v-if="loading" role="status">Loading message…</p>
      <p v-if="error" role="alert">
        {{ error }} <button @click="load">Retry</button>
      </p>
      <div
        v-if="email.status >= 3 && email.status <= 5"
        class="delivery-status"
        role="status"
      >
        {{
          email.status === 3
            ? "Delivery failed"
            : email.status === 4
              ? "Recipient complained"
              : "Delivery delayed"
        }}
      </div>
      <MessageContent class="message-html" :key="email.emailId" :html="email.content" :text="email.text" :subject="email.subject" :reply="!!(email.inReplyTo || email.replyToEmailId)"/>
      <AttachmentTiles class="attachments" :files="attachedFiles" @error="showFileError"/>
    </template>
    <slot />
  </article>
</template>
<script setup>
import { useMailFeedback } from "@/store/mail-feedback";
const feedback = useMailFeedback();
import { ref, computed, watch, useId } from "vue";
import { Icon } from "@iconify/vue";
import { ElMessage } from "element-plus";
import SenderAvatar from "@/components/sender-avatar.vue";
import {useMessageFilters} from '@/store/message-filters';
const filters=useMessageFilters();
import DownloadMessage from "@/components/download-message.vue";
import AttachmentTiles from "@/components/mail-attachments/tiles.vue";
import MessageContent from "@/components/shadow-html/message-content.vue";
import { useEmailStore } from "@/store/email";
import {useUserStore} from '@/store/user';
import {hasReplyAll} from '@/utils/recipients';
import {useAccountStore} from '@/store/account';
import MessageRecipients from "@/components/message-recipients.vue";
import { useUiStore } from "@/store/ui";
import { emailRead, emailDelete } from "@/request/email";
import { starAdd, starCancel } from "@/request/star";
import { downloadablePart } from "@/utils/private-files";
import { readerTimestamp } from "@/utils/day";
const props = defineProps({
  message: Object,
  expanded: Boolean,
  now: Date,
  beforeDelete: Function,
  replying: Boolean,
});
const emit = defineEmits(["forward","toggle", "reply", "deleted", "changed", "print"]);
const account=useAccountStore(),store = useEmailStore(),
  ui = useUiStore();
const detail = ref(null),
  loading = ref(false),
  error = ref(""),
  busy = ref(false);
function showFileError(message) { ElMessage.error(message); }
const email = computed(() => detail.value || props.message);
const sender=computed(()=>props.message.name || props.message.sendEmail || 'Unknown sender');
const stamp=computed(()=>readerTimestamp(props.message.createTime,props.now));
const dateId=useId(),snippetId=useId();
const description=computed(()=>[stamp.value && dateId,!props.expanded && props.message.listText && snippetId].filter(Boolean).join(' ') || undefined);
const user=useUserStore();
const replyAll=computed(()=>user.defaultReplyAll && hasReplyAll(email.value,account.ownAddresses));
const attachedFiles=computed(()=>(email.value.attList||[]).filter(downloadablePart));
async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    detail.value = await store.ensureDetail(props.message);
    if (props.message.unread === 0) {
      await emailRead([props.message.emailId]);
      emit("changed", { unread: 1 });
      store.conversationRevision++;
    }
  } catch (e) {
    error.value = e.message || "Could not load message.";
  } finally {
    loading.value = false;
  }
}
watch(
  () => props.expanded,
  (expanded) => {
    if (expanded && !detail.value) load();
  },
  { immediate: true },
);
async function action(fn) {
  if (busy.value) return;
  busy.value = true;
  try {
    await fn();
    store.conversationRevision++;
  } catch (e) {
    ElMessage.error(e.message || "Could not update message.");
  } finally {
    busy.value = false;
  }
}
function star() {
  return action(async () => {
    await (props.message.isStar ? starCancel : starAdd)(props.message.emailId);
    emit("changed", { isStar: props.message.isStar ? 0 : 1 });
  });
}
function read() {
  return action(async () => {
    const unread = props.message.unread === 0 ? 1 : 0;
    await emailRead([props.message.emailId], unread);
    if (store.detailMap[props.message.emailId])
      store.detailMap[props.message.emailId].unread = unread;
    emit("changed", { unread });
  });
}
async function remove() {
  if (props.beforeDelete && !(await props.beforeDelete())) return;
  await action(async () => {
    await emailDelete(props.message.emailId);
    feedback.trashed([props.message.emailId], 1, "message");
    delete store.detailMap[props.message.emailId];
    emit("deleted");
  });
}
</script>
<style scoped>
.message-card {
  container:reader-message / inline-size;
  --avatar-size:40px;
  --header-gap:16px;
  padding:20px 0;
  min-width:0;
}
.message-card + .message-card {border-top:1px solid var(--light-border-color)}
.message-header {
  position:relative;
  display:grid;
  grid-template-columns:var(--avatar-size) minmax(0,1fr) auto;
  grid-template-rows:20px 20px;
  column-gap:var(--header-gap);
  align-items:center;
  min-width:0;
  font-family:Arial,Helvetica,sans-serif;
}
.avatar {grid-area:1 / 1 / 3 / 2}
.message-toggle {
  grid-area:1 / 2;height:20px;
  display:flex;align-items:baseline;gap:4px;min-width:0;
  text-align:start;cursor:pointer;color:var(--el-text-color-primary);font:14px/20px Arial,sans-serif;
}
.message-toggle strong,.address,.snippet {overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.message-toggle strong {flex:0 1 auto;min-width:0}
.message-toggle::after {content:'';position:absolute;inset:0;z-index:1}
.collapsed .message-toggle::after {inset:-20px 0}
.message-toggle:focus-visible {outline:0}
.message-toggle:focus-visible::after {outline:2px solid var(--el-color-primary);outline-offset:-2px;border-radius:4px}
.address,time {font:12px/20px Arial,sans-serif;color:var(--regular-text-color)}
.address {flex:0 1 auto}
.snippet,.conversation-recipients {grid-area:2 / 2 / 3 / -1;min-width:0;text-align:start}
.snippet {color:var(--regular-text-color);font:13px/20px Arial,sans-serif}
.conversation-recipients {grid-column:2;display:flex;align-items:center;height:20px;width:fit-content;max-width:100%;position:relative;z-index:2;line-height:20px}
.message-actions {
  grid-area:1 / 3;display:flex;align-items:center;justify-content:end;
  position:relative;z-index:2;height:20px;color:var(--regular-text-color);
}
time {cursor:pointer;margin-inline-end:10px;white-space:nowrap}
.short-time {display:none}
.icon-button {width:40px;height:40px;border-radius:50%;display:inline-grid;place-items:center;flex-shrink:0;color:inherit;cursor:pointer}
.message-star[aria-pressed="true"] {color:#e9a900}
.icon-button:is(:hover,:focus-visible) {background:var(--mail-hover)}
.message-html,.attachments {margin-inline-start:calc(var(--avatar-size) + var(--header-gap))}
.message-html {margin-top:8px}
.delivery-status {padding:12px;color:var(--el-color-warning)}
@container reader-message (max-width:650px){.full-time{display:none}.short-time{display:inline}}
@media(max-width:767px){
  .message-card{--avatar-size:32px;--header-gap:8px;padding-block:16px}
  .collapsed .message-toggle::after{inset:-16px 0}
  .message-html,.attachments{margin-inline-start:0}
  .address{display:none}
  .icon-button{width:32px;height:36px}
  time{margin-inline-end:4px}
}
</style>
