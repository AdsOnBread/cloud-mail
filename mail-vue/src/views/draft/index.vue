<template>
  <section ref="root" class="draft-list" aria-label="Drafts">
    <FolderFilters folder="draft" :suggest-people="suggestPeople"/>
    <div class="mail-toolbar folder-toolbar">
      <label class="check-target" data-tip="Select"
        ><input
          type="checkbox"
          aria-label="Select drafts" :disabled="busy"
          :checked="page.length > 0 && selected.length === page.length"
          :indeterminate="selected.length > 0 && selected.length < page.length"
          @change="selectGroup($event.target.checked ? 'All' : 'None')"
      /></label>
      <MailSelectionMenu :disabled="busy" @select="selectGroup"/>
      <button
        v-if="selected.length"
        class="toolbar-text"
        aria-label="Discard selected drafts"
        :disabled="busy"
        @click="discard(selected, $event.currentTarget)"
      >
        Discard drafts
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
      <MailRangeMenu :offset="offset" :count="page.length" :total="filtered.length" :disabled="busy"
        @jump="goToPage($event==='oldest' ? lastOffset : 0)"/>
      <button
        class="mail-icon"
        data-tip="Newer"
        aria-label="Newer"
        :disabled="busy || !offset"
        @click="goToPage(offset - pageSize)"
      >
        <Icon icon="material-symbols:chevron-left" width="20" />
      </button>
      <button
        class="mail-icon"
        data-tip="Older"
        aria-label="Older"
        :disabled="busy || offset >= lastOffset"
        @click="goToPage(offset + pageSize)"
      >
        <Icon icon="material-symbols:chevron-right" width="20" />
      </button>
    </div>
    <p v-if="error || drafts.listError" role="alert">
      {{ error || drafts.listError }} <button @click="refresh">Retry</button>
    </p>
    <div class="draft-scroll">
      <MailRow
        v-for="{draft,thread,subject,rowLabels} in displayed"
        :key="draft.draftId" :data-draft-id="draft.draftId" :unread="thread?.unread"
        draft-only can-star-draft
        :starred="draft.starred" :busy="busy" @star="toggleStar(draft)"
        :draft-count="1"
        :senders="thread?.senders"
        :count="thread?.messageCount"
        :subject="subject"
        :labels="rowLabels"
        :attachment-count="draft.hasFiles ? 1 : 0"
        :preview="draft.preview"
        :date="mailboxDate(draft.lastDate)"
        :date-title="formatDetailDate(draft.lastDate)"
        :open-label="`Open draft: ${subject || '(no subject)'}`"
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
            @click="discard([draft.draftId], $event.currentTarget)"
          >
            <Icon icon="material-symbols:delete-outline" width="20" /></button
        ></template>
      </MailRow>
      <p v-if="!filtered.length && !drafts.listError">
        {{ search.query || Object.keys(search.filters).length ? "No drafts match your search." : "No saved drafts." }}
      </p>
    </div>
  </section>
