<template>
  <article class="scheduled-message">
    <h1>{{ row.subject || "(no subject)" }}</h1>
    <div class="sender">
      <span class="avatar" aria-hidden="true">{{
        sender.charAt(0).toUpperCase()
      }}</span>
      <div class="sender-info">
        <strong>{{ sender }}</strong>
        <span class="address">&lt;{{ row.senderEmail }}&gt;</span>
        <el-popover
          trigger="click"
          placement="bottom-start"
          :show-arrow="false"
          :width="330"
          popper-class="recipient-popper"
        >
          <template #reference>
            <button
              class="to"
              aria-label="Show details"
              data-tip="Show details"
            >
              to {{ shortRecipients }}
              <Icon icon="material-symbols:arrow-drop-down" width="16" />
            </button>
          </template>
          <dl class="details">
            <template v-for="[name, value] in fields" :key="name">
              <dt>{{ name }}</dt>
              <dd>{{ value }}</dd>
            </template>
          </dl>
        </el-popover>
      </div>
    </div>
    <div class="message-content">
      <div class="timing" role="status">
        <Icon icon="material-symbols:schedule-send-outline" width="20" />
        <span>{{ status }}</span>
        <button v-if="canCancel" :disabled="busy" @click="$emit('cancel')">
          {{ row.state === "scheduled" ? "Cancel send" : "Return to Drafts" }}
        </button>
      </div>
      <p v-if="row.error" role="alert">{{ row.error }}</p>
      <template v-if="detail">
        <ShadowHtml
          v-if="detail.content"
          :key="detail.draftId"
          :html="detail.content"
          :file-key="inlineKey"
          :resolve-file-url="fileURL"
        />
        <pre v-else>{{ detail.text || row.preview }}</pre>
        <section v-if="files.length" class="files" aria-label="Attachments">
          <strong
            >{{ files.length }}
            {{ files.length === 1 ? "attachment" : "attachments" }}</strong
          >
          <div class="file-list">
            <div v-for="file in files" :key="file.attachmentId" class="file">
              <button
                :aria-label="'Preview ' + file.filename"
                @click="preview = file"
              >
                <Icon
                  icon="material-symbols:description-outline"
                  width="19"
                />{{ file.filename }}
              </button>
              <button
                :aria-label="'Download ' + file.filename"
                data-tip="Download"
                @click="download(file)"
              >
                <Icon icon="material-symbols:download" width="18" />
              </button>
            </div>
          </div>
        </section>
      </template>
    </div>
    <FilePreview v-if="preview" :file="preview" @close="preview = null" />
  </article>
</template>
<script setup>
import { computed, ref } from "vue";
import { Icon } from "@iconify/vue";
import http from "@/axios";
import ShadowHtml from "@/components/shadow-html/index.vue";
import FilePreview from "@/components/mail-attachments/preview.vue";
const props = defineProps({
  row: Object,
  detail: Object,
  shortRecipients: String,
  status: String,
  canCancel: Boolean,
  busy: Boolean,
});
const emit = defineEmits(["cancel", "error"]);
const preview = ref(null);
const files = computed(
  () => props.detail?.attachments?.filter((f) => !f.contentId) || [],
);
const sender = computed(
  () => props.row.senderName || props.row.senderEmail || "me",
);
const fields = computed(() =>
  [
    ["from", props.row.senderEmail],
    ["to", props.row.recipients.join(", ")],
    ["cc", props.row.cc?.join(", ")],
    ["bcc", props.row.bcc?.join(", ")],
    ["subject", props.row.subject],
  ].filter(([, value]) => value),
);
function inlineKey(src) {
  if (!src?.startsWith("cid:")) return null;
  return props.detail?.attachments?.find(
    (file) => file.contentId?.replace(/^<|>$/g, "") === src.slice(4),
  )?.attachmentId;
}
async function fileURL(id) {
  return URL.createObjectURL(
    await http.get(
      "/v1/drafts/attachments/" + encodeURIComponent(id) + "/content",
      { responseType: "blob", noMsg: true },
    ),
  );
}
async function download(file) {
  try {
    const url = await fileURL(file.attachmentId);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    emit("error", error.message || "Could not download attachment.");
  }
}
</script>
<style scoped>
.scheduled-message {
  padding: 16px 32px 32px;
  overflow-wrap: anywhere;
}
h1 {
  margin: 0 0 24px 52px;
  font:
    400 24px/32px Arial,
    sans-serif;
}
.sender {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--mail-selected);
  color: var(--regular-text-color);
  display: grid;
  place-items: center;
  font-size: 18px;
  flex: none;
}
.sender-info {
  min-width: 0;
  line-height: 20px;
}
.address,
.to {
  font-size: 12px;
  color: var(--regular-text-color);
}
.to {
  display: flex;
  align-items: center;
  max-width: 100%;
  cursor: pointer;
}
.details {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  margin: 4px;
  font:
    13px/18px Arial,
    sans-serif;
}
.details dt {
  text-align: right;
  color: var(--regular-text-color);
}
.details dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.message-content {
  margin: 16px 0 0 52px;
}
.timing {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 18px;
  padding: 10px 14px;
  border-radius: 4px;
  background: var(--mail-read);
  color: var(--regular-text-color);
  font-size: 14px;
}
.timing svg {
  flex: none;
}
.timing button {
  margin-left: auto;
  color: var(--el-color-primary);
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 4px;
}
.timing button:hover,
.file button:hover {
  background: var(--mail-hover);
}
pre {
  white-space: pre-wrap;
  font:
    14px/1.5 Arial,
    sans-serif;
}
.files {
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--light-border-color);
  font-size: 13px;
}
.file-list {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.file {
  display: inline-flex;
  max-width: 100%;
  border: 1px solid var(--light-border-color);
  border-radius: 8px;
  overflow: hidden;
}
.file button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  color: inherit;
  cursor: pointer;
  overflow-wrap: anywhere;
  min-width: 0;
}
@media (max-width: 767px) {
  .scheduled-message {
    padding: 12px 16px 76px;
  }
  h1,
  .message-content {
    margin-left: 0;
  }
  .address {
    display: none;
  }
  .timing {
    padding: 8px;
    gap: 6px;
  }
}
</style>
