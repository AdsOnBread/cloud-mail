<template>
  <section class="draft-list" aria-label="Drafts">
    <div class="mail-toolbar">
      <label class="check-target" data-tip="Select"
        ><input
          type="checkbox"
          aria-label="Select drafts"
          :checked="page.length > 0 && selected.length === page.length"
          :indeterminate="selected.length > 0 && selected.length < page.length"
          @change="
            selected = $event.target.checked ? page.map((d) => d.draftId) : []
          "
      /></label>
      <button
        v-if="selected.length"
        class="mail-icon"
        data-tip="Discard drafts"
        aria-label="Discard selected drafts"
        :disabled="busy"
        @click="discard(selected)"
      >
        <Icon icon="material-symbols:delete-outline" width="20" />
      </button>
      <button
        v-else
        class="mail-icon"
        data-tip="Refresh"
        aria-label="Refresh drafts"
        :disabled="busy"
        @click="refresh"
      >
        <Icon icon="material-symbols:refresh" width="20" />
      </button>
      <span class="total">{{
        filtered.length
          ? offset + 1 + "–" + (offset + page.length) + " of " + filtered.length
          : ""
      }}</span>
      <button
        class="mail-icon"
        data-tip="Previous page"
        aria-label="Previous page"
        :disabled="!offset"
        @click="offset -= 50"
      >
        <Icon icon="material-symbols:chevron-left" width="20" />
      </button>
      <button
        class="mail-icon"
        data-tip="Next page"
        aria-label="Next page"
        :disabled="offset + page.length >= filtered.length"
        @click="offset += 50"
      >
        <Icon icon="material-symbols:chevron-right" width="20" />
      </button>
    </div>
    <p v-if="error || drafts.listError" role="alert">
      {{ error || drafts.listError }} <button @click="refresh">Retry</button>
    </p>
    <div class="draft-scroll">
      <MailRow
        v-for="draft in page"
        :key="draft.draftId"
        draft-only can-star-draft
        :starred="draft.starred" :busy="busy" @star="toggleStar(draft)"
        :draft-count="1"
        :participants="draft.recipients"
        :subject="draft.subject"
        :labels="labels.items.filter(label=>draft.labelIds?.includes(label.id) && label.messages!=='hide')"
        :attachment-count="draft.hasFiles ? 1 : 0"
        :preview="draft.preview"
        :date="mailboxDate(draft.lastDate)"
        :date-title="formatDetailDate(draft.lastDate)"
        :open-label="`Open draft: ${draft.subject || '(no subject)'}`"
        :selected="selected.includes(draft.draftId)"
        @select="toggle(draft.draftId)"
        @open="open(draft.draftId)"
      >
        <template #actions
          ><button
            class="mail-icon"
            data-tip="Discard draft"
            aria-label="Discard draft"
            :disabled="busy"
            @click="discard([draft.draftId])"
          >
            <Icon icon="material-symbols:delete-outline" width="20" /></button
        ></template>
      </MailRow>
      <p v-if="!filtered.length && !drafts.listError">
        {{ search.query ? "No drafts match your search." : "No saved drafts." }}
      </p>
    </div>
  </section>
</template>
<script setup>
import {useMailLabels} from "@/store/mail-labels";
import { computed, onActivated, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import { useMailFeedback } from "@/store/mail-feedback";
import {useUiStore} from "@/store/ui";
import { userDraftStore, starInOpenEditor } from "@/store/draft";
import { useMailSearchStore } from "@/store/mail-search";
import { draftSession, discardDrafts, saveLocalDraft, syncCloudDrafts } from "@/services/cloud-drafts";
import { openSavedDraft, readSavedDraft } from "@/services/draft-list";
import { mailboxDate, formatDetailDate } from "@/utils/day";
import MailRow from "@/components/mail-row/index.vue";
defineOptions({ name: "draft" });
const feedback = useMailFeedback(), ui = useUiStore();
const drafts = userDraftStore(),
  search = useMailSearchStore(),
  router = useRouter();
const labels=useMailLabels();
const selected = ref([]),
  offset = ref(0),
  error = ref(""),
  busy = ref(false);
const filtered = computed(() => {
  const query = search.query.toLowerCase();
  return drafts.items.filter(
    (draft) =>
      !query ||
      [draft.subject, draft.recipients, draft.preview].some((value) =>
        value.toLowerCase().includes(query),
      ),
  );
});
const page = computed(() =>
  filtered.value.slice(offset.value, offset.value + 50),
);
watch(
  () => search.query,
  () => {
    offset.value = 0;
  },
);
watch(page, (rows) => {
  if (!rows.length && offset.value)
    offset.value = Math.max(
      0,
      Math.floor((filtered.value.length - 1) / 50) * 50,
    );
  selected.value = selected.value.filter((id) =>
    rows.some((d) => d.draftId === id),
  );
});
function toggle(id) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((old) => old !== id)
    : [...selected.value, id];
}
async function refresh() {
  busy.value = true;
  try {
    error.value = "";
    await syncCloudDrafts();
    drafts.refreshList++;
  } catch (e) {
    error.value = e.message || "Could not refresh drafts.";
  } finally {
    busy.value = false;
  }
}
onActivated(() => {
  syncCloudDrafts().catch(() => {});
});
async function open(id) {
  try {
    error.value = "";
    await openSavedDraft(id, router, "draft");
  } catch (e) {
    error.value = e.message || "Could not open draft.";
  }
}
async function toggleStar(item) {
  if (busy.value) return;
  busy.value=true;
  try {
    error.value="";
    const session=draftSession();
    const editing=starInOpenEditor(item.draftId,session.owner,!item.starred);
    if (editing) { await editing; return; }
    const draft=await readSavedDraft(item.draftId);
    if (draft.sendAttemptId) throw new Error("Check the delivery status before changing this draft.");
    await saveLocalDraft({...draft,mailboxStarred:!item.starred},{requireCurrent:true,session,starOnly:true});
    syncCloudDrafts().catch(()=>{});
  } catch(e) { error.value=e.message || "Could not change the draft star."; }
  finally { busy.value=false; }
}
async function discard(ids) {
  if (busy.value || !ids.length) return;
  busy.value = true;
  try {
    error.value = "";
    const current = [...ids];
    const session = draftSession();
    if (await ui.writerRef?.discardEditor(current, session)) return;
    feedback.dismissedDrafts(await discardDrafts(current, undefined, session));
  } catch (e) {
    error.value = e.message || "Could not discard draft.";
  } finally {
    busy.value = false;
    drafts.refreshList++;
  }
}
</script>
<style scoped>
.draft-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.draft-scroll {
  overflow: auto;
  flex: 1;
  min-height: 0;
}
p {
  text-align: center;
  padding: 32px;
  color: var(--regular-text-color);
}
p button {
  color: var(--el-color-primary);
  cursor: pointer;
}
</style>
