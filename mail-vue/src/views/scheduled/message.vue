<template>
  <article class="scheduled-message">
    <div class="subject-line">
      <h1>{{ row.subject || "(no subject)" }}</h1>
      <RouterLink v-for="label in labels" :key="label.id" :to="{name:'label',params:{labelId:label.id}}"
        class="schedule-label" :style="labelStyle(label)" :title="label.name">{{ label.name }}</RouterLink>
      <MailImportance :reason="row.importanceReason" :disabled="busy || !canCancel" @toggle="$emit('importance',$event)" />
    </div>
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
              <dt>{{ name }}:</dt>
              <dd>{{ value }}</dd>
            </template>
          </dl>
        </el-popover>
      </div>
      <time v-if="deliveryTime" class="delivery-time" :datetime="deliveryTime.toISOString()">{{ deliveryDate }}</time>
      <button class="mail-icon message-star" :aria-pressed="Boolean(row.starred)"
        :aria-label="row.starred ? 'Unstar message' : 'Star message'" :data-tip="row.starred ? 'Unstar' : 'Star'"
        :disabled="busy || !canCancel" @click="$emit('star')">
        <Icon :icon="row.starred ? 'material-symbols:star' : 'material-symbols:star-outline'" width="20" />
      </button>
    </div>
    <div class="message-content">
      <div class="timing" role="status">
        <span class="timing-status">
          <Icon icon="material-symbols:schedule-send-outline" width="20" aria-hidden="true" />
          {{ status }}
        </span>
        <button v-if="canCancel" :disabled="busy" @click="$emit('cancel')">
          {{ row.state === "scheduled" ? "Cancel send" : "Return to Drafts" }}
        </button>
      </div>
      <p v-if="row.error" role="alert">{{ row.error }}</p>
      <template v-if="detail">
        <ShadowHtml
          v-if="detail.content && !detail.plainText"
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
import {labelStyle} from "@/components/mail-labels/colors";
import {formatDetailDate} from "@/utils/day";
import { computed, ref } from "vue";
import { Icon } from "@iconify/vue";
import http from "@/axios";
import MailImportance from "@/components/mail-importance.vue";
import ShadowHtml from "@/components/shadow-html/index.vue";
import FilePreview from "@/components/mail-attachments/preview.vue";
const props = defineProps({
  row: Object,
  labels: Array,
  detail: Object,
  shortRecipients: String,
  status: String,
  canCancel: Boolean,
  busy: Boolean,
});
const emit = defineEmits(["cancel", "error", "star", "importance"]);
const preview = ref(null);
const files = computed(
  () => props.detail?.attachments?.filter((f) => !f.contentId) || [],
);
const sender = computed(
  () => props.row.senderName || props.row.senderEmail || "me",
);
const deliveryTime = computed(() => {
  if (!props.row.sendAt) return null;
  const date = new Date(props.row.sendAt * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
});
const deliveryDate = computed(() => deliveryTime.value ? formatDetailDate(deliveryTime.value) : "");
const fields = computed(() =>
  [
    ["from", props.row.senderEmail],
    ["to", props.row.recipients.join(", ")],
    ["cc", props.row.cc?.join(", ")],
    ["bcc", props.row.bcc?.join(", ")],
    ["date", deliveryDate.value],
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
  padding: 16px 16px 32px;
  overflow-wrap: anywhere;
}
.subject-line { display:flex; align-items:center; gap:8px; margin:0 0 24px 56px; }
.message-star {flex-shrink:0;}
.delivery-time {font:12px/20px Arial,sans-serif;color:var(--secondary-text-color);text-align:end;}
.sender-info {flex:1;}
.message-star[aria-pressed="true"] { color:#e9a900; }
.schedule-label {padding:1px 6px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:4px;font-size:12px;color:inherit;background:var(--base-fill)}
h1 {
  margin:0;
  font:
    400 24px/32px Arial,
    sans-serif;
}
.sender {
  display: flex;
  gap: 16px;
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
  margin: 16px 0 0 56px;
}
.timing {
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  min-height:36px;
  margin:0 0 16px;
  border-radius:4px;
  background:var(--scheduled-banner);
  color:var(--secondary-text-color);
  font:12px/18px Arial,sans-serif;
}
.timing-status {display:flex;align-items:center;min-height:36px;min-width:0;}
.timing-status svg {flex:none;margin:8px 16px;}
.timing button {
  margin-inline-start:auto;
  min-height:36px;
  padding:8px 16px;
  border-radius:4px;
  color:var(--scheduled-action);
  font:500 14px/20px Arial,sans-serif;
  white-space:nowrap;
  cursor:pointer;
}
.timing button:is(:hover,:focus-visible) {
  background:color-mix(in srgb,var(--scheduled-action) 8%,transparent);
}
.timing button:active {background:color-mix(in srgb,var(--scheduled-action) 16%,transparent);}
.timing button:disabled {opacity:.55;cursor:default;}
.file button:hover {background:var(--mail-hover);}
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
  .subject-line,
  .message-content {
    margin-left: 0;
  }
  .address {
    display: none;
  }
  .sender {
    display:grid;
    grid-template-columns:40px minmax(0,1fr) auto;
    column-gap:12px;
    row-gap:2px;
  }
  .avatar {grid-area:1/1/3/2;}
  .sender-info {grid-area:1/2;}
  .message-star {grid-area:1/3;}
  .delivery-time {grid-area:2/2/3/4;text-align:start;}
  .timing-status svg {margin-inline:10px;}

}
</style>
