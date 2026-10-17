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
    </div>
    <template v-if="expanded">
      <button
        class="recipient-toggle"
        :aria-expanded="recipientsOpen"
        @click="recipientsOpen = !recipientsOpen"
      >
        to {{ addresses(message.recipient).join(", ") || email.toEmail }}
        <Icon icon="material-symbols:expand-more" width="16" />
      </button>
      <div v-if="recipientsOpen" class="recipient-details">
        <div><span>From</span>{{ message.sendEmail }}</div>
        <div><span>To</span>{{ addresses(message.recipient).join(", ") }}</div>
        <div v-if="addresses(message.cc).length">
          <span>Cc</span>{{ addresses(message.cc).join(", ") }}
        </div>
        <div
          v-if="
            message.type === 1 &&
            message.userId === user.user.userId &&
            addresses(message.bcc).length
          "
        >
          <span>Bcc</span>{{ addresses(message.bcc).join(", ") }}
        </div>
        <div><span>Date</span>{{ formatDetailDate(message.createTime) }}</div>
      </div>
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
      <ShadowHtml v-if="email.content" :html="email.content" />
      <pre v-else class="message-text">{{ email.text }}</pre>
      <div v-if="email.attList?.length" class="attachments">
        <button
          v-for="file in email.attList"
          :key="file.attId"
          class="attachment"
          @click="download(file)"
          :aria-label="`Download ${file.filename}`"
        >
          <Icon icon="material-symbols:attach-file" width="22" /><span
            >{{ file.filename
            }}<small>{{ formatBytes(file.size) }}</small></span
          ><Icon icon="material-symbols:download" width="20" />
        </button>
        <button
          v-for="file in images"
          :key="`preview-${file.attId}`"
          class="preview-file"
          @click="preview(file)"
        >
          Preview {{ file.filename }}
        </button>
      </div>
      <div class="message-actions">
        <button v-perm="'email:send'" @click="$emit('reply', false)">
          <Icon icon="material-symbols:reply" width="18" />Reply
        </button>
        <button v-perm="'email:send'" @click="$emit('reply', true)">
          <Icon icon="material-symbols:reply-all" width="18" />Reply all
        </button>
        <button
          v-perm="'email:send'"
          @click="ui.writerRef.openForward(message)"
        >
          Forward
        </button>
        <button @click="read">
          {{ message.unread === 0 ? "Mark read" : "Mark unread" }}
        </button>
        <button v-perm="'email:delete'" @click="remove">Delete message</button>
      </div>
    </template>
    <el-image-viewer
      v-if="previewURL"
      :url-list="[previewURL]"
      @close="closePreview"
    />
    <slot />
  </article>
</template>
<script setup>
import { ref, computed, watch, onUnmounted } from "vue";
import { Icon } from "@iconify/vue";
import { ElMessage, ElMessageBox } from "element-plus";
import ShadowHtml from "@/components/shadow-html/index.vue";
import { useEmailStore } from "@/store/email";
import { useUserStore } from "@/store/user";
import { useUiStore } from "@/store/ui";
import { emailRead, emailDelete } from "@/request/email";
import { starAdd, starCancel } from "@/request/star";
import { privateFileURL } from "@/utils/private-files";
import { formatDetailDate } from "@/utils/day";
import { formatBytes } from "@/utils/file-utils";
import { addresses } from "@/utils/recipients";
const props = defineProps({
  message: Object,
  expanded: Boolean,
  beforeDelete: Function,
});
const emit = defineEmits(["toggle", "reply", "deleted", "changed"]);
const store = useEmailStore(),
  user = useUserStore(),
  ui = useUiStore();
const detail = ref(null),
  loading = ref(false),
  error = ref(""),
  recipientsOpen = ref(false),
  busy = ref(false);
const previewURL = ref("");
const images = computed(() =>
  (email.value.attList || []).filter((file) =>
    /\.(png|jpe?g|webp|gif|jfif)$/i.test(file.filename || ""),
  ),
);
function closePreview() {
  if (previewURL.value) URL.revokeObjectURL(previewURL.value);
  previewURL.value = "";
}
async function preview(file) {
  try {
    closePreview();
    previewURL.value = await privateFileURL(file.key);
  } catch (e) {
    ElMessage.error(e.message);
  }
}
onUnmounted(closePreview);
const email = computed(() => detail.value || props.message);
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
  try {
    await ElMessageBox.confirm("Delete this message?", {
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      type: "warning",
    });
    if (props.beforeDelete && !(await props.beforeDelete())) return;
    await action(async () => {
      await emailDelete(props.message.emailId);
      delete store.detailMap[props.message.emailId];
      emit("deleted");
    });
  } catch {}
}
async function download(file) {
  try {
    const url = await privateFileURL(file.key);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename || "attachment";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) {
    ElMessage.error(e.message);
  }
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
.icon-button {
  color: var(--regular-text-color);
  cursor: pointer;
}
.recipient-toggle {
  margin: 0 0 18px 48px;
  font-size: 12px;
  color: var(--regular-text-color);
  display: flex;
  gap: 4px;
  align-items: center;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.recipient-details {
  padding: 16px;
  margin: 12px 0 24px 48px;
  border: 1px solid var(--light-border-color);
  border-radius: 8px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.recipient-details > div {
  display: flex;
  gap: 12px;
  margin-bottom: 4px;
}
.recipient-details span {
  width: 32px;
  flex-shrink: 0;
  color: var(--regular-text-color);
}
.message-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 14px/1.6 Arial;
  padding-left: 48px;
}
.message-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 20px 0 0 48px;
}
.message-actions button {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 7px 12px;
  color: var(--regular-text-color);
  border: 1px solid var(--light-border-color);
  border-radius: 20px;
}
.message-actions button:hover {
  background: var(--mail-hover);
}
.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 20px 0 0 48px;
}
.attachment {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--light-border-color);
  border-radius: 10px;
  color: inherit;
  cursor: pointer;
  max-width: 100%;
}
.preview-file {
  padding: 8px;
  color: var(--el-color-primary);
  cursor: pointer;
}
.attachment span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.attachment small {
  display: block;
  margin-top: 4px;
  color: var(--regular-text-color);
}
.delivery-status {
  padding: 12px;
  color: var(--el-color-warning);
}
@media (max-width: 767px) {
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
  .message-actions,
  .attachments,
  .recipient-details {
    margin-left: 0;
  }
  .message-actions button {
    font-size: 12px;
    padding: 7px 10px;
  }
  .message-text {
    padding-left: 0;
  }
  .recipient-toggle {
    max-width: calc(100% - 48px);
  }
}
</style>
