<template>
  <article class="scheduled-message">
    <div class="subject-line">
      <h1>{{ row.subject || "(no subject)" }}</h1>
      <RouterLink v-for="label in labels" :key="label.id" :to="{name:'label',params:{labelId:label.id}}"
        class="schedule-label" :style="labelStyle(label)" :title="label.name">{{ label.name }}</RouterLink>
      <MailImportance :reason="row.importanceReason" :disabled="busy || !canCancel" @toggle="$emit('importance',$event)" />
    </div>
    <div v-if="row.wakeAt && !row.inbox" class="reminder">
      <Icon icon="material-symbols:schedule-outline" width="18"/>
      <span>Snoozed until {{ formatDetailDate(row.wakeAt*1000) }}</span>
      <button type="button" :disabled="busy || !canCancel" @click="$emit('unsnooze')">Unsnooze</button>
    </div>
    <div class="sender">
      <ReaderContact v-bind="senderContact" tabindex="-1" class="avatar">{{
        sender.charAt(0).toUpperCase()
      }}</ReaderContact>
      <div class="sender-info">
        <ReaderContact v-bind="senderContact"><strong>{{ sender }}</strong></ReaderContact>
        <span class="address">&lt;{{ row.senderEmail }}&gt;</span>
        <div><MessageDetails :summary="'to '+shortRecipients" :fields="fields"/></div>
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
        <MessageContent :key="detail.draftId" :html="detail.plainText ? '' : detail.content" :text="detail.text || row.preview"
          :subject="detail.subject" :reply="detail.sendType==='reply'" :file-key="inlineKey" :resolve-file-url="fileURL"/>
        <AttachmentTiles :key="detail.draftId" :files="files" @error="$emit('error',$event)"/>
      </template>
    </div>
  </article>
</template>
<script setup>
import MessageDetails from "@/components/message-details.vue";
import {headerAddressText} from "@/utils/recipients";
import ReaderContact from "@/components/reader-contact.vue";
import {labelStyle} from "@/components/mail-labels/colors";
import {formatDetailDate} from "@/utils/day";
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import http from "@/axios";
import MailImportance from "@/components/mail-importance.vue";
import {inlineImageURL} from "@/utils/private-files";
import MessageContent from "@/components/shadow-html/message-content.vue";
import AttachmentTiles from "@/components/mail-attachments/tiles.vue";
const props = defineProps({
  row: Object,
  labels: Array,
  detail: Object,
  shortRecipients: String,
  status: String,
  canCancel: Boolean,
  busy: Boolean,
});
defineEmits(["cancel", "unsnooze", "error", "star", "importance"]);
const files = computed(
  () => props.detail?.attachments?.filter((f) => !f.contentId) || [],
);
const senderContact=computed(()=>({address:props.row.senderEmail,name:props.row.senderName,accountId:props.row.accountId,
  mailboxEmail:props.row.mailboxName===undefined ? undefined : props.row.senderEmail,mailboxName:props.row.mailboxName}));
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
    ["from", headerAddressText({name:props.row.senderName,address:props.row.senderEmail})],
    ["to", props.row.recipients.join(", ")],
    ["cc", props.row.cc?.join(", ")],
    ["bcc", props.row.bcc?.join(", ")],
    ["date", deliveryDate.value],
    ["subject", props.row.subject || "(no subject)"],
  ].filter(([, value]) => value),
);
function inlineKey(src) {
  if (!src?.startsWith("cid:")) return null;
  return props.detail?.attachments?.find(
    (file) => file.contentId?.replace(/^<|>$/g, "") === src.slice(4),
  )?.attachmentId;
}
async function fileURL(id) {
  return inlineImageURL(
    await http.get(
      "/v1/drafts/attachments/" + encodeURIComponent(id) + "/content",
      { responseType: "blob", noMsg: true },
    ),
  );
}
</script>
<style scoped>
.reminder {display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 16px;margin-bottom:12px;border-radius:8px;background:var(--mail-read);font-size:14px}
.reminder button {margin-inline-start:auto;padding:4px 8px;cursor:pointer;color:var(--el-color-primary);font:inherit}

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
.address {
  font-size: 12px;
  color: var(--regular-text-color);
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
pre {
  white-space: pre-wrap;
  font:
    14px/1.5 Arial,
    sans-serif;
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