</template>
<script setup>
import {draftRowSubject,draftSearchMatcher} from '@/utils/draft-summary';
import {useAccountStore} from '@/store/account';
import {useMailLabels} from "@/store/mail-labels";
import { computed, nextTick, onActivated, onDeactivated, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import { useMailFeedback } from "@/store/mail-feedback";
import {useUiStore} from "@/store/ui";
import { userDraftStore, starInOpenEditor } from "@/store/draft";
import { useMailSearchStore } from "@/store/mail-search";
import { draftSession, discardDrafts, saveLocalDraft, syncCloudDrafts } from "@/services/cloud-drafts";
import { openSavedDraft, readSavedDraft } from "@/services/draft-list";
import { mailboxDate, formatDetailDate } from "@/utils/day";
import FolderFilters from "@/components/mail-folder-filters.vue";
import {peopleSuggestions} from "../../../../shared/mail-people-suggestions";
import MailRangeMenu from "@/components/mail-range-menu.vue";
import MailSelectionMenu from "@/components/mail-selection-menu.vue";
import MailRow from "@/components/mail-row/index.vue";
defineOptions({ name: "draft" });
const feedback = useMailFeedback(), ui = useUiStore();
const drafts = userDraftStore(),
  search = useMailSearchStore(),
  router = useRouter();
const labels=useMailLabels(), account=useAccountStore();
const selected = ref([]),
  offset = ref(0),
  error = ref(""),
  busy = ref(false);
const pageSize = 50;
const root = ref();
function threadFor(draft) {
  return draft.reply && !draft.trashSource ? drafts.threadSummaries[drafts.threads[draft.emailId]] : null;
}
function draftUnread(draft) {
  if (!draft.reply || !draft.emailId || draft.trashSource || drafts.threads[draft.emailId] === null) return false;
  return threadFor(draft)?.unread;
}
const filtered = computed(() => drafts.items.filter(draftSearchMatcher(
  search.query, search.filters, account.accounts, draftUnread, draft=>threadFor(draft)?.muted,
)));
const lastOffset = computed(() => Math.max(0, Math.ceil(filtered.value.length / pageSize) - 1) * pageSize);
const page = computed(() => filtered.value.slice(offset.value, offset.value + pageSize));
let focusEpoch = 0;
function resetScroll() {
  root.value?.querySelector(".draft-scroll")?.scrollTo(0, 0);
}
function goToPage(start) {
  focusEpoch++;
  offset.value = Math.min(Math.max(0, start), lastOffset.value);
  selected.value = [];
  resetScroll();
}
watch([() => search.query, () => search.filters, () => account.currentAccountId], () => goToPage(0));
watch(page, rows => {
  if (offset.value > lastOffset.value) {
    offset.value = lastOffset.value;
    resetScroll();
  }
  selected.value = selected.value.filter(id => rows.some(draft => draft.draftId === id));
});
onDeactivated(() => {
  focusEpoch++;
});
function selectGroup(group) {
  if (busy.value) return;
  selected.value = page.value.filter(draft => {
    switch (group) {
      case "All": return true;
      case "Read": return draftUnread(draft) === false;
      case "Unread": return draftUnread(draft) === true;
      case "Starred": return draft.starred;
      case "Unstarred": return !draft.starred;
      default: return false;
    }
  }).map(draft => draft.draftId);
}
const inboxLabel={id:"inbox",name:"Inbox"};
const displayed=computed(()=>page.value.map(draft=>{
  const thread=threadFor(draft);
  const custom=labels.items.filter(label=>draft.labelIds?.includes(label.id) && label.messages!=="hide");
  return {draft,thread,subject:draftRowSubject(draft,thread),rowLabels:thread?.inbox ? [inboxLabel,...custom] : custom};
}));
const recipientRows=computed(()=>drafts.items.map(draft=>({recipients:draft.recipientPeople})));
function suggestPeople(query) { return peopleSuggestions(recipientRows.value,"to",query,Infinity); }
function toggle(id) {
  if (busy.value) return;
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
let openRequest=0;
async function open(id) {
  const request=++openRequest, origin=router.currentRoute.value.fullPath;
  const current=()=>request===openRequest && router.currentRoute.value.fullPath===origin && page.value.some(draft=>draft.draftId===id);
  try {
    error.value = "";
    await openSavedDraft(id,router,"draft",undefined,undefined,current);
  } catch (e) {
    if (current()) error.value = e.message || "Could not open draft.";
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
// The IndexedDB refresh may finish after the discard or Undo promise resolves.
const pendingFocus = ref(null);
watch([pendingFocus, page, busy], () => {
  const target = pendingFocus.value;
  if (!target || busy.value) return;
  if (target.epoch !== focusEpoch || !root.value?.isConnected || localStorage.getItem("token") !== target.token) {
    pendingFocus.value = null;
    return;
  }
  const active = document.activeElement;
  if (active !== document.body && active !== target.trigger && active !== target.fallback && !(target.restored && active?.closest(".mail-feedback[inert]"))) {
    pendingFocus.value = null;
    return;
  }
  if (target.restored ? !drafts.items.some(d => target.ids.includes(d.draftId)) : drafts.items.some(d => target.ids.includes(d.draftId))) return;
  const index = target.restored
    ? filtered.value.findIndex(d => target.ids.includes(d.draftId))
    : Math.min(target.index, filtered.value.length - 1);
  // An unread filter needs the restored reply's server-side conversation state.
  if (target.restored && index < 0 && search.filters.isUnread &&
      drafts.items.some(d => target.ids.includes(d.draftId) && draftUnread(d) === undefined)) {
    target.fallback = root.value.querySelector(".check-target input");
    target.fallback?.focus();
    return;
  }
  const start = Math.floor(index / pageSize) * pageSize;
  if (index >= 0 && offset.value !== start) {
    offset.value = start;
    resetScroll();
    return;
  }
  const draft = filtered.value[index];
  const control = draft && root.value.querySelector('[data-draft-id="' + draft.draftId + '"] .conversation-open');
  (control || root.value.querySelector(".check-target input"))?.focus();
  pendingFocus.value = null;
}, {flush:"post"});
async function discard(ids, trigger) {
  if (busy.value || !ids.length) return;
  busy.value = true;
  try {
    error.value = "";
    const current = [...ids];
    const session = draftSession();
    const epoch = ++focusEpoch, token = localStorage.getItem("token");
    const index = filtered.value.findIndex(d => current.includes(d.draftId));
    const onRestore = async restored => {
      await nextTick();
      if (epoch === focusEpoch) pendingFocus.value = {epoch, token, ids:restored, restored:true};
    };
    if (!await ui.writerRef?.discardEditor(current, session, onRestore))
      feedback.dismissedDrafts(await discardDrafts(current, undefined, session), onRestore);
    if (epoch === focusEpoch) pendingFocus.value = {epoch, token, trigger, ids:current, index};
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
@media(max-width:420px) {
  .draft-list .mail-toolbar {gap:0;padding-inline:4px}
  .draft-list :deep(.select-options) {width:20px}
  .draft-list .mail-icon {width:30px}
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
