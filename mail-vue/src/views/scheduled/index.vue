<template>
  <section class="scheduled-view" aria-label="Scheduled messages">
    <div class="mail-toolbar">
      <button
        v-if="item"
        class="mail-icon"
        data-tip="Back"
        aria-label="Back to Scheduled"
        @click="item = null; error = ''"
      >
        <Icon icon="material-symbols:arrow-back" width="20" /></button
      ><button
        v-else
        class="mail-icon"
        aria-label="Refresh scheduled mail"
        data-tip="Refresh"
        @click="load"
      >
        <Icon icon="material-symbols:refresh" width="20" /></button
      ><span class="total">{{ rows.length }} scheduled</span>
    </div>
    <p v-if="error" role="alert">
      {{ error }} <button @click="item ? open(item) : load()">Retry</button>
    </p>
    <p v-if="listError" role="alert">{{ listError }} <button @click="load">Retry</button></p>
    <article v-if="item">
      <h1>{{ item.subject }}</h1>
      <div class="timing">
        <Icon
          icon="material-symbols:schedule-send-outline"
          width="20"
        /><span>{{ status(item) }}</span
        ><button v-if="canCancel(item)" :disabled="busy" @click="cancel(item)">
          {{ item.state === "scheduled" ? "Cancel send" : "Return to Drafts" }}
        </button>
      </div>
      <p>To {{ item.recipients.join(", ") }}</p>
      <p v-if="item.error" role="status">{{ item.error }}</p>
      <div v-if="detail">
        <p v-if="detail.cc?.length">Cc {{ detail.cc.join(", ") }}</p>
        <p v-if="detail.bcc?.length">Bcc {{ detail.bcc.join(", ") }}</p>
        <ShadowHtml
          v-if="detail.content"
          :key="detail.draftId"
          :html="detail.content"
          :file-key="inlineKey"
          :resolve-file-url="fileURL"
        />
        <pre v-else>{{ detail.text || item.preview }}</pre>
        <button
          v-for="file in detail.attachments.filter((f) => !f.contentId)"
          :key="file.attachmentId"
          class="file"
          @click="download(file)"
        >
          <Icon icon="material-symbols:download" width="16" />{{
            file.filename
          }}
        </button>
      </div>
    </article>
    <template v-else
      ><p v-if="!rows.length && !error" class="empty">
        {{ loading ? "Loading…" : "No scheduled messages." }}
      </p>
      <button
        v-for="row in rows"
        :key="row.draftId"
        class="scheduled-row"
        @click="open(row)"
      >
        <Icon icon="material-symbols:schedule-send-outline" width="19" /><span
          class="who"
          >To: {{ row.recipients.join(", ") }}</span
        ><span class="subject"
          >{{ row.subject }} <span>– {{ row.preview }}</span></span
        ><time>{{
          row.state === "scheduled" ? date(row.sendAt) : status(row)
        }}</time>
      </button></template
    >
  </section>
</template>
<script setup>
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { Icon } from "@iconify/vue";
import { useRouter } from "vue-router";
import http from "@/axios";
import { useAccountStore } from "@/store/account";
import { useMailFeedback } from "@/store/mail-feedback";
import { syncCloudDrafts } from "@/services/cloud-drafts";
import { openSavedDraft } from "@/services/draft-list";
import db from "@/db/db";
import ShadowHtml from "@/components/shadow-html/index.vue";
const account = useAccountStore(),
  router = useRouter(),
  feedback = useMailFeedback();
const scope = computed(() =>
  account.currentAccount.allReceive ? undefined : account.currentAccountId,
);
const rows = ref([]),
  item = ref(null),
  detail = ref(null),
  busy = ref(false),
  loading = ref(false),
  error = ref("");
let generation = 0,
  messageRequest = 0,
  disposed = false;
