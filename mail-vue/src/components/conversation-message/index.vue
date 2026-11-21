<template>
  <article
    class="message-card"
    :class="{ collapsed: !expanded }"
    :aria-label="`Message from ${message.name || message.sendEmail}`"
  >
    <div class="message-header">
      <div class="avatar" aria-hidden="true">
        {{ (message.name || message.sendEmail || "?")[0].toUpperCase() }}
      </div>
      <button
        class="message-toggle"
        :aria-expanded="expanded"
        @click="$emit('toggle')"
      >
        <span
          ><strong>{{ message.name || message.sendEmail }}</strong>
          <span class="address">&lt;{{ message.sendEmail }}&gt;</span></span
        >
        <span v-if="!expanded" class="snippet">{{ message.listText }}</span>
        <time>{{ formatDetailDate(message.createTime) }}</time>
      </button>
      <button
        class="icon-button"
        :data-tip="message.isStar ? 'Unstar' : 'Star'"
        :aria-label="message.isStar ? 'Unstar message' : 'Star message'"
        @click="star"
      >
        <Icon
          :icon="
            message.isStar
              ? 'fluent-color:star-16'
              : 'material-symbols:star-outline'
          "
          width="20"
        />
      </button>
      <button v-if="expanded && !replying" v-perm="'email:send'" class="icon-button" aria-label="Reply to message" data-tip="Reply" @click="$emit('reply',false)"><Icon icon="material-symbols:reply" width="20" /></button>
      <el-dropdown v-if="expanded" trigger="click" placement="bottom-end" :offset="0" :show-arrow="false" popper-class="mail-action-menu message-action-menu">
        <button class="icon-button" aria-label="More message options" data-tip="More"><Icon icon="material-symbols:more-vert" width="20" /></button>
        <template #dropdown><el-dropdown-menu>
          <el-dropdown-item v-perm="'email:send'" @click="$emit('reply',false)"><Icon icon="material-symbols:reply"/>Reply</el-dropdown-item>
          <el-dropdown-item v-if="hasReplyAll(email,account.ownAddresses)" v-perm="'email:send'" @click="$emit('reply',true)"><Icon icon="material-symbols:reply-all"/>Reply all</el-dropdown-item>
          <el-dropdown-item v-perm="'email:send'" @click="ui.writerRef.openForward(message)"><Icon icon="material-symbols:forward"/>Forward</el-dropdown-item>
          <el-dropdown-item divided v-perm="'email:delete'" @click="remove"><Icon icon="material-symbols:delete-outline"/>Delete</el-dropdown-item>
          <el-dropdown-item @click="read"><Icon :icon="message.unread===0?'material-symbols:mark-email-read-outline':'material-symbols:mark-email-unread-outline'"/>{{ message.unread===0 ? 'Mark as read' : 'Mark as unread' }}</el-dropdown-item>
          <el-dropdown-item divided @click="$emit('print',message)"><Icon icon="material-symbols:print-outline"/>Print</el-dropdown-item>
        </el-dropdown-menu></template>
      </el-dropdown>
    </div>
    <template v-if="expanded">
      <div class="conversation-recipients"><MessageRecipients :message="email"/></div>
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
      <ShadowHtml class="message-html" v-if="email.content" :html="email.content" />
      <pre v-else class="message-text">{{ email.text }}</pre>
      <AttachmentTiles class="attachments" :files="attachedFiles" @error="showFileError"/>
    </template>
    <slot />
  </article>
</template>
<script setup>
import { useMailFeedback } from "@/store/mail-feedback";
const feedback = useMailFeedback();
import { ref, computed, watch } from "vue";
import { Icon } from "@iconify/vue";
import { ElMessage } from "element-plus";
import AttachmentTiles from "@/components/mail-attachments/tiles.vue";
import ShadowHtml from "@/components/shadow-html/index.vue";
import { useEmailStore } from "@/store/email";
import {hasReplyAll} from '@/utils/recipients';
import {useAccountStore} from '@/store/account';
import MessageRecipients from "@/components/message-recipients.vue";
import { useUiStore } from "@/store/ui";
import { emailRead, emailDelete } from "@/request/email";
import { starAdd, starCancel } from "@/request/star";
import { downloadablePart } from "@/utils/private-files";
import { formatDetailDate } from "@/utils/day";
const props = defineProps({
  message: Object,
  expanded: Boolean,
  beforeDelete: Function,
  replying: Boolean,
});
const emit = defineEmits(["toggle", "reply", "deleted", "changed", "print"]);
const account=useAccountStore(),store = useEmailStore(),
  ui = useUiStore();
const detail = ref(null),
  loading = ref(false),
  error = ref(""),
  busy = ref(false);
function showFileError(message) { ElMessage.error(message); }
const email = computed(() => detail.value || props.message);
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
  padding: 20px 0;
  border-bottom: 1px solid var(--light-border-color);
  min-width: 0;
}
.message-card.collapsed {
  padding: 14px 0;
}
.message-header {
  display: flex;
  gap: 12px;
  align-items: center;
  min-width: 0;
}
.avatar {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--mail-compose);
  color: var(--mail-on-compose);
  font-size: 18px;
}
.message-toggle {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 12px;
  align-items: center;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font-size: 14px;
}
.message-toggle > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
}
.address,
time {
  font-size: 12px;
  color: var(--regular-text-color);
}
time {
  margin-left: auto;
  flex-shrink: 0;
}
.snippet {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--regular-text-color);
  flex: 1;
}
.icon-button { width:40px; height:40px; border-radius:50%; display:inline-grid; place-items:center; flex-shrink:0;
  color: var(--regular-text-color);
  cursor: pointer;
}
.icon-button:is(:hover,:focus-visible) { background:var(--mail-hover); }
.conversation-recipients {display:block;margin:0 0 18px 48px;max-width:calc(100% - 48px)}
.message-html { margin-left:48px; }
.message-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 14px/1.6 Arial;
  padding-left: 48px;
}
.attachments {margin-inline-start:48px}
.delivery-status {
  padding: 12px;
  color: var(--el-color-warning);
}
@media (max-width: 767px) {
  .message-html { margin-left:0; }
  .message-toggle {
    flex-wrap: wrap;
    gap: 4px;
  }
  .message-toggle > span:first-child {
    max-width: 100%;
  }
  .address {
    display: none;
  }
  time {
    margin: 0;
    width: 100%;
    font-size: 11px;
  }
  .snippet {
    display: none;
  }
  .attachments {
    margin-left: 0;
  }

  .message-text {
    padding-left: 0;
  }

}
</style>