const date = (t) =>
  new Date(t * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const status = (row) =>
  row.state === "scheduled"
    ? "Scheduled for " + date(row.sendAt)
    : row.state === "schedule_failed"
      ? "Could not send"
      : row.state === "uncertain"
        ? "Delivery uncertain — check Sent"
        : "Sending…";
const canCancel = (row) => ["scheduled", "schedule_failed"].includes(row.state);
function inlineKey(src) {
  if (!src?.startsWith("cid:")) return null;
  return detail.value?.attachments.find(
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
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    error.value = e.message || "Could not download this attachment.";
  }
}
const listError=ref("");
async function load() {
  const request = ++generation;
  loading.value = true;
  listError.value = "";
  try {
    const data = await http.get("/v1/scheduled", {
      params: { accountId: scope.value },
      noMsg: true,
    });
    if (request !== generation) return;
    rows.value = data;
    if (item.value)
      item.value = data.find((m) => m.draftId === item.value.draftId) || null;
  } catch (e) {
    if (request === generation)
      listError.value = e.message || "Could not load Scheduled.";
  } finally {
    if (request === generation) loading.value = false;
  }
}
async function open(row) {
  const request = ++messageRequest;
  item.value = row;
  detail.value = null;
  error.value = "";
  try {
    const data = await http.get("/v1/scheduled/" + row.draftId, {
      noMsg: true,
    });
    if (request === messageRequest && item.value?.draftId === row.draftId)
      detail.value = data;
  } catch (e) {
    if (request === messageRequest && item.value?.draftId === row.draftId)
      error.value = e.message || "Could not open the scheduled message.";
  }
}
async function cancel(row) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const database = db.value,
    mailbox = scope.value;
  try {
    await http.post(
      "/v1/scheduled/" + row.draftId + "/cancel",
      { version: row.version },
      { noMsg: true },
    );
    if (disposed || db.value !== database || scope.value !== mailbox) return;
    item.value = null;
    await load();
    feedback.show("Message returned to Drafts.");
    await syncCloudDrafts();
    const draft = await database.draft
      .where("cloudDraftId")
      .equals(row.draftId)
      .first();
    if (draft && !disposed && db.value === database && scope.value === mailbox)
      await openSavedDraft(draft.draftId, router, "draft");
  } catch (e) {
    if (!disposed) error.value = e.message || "Could not reopen this draft.";
  } finally {
    busy.value = false;
  }
}
watch(
  scope,
  () => {
    item.value = null;
    rows.value = [];
    detail.value = null;
    error.value = "";
    load();
  },
  { immediate: true },
);
const timer = setInterval(() => {
  if (!document.hidden && !busy.value) load();
}, 30000);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  messageRequest++;
  clearInterval(timer);
});
</script>
<style scoped>
.scheduled-view {
  overflow: auto;
}
.empty {
  text-align: center;
  margin: 24px;
}
.scheduled-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--mail-row-height, 40px);
  padding: 0 16px;
  width: 100%;
  background: var(--mail-read);
  box-shadow: inset 0 -1px var(--light-border-color);
  color: inherit;
  text-align: left;
  cursor: pointer;
  font:
    14px Arial,
    sans-serif;
}
.scheduled-row:hover {
  box-shadow: var(--mail-row-shadow);
}
.who {
  width: clamp(100px, 16vw, 200px);
}
.who,
.subject,
time {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.subject {
  flex: 1;
}
.subject span,
time {
  color: var(--regular-text-color);
}
time {
  font-size: 12px;
}
article {
  padding: 16px 32px;
}
h1 {
  font-size: 24px;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.timing {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--mail-read);
  border-radius: 8px;
}
.timing button {
  color: var(--el-color-primary);
  margin-left: auto;
  cursor: pointer;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 14px/1.5 Arial;
}
.file {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  margin: 8px 12px 0 0;
  padding: 8px 12px;
  cursor: pointer;
  border: 1px solid var(--light-border-color);
  color: inherit;
  border-radius: 8px;
}
@media (max-width: 767px) {
  .scheduled-row {
    height: auto;
    min-height: 64px;
    flex-wrap: wrap;
    gap: 4px 8px;
  }
  .scheduled-row .subject {
    order: 2;
    flex-basis: 100%;
  }
  time {
    margin-left: auto;
  }
}
</style>
