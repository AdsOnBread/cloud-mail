<template>
  <section class="conversation-list" aria-label="Conversations">
    <div class="mail-toolbar" :class="{ 'has-selection': selected.length }">
      <label class="check-target" data-tip="Select">
        <input
          type="checkbox"
          aria-label="Select loaded conversations"
          :checked="rows.length > 0 && selected.length === rows.length"
          :indeterminate="selected.length > 0 && selected.length < rows.length"
          @change="selectAll($event.target.checked)"
        />
      </label>
      <el-dropdown
        popper-class="mail-action-menu"
        :show-arrow="false"
        trigger="click"
        placement="bottom-start"
        @command="selectMatching"
      >
        <button
          class="mail-icon select-options"
          aria-label="Selection options"
          data-tip="Select"
        >
          <Icon icon="material-symbols:arrow-drop-down" width="16" />
        </button>
        <template #dropdown
          ><el-dropdown-menu
            ><el-dropdown-item
              v-for="option in [
                'All',
                'None',
                'Read',
                'Unread',
                'Starred',
                'Unstarred',
              ]"
              :key="option"
              :command="option"
              >{{ option }}</el-dropdown-item
            ></el-dropdown-menu
          ></template
        >
      </el-dropdown>
      <template v-if="!selected.length">
        <button
          class="mail-icon"
          data-tip="Refresh"
          aria-label="Refresh conversations"
          :disabled="loading"
          @click="refresh"
        >
          <Icon icon="material-symbols:refresh" width="20" />
        </button>
        <el-dropdown
          popper-class="mail-action-menu"
          :show-arrow="false"
          trigger="click"
        >
          <button
            class="mail-icon"
            data-tip="More"
            aria-label="More mailbox options"
          >
            <Icon icon="material-symbols:more-vert" width="20" />
          </button>
          <template #dropdown
            ><el-dropdown-menu
              ><el-dropdown-item @click="ascending = !ascending">{{
                ascending ? "Sort newest first" : "Sort oldest first"
              }}</el-dropdown-item></el-dropdown-menu
            ></template
          >
        </el-dropdown>
      </template>
      <template v-else>
        <button
          class="mail-icon"
          :data-tip="filingLabel"
          :aria-label="filingLabel"
          :disabled="busy"
          @click="mutate(filingAction)"
        >
          <Icon :icon="filingIcon" width="20" />
        </button>
        <button
          class="mail-icon"
          v-perm="'email:delete'"
          data-tip="Delete"
          aria-label="Delete conversations"
          :disabled="busy"
          @click="remove()"
        >
          <Icon icon="material-symbols:delete-outline" width="20" />
        </button>
        <button
          class="mail-icon"
          :data-tip="selectedUnread ? 'Mark as read' : 'Mark as unread'"
          :aria-label="
            selectedUnread
              ? 'Mark conversations read'
              : 'Mark conversations unread'
          "
          :disabled="busy"
          @click="mutate('read', selectedUnread ? {} : { unread: 0 })"
        >
          <Icon :icon="readIcon(selectedUnread)" width="20" />
        </button>
        <button
          class="mail-icon"
          data-tip="Snooze"
          aria-label="Snooze conversations"
          :disabled="busy"
          aria-haspopup="menu"
          :aria-expanded="Boolean(snoozePicker?.anchor && !snoozeRow)"
          @click="chooseSnooze(selected, $event)"
        >
          <Icon icon="material-symbols:schedule-outline" width="20" />
        </button>
        <MovePicker :show-categories="(folder==='inbox' && uiPreferences.inboxTabs) || categoryFolders.some(item=>item.id===folder)" @category="(id,ids)=>mutate('category',{category:id},ids)" :ids="selected" :from-label-id="labelId" :disabled="busy" @move="(ops,ids)=>mutate('move',ops,ids)" />
        <LabelPicker :rows="selectedRows" :disabled="busy" @apply="(ops,ids)=>mutate('label',ops,ids)" />
        <el-dropdown trigger="click" placement="bottom-start" popper-class="mail-action-menu" :show-arrow="false">
          <button class="mail-icon" data-tip="More" aria-label="More actions for selection" :disabled="busy"><Icon icon="material-symbols:more-vert" width="20" /></button>
          <template #dropdown><el-dropdown-menu>
            <el-dropdown-item v-if="selectedRows.some(row => !row.importanceReason)" @click="mutate('importance', { important: true })">Mark as important</el-dropdown-item>
            <el-dropdown-item v-if="selectedRows.some(row => row.importanceReason)" @click="mutate('importance', { important: false })">Mark as not important</el-dropdown-item>
            <el-dropdown-item v-if="history.length" class="compact-page-action" divided :disabled="loading || busy" @click="previousPage">Previous page</el-dropdown-item>
            <el-dropdown-item v-if="hasMore" class="compact-page-action" :divided="!history.length" :disabled="loading || busy" @click="nextPage">Next page</el-dropdown-item>
          </el-dropdown-menu></template>
        </el-dropdown>
      </template>
      <span class="total">{{
        total && rows.length
          ? offset + 1 + "–" + (offset + rows.length) + " of " + total
          : ""
      }}</span>
      <button
        class="mail-icon pager"
        data-tip="Previous page"
        aria-label="Previous page"
        :disabled="!history.length || loading || busy"
        @click="previousPage"
      >
        <Icon icon="material-symbols:chevron-left" width="20" />
      </button>
      <button
        class="mail-icon pager"
        data-tip="Next page"
        aria-label="Next page"
        :disabled="!hasMore || loading || busy"
        @click="nextPage"
      >
        <Icon icon="material-symbols:chevron-right" width="20" />
      </button>
    </div>
    <InboxTabs v-if="category" :value="category" :panel-id="panelId" :unread="{...categoryUnread,primary:(categoryUnread.primary || 0)+drafts.scheduledInboxUnread}" @select="selectCategory"/>
    <p v-if="error" role="alert" class="list-status">
      {{ error }} <button @click="refresh">Retry</button>
    </p>
    <details v-if="filedDrafts.length" class="marked-scheduled" open>
      <summary>Drafts ({{ filedDrafts.length }})</summary>
      <div class="scheduled-links">
        <button v-for="draft in filedDrafts" :key="draft.draftId" type="button"
          :aria-label="'Open draft: '+(draft.subject || '(no subject)')" @click="openFiledDraft(draft)">
          <span class="draft-marker">Draft</span><span>{{ draft.subject || '(no subject)' }}</span>
          <time :title="formatDetailDate(draft.lastDate)">{{ mailboxDate(draft.lastDate) }}</time>
        </button>
      </div>
    </details>
    <details v-if="scheduledMatches.length" class="marked-scheduled" open>
      <summary>Scheduled ({{ scheduledMatches.length }})</summary>
      <div class="scheduled-links">
        <div v-for="message in scheduledMatches" :key="message.draftId" class="filed-queue-row" :class="{ 'inbox-queue-row':folder==='inbox', 'hover-actions':owner.hoverActions }">
          <RouterLink :to="{name:'scheduled', query:{message:message.draftId,from:folder,labelId:folder==='label' ? labelId : undefined}}"
            :aria-description="'Send scheduled for '+formatDetailDate(message.sendAt*1000)">
            <Icon icon="material-symbols:schedule-send-outline" width="18" />
            <span :class="{'queued-unread':message.unread}">{{ message.subject || '(no subject)' }}</span>
            <span v-if="folder==='inbox' && message.preview" class="queued-preview">– {{ message.preview }}</span>
            <time :title="formatDetailDate((folder==='snoozed' ? message.wakeAt : message.sendAt)*1000)">{{ mailboxDate((folder==='snoozed' ? message.wakeAt : message.sendAt)*1000) }}</time>
          </RouterLink>
          <button v-if="folder==='inbox' && ['scheduled','schedule_failed'].includes(message.state)" type="button" class="queue-archive mail-icon"
            :aria-label="'Archive '+(message.subject || '(no subject)')" data-tip="Archive" :disabled="Boolean(filingQueue)"
            @click="archiveQueued(message,$event.currentTarget)">
            <Icon icon="material-symbols:archive-outline" width="20"/>
          </button>
        </div>
      </div>
    </details>
    <p v-if="scheduledError" role="alert" class="list-status">{{ scheduledError }} <button @click="refresh">Retry</button></p>
    <div v-bind="containerProps" class="conversation-scroll" :id="category?panelId:undefined" :role="category?'tabpanel':undefined" :aria-labelledby="category?panelId+'-'+category:undefined">
      <div v-bind="wrapperProps">
        <MailRow
          v-for="{ data: row } in virtualRows"
          :key="row.threadId"
          :participants="row.participants"
          :senders="row.senders"
          :count="row.messageCount"
          :subject="row.subject"
          :attachments="row.attachments"
          :attachment-count="row.attachmentCount || (replies(row).some(d=>d.hasFiles)?1:0)"
          :labels="rowLabels(row)"
          :preview="replies(row)[0]?.preview || row.preview"
          :draft-count="replies(row).length"
          :date="mailboxDate(rowDate(row))"
          :date-title="formatDetailDate(rowDate(row))"
          :selected="selected.includes(row.lastEmailId)"
          show-importance
          :importance-reason="row.importanceReason"
          @importance="mutate('importance', { important: $event }, [row.lastEmailId])"
          :starred="Boolean(row.starred)"
          :unread="Boolean(row.unreadCount)"
          :busy="busy"
          :open-label="rowOpenLabel(row)"
          :can-drag="width >= 768 && !busy"
          @start-move="startMove($event, row)" @end-move="endConversationDrag(dragSource, $event)"
          @open="open(row)"
          @select="toggle(row.lastEmailId)"
          @star="star(row)"
          @contextmenu.prevent="openContext(row)"
          @keydown.shift.f10.prevent="openContext(row)"
        >
          <template v-if="folder === 'sent'" #status
            ><Icon
              :icon="
                row.status === 2
                  ? 'material-symbols:done-all'
                  : row.status >= 3
                    ? 'material-symbols:error-outline'
                    : 'material-symbols:send-outline'
              "
              :aria-label="deliveryState(row.status)"
              width="16"
          /></template>
          <template #actions>
            <button
              class="mail-icon"
              :data-tip="row.filedAway ? 'Move to Inbox' : 'Archive'"
              :aria-label="row.filedAway ? 'Move to Inbox' : 'Archive'"
              :disabled="busy"
              @click="mutate(row.filedAway ? 'inbox' : 'archive', {}, [row.lastEmailId])"
            >
              <Icon :icon="row.filedAway ? 'material-symbols:move-to-inbox-outline' : 'material-symbols:archive-outline'" width="20" />
            </button>
            <button
              class="mail-icon"
              v-perm="'email:delete'"
              data-tip="Delete"
              aria-label="Delete conversation"
              :disabled="busy"
              @click="remove([row.lastEmailId])"
            >
              <Icon icon="material-symbols:delete-outline" width="20" />
            </button>
            <button
              class="mail-icon"
              :data-tip="row.unreadCount ? 'Mark as read' : 'Mark as unread'"
              :aria-label="row.unreadCount ? 'Mark as read' : 'Mark as unread'"
              :disabled="busy"
              @click="
                mutate('read', { unread: row.unreadCount ? 1 : 0 }, [
                  row.lastEmailId,
                ])
              "
            >
              <Icon :icon="readIcon(row.unreadCount)" width="20" />
            </button>
            <button
              class="mail-icon"
              data-tip="Snooze"
              aria-label="Snooze"
              :disabled="busy"
              aria-haspopup="menu"
              :aria-expanded="
                Boolean(snoozePicker?.anchor) && snoozeRow === row.lastEmailId
              "
              @click="chooseSnooze([row.lastEmailId], $event, row.lastEmailId)"
            >
              <Icon icon="material-symbols:schedule-outline" width="20" />
            </button>
          </template>
          <el-dropdown
            popper-class="mail-action-menu"
            :show-arrow="false"
            ref="contextDropdown"
            v-if="context === row.lastEmailId"
            trigger="click"
            @visible-change="!$event && (context = 0)"
          >
            <button aria-label="Conversation actions">⋮</button>
            <template #dropdown
              ><el-dropdown-menu>
                <el-dropdown-item
                  v-perm="'email:send'"
                  @click="open(row, 'reply')"
                  >Reply</el-dropdown-item
                >
                <el-dropdown-item
                  v-perm="'email:send'"
                  @click="open(row, 'replyAll')"
                  >Reply all</el-dropdown-item
                >
                <el-dropdown-item @click="mutate('importance', { important: !row.importanceReason }, [row.lastEmailId])">{{ row.importanceReason ? 'Mark as not important' : 'Mark as important' }}</el-dropdown-item>
                <el-dropdown-item @click="mutate('read', {}, [row.lastEmailId])"
                  >Mark read</el-dropdown-item
                >
                <el-dropdown-item
                  v-perm="'email:delete'"
                  @click="remove([row.lastEmailId])"
                  >Delete conversation</el-dropdown-item
                >
              </el-dropdown-menu></template
            >
          </el-dropdown>
        </MailRow>
      </div>
      <p v-if="loading" role="status" class="list-status">
        {{ preparingSearch ? 'Preparing searchable mail…' : 'Loading conversations…' }}
      </p>
      <p v-else-if="!rows.length && !filedDrafts.length && !scheduledMatches.length && !scheduledError && !error" class="list-status">
        {{
          search.query || Object.keys(search.filters).length
            ? "No conversations match your search."
            : category ? "Your "+inboxCategories.find(item=>item.id===category).name+" tab is empty." : "No conversations here."
        }}
      </p>
    </div>
    <MailSnoozePicker ref="snoozePicker" @choose="(wakeAt,ids)=>mutate('snooze',{wakeAt},ids)"/>
  </section>
</template>
<script setup>
import {draftSearchMatcher} from "@/utils/draft-summary";
import http from "@/axios";
import {startConversationDrag, endConversationDrag} from "@/components/mail-labels/conversation-drag";
import MovePicker from "@/components/mail-labels/move.vue";
import LabelPicker from "@/components/mail-labels/picker.vue";
import { useMailLabels } from "@/store/mail-labels";
const labels = useMailLabels();
import { useMailFeedback } from "@/store/mail-feedback";
const feedback = useMailFeedback();
import {
  ref,
  computed,
  watch,
  useId,
  onActivated,
  onDeactivated,
  onUnmounted,
  nextTick,
} from "vue";
import { useVirtualList, useWindowSize } from "@vueuse/core";
import { Icon } from "@iconify/vue";
import { useRouter, useRoute } from "vue-router";

import { useUserStore } from "@/store/user";
import { useAccountStore } from "@/store/account";
import { useEmailStore } from "@/store/email";
import { useMailSearchStore } from "@/store/mail-search";
import { useSettingStore } from "@/store/setting";
import {searchPage} from '@/services/preparing-search';
import { conversationList, conversationAction } from "@/request/conversation";
import {fileScheduledMessages} from "@/services/scheduled-filing";
import { formatDetailDate, mailboxDate, tzDayjs } from "@/utils/day";
import InboxTabs from "@/components/inbox-tabs.vue";
import {inboxCategories,categoryFolders,categoryMessageKey} from "@/utils/inbox-categories";
import MailSnoozePicker from "@/components/mail-snooze-picker.vue";
import MailRow from "@/components/mail-row/index.vue";
import { userDraftStore } from "@/store/draft";
const drafts = userDraftStore();
const props = defineProps({ folder: String, labelId: Number });
const account = useAccountStore(),
  emailStore = useEmailStore(),
  search = useMailSearchStore(),
  settings = useSettingStore();
const router = useRouter(),
  route = useRoute();
const scheduledMatches = ref([]), scheduledError = ref(""), filingQueue=ref(false);
async function archiveQueued(message,button) {
  if (filingQueue.value) return;
  const ownerKey=key.value, path=route.fullPath, list=button.closest('.conversation-list');
  filingQueue.value=true;
  try {
    await fileScheduledMessages([message],false);
    if (key.value===ownerKey && route.fullPath===path && list.isConnected) {
      scheduledMatches.value=scheduledMatches.value.filter(row=>row.draftId!==message.draftId);
      await nextTick();
      if (document.activeElement===document.body)
        (list.querySelector('.filed-queue-row a,.conversation-open') || list.querySelector('.select-options'))?.focus();
    }
  } catch(e) {
    if (key.value===ownerKey && route.fullPath===path && list.isConnected)
      scheduledError.value=e.message || 'Could not archive the scheduled message.';
  } finally {filingQueue.value=false;}
}
const rows = ref([]),
  selected = ref([]),
  ascending = ref(false),
  loading = ref(false), preparingSearch=ref(false),
  busy = ref(false),
  error = ref(""),
  total = ref(0),
  cursor = ref(null),
  hasMore = ref(false),
  context = ref(0),
  contextDropdown = ref();
import {useUiStore} from "@/store/ui";
const uiPreferences=useUiStore();
const categoryUnread=ref({}), panelId=useId(), owner=useUserStore();
watch([()=>owner.user.email,()=>account.currentAccountId,()=>account.currentAccount.allReceive],()=>{categoryUnread.value={};},{flush:"sync"});
const category=computed(()=>{
 if(props.folder!=='inbox' || !uiPreferences.inboxTabs || search.query || Object.keys(search.filters).length)return null;
 return inboxCategories.find(item=>item.id===route.query?.category)?.id || 'primary';
});
function selectCategory(id){
 if(category.value===id)return;
 const query={...route.query};if(id==='primary')delete query.category;else query.category=id;
 router.replace({name:'email',query});
}
const { width } = useWindowSize();
const {
  list: virtualRows,
  containerProps,
  wrapperProps,
} = useVirtualList(rows, {
  itemHeight: index => width.value < 768 ? 84 : uiPreferences.rowHeight + (uiPreferences.density === "default" && rows.value[index]?.attachments?.length ? 32 : 0),
  overscan: 12,
});
// VueUse tracks the scroll container size, but a density change can resize only its rows.
watch([()=>uiPreferences.density, ()=>width.value<768], () => containerProps.onScroll(), {flush:"post"});
let generation = 0,
  active = true,
  timer,
  wakeTimer;
const categoryChips = computed(() => new Map(categoryFolders
  .filter(item => item.id !== "purchases" && labels.system[categoryMessageKey(item.id)] === "show")
  .map(item => [item.id, {id:"category-"+item.id,name:item.name}])));
const showCategoryChips = computed(() => categoryChips.value.size > 0);
function rowLabels(row) {
  const custom = labels.items.filter(label=>row.labelIds?.includes(label.id) && label.id!==props.labelId && label.messages!=='hide');
  const chip = row.category !== props.folder && categoryChips.value.get(row.category);
  return chip ? [chip,...custom] : custom;
}
const key = computed(() =>
  [
    owner.user.email,props.folder, props.labelId, category.value, showCategoryChips.value,
    props.folder === "starred" ? "" : account.currentAccountId,
    props.folder === "starred" ? "" : account.currentAccount.allReceive,
    ascending.value,
    search.query, JSON.stringify(search.filters),
  ].join("|"),
);
function deliveryState(status) {
  return (
    {
      0: "Received",
      1: "Sent",
      2: "Delivered",
      3: "Delivery failed",
      4: "Recipient complained",
      5: "Delivery delayed",
      8: "Delivery failed",
    }[status] || "Sent"
  );
}
function params() {
  return {
    folder: props.folder,
    includeCategory:showCategoryChips.value ? 1 : undefined,
    labelId: props.labelId, category:category.value||undefined,
    accountId: account.currentAccountId,
    allReceive: account.currentAccount.allReceive ? 1 : 0,
    timeSort: ascending.value ? 1 : 0,
    q: search.query, ...search.filters,
    limit: 50,
  };
}
const history = ref([]);
const filedDrafts = computed(() => {
  if (offset.value || !["label","starred"].includes(props.folder) || search.filters.isUnread) return [];
  const matches=draftSearchMatcher(search.query,search.filters,account.accounts);
  return drafts.items.filter(draft => {
    if (props.folder==="starred" ? !draft.starred : !draft.labelIds?.includes(props.labelId)) return false;
    if (props.folder==="label" && !account.currentAccount.allReceive && draft.accountId!==account.currentAccountId) return false;
    return matches(draft);
  });
});
async function openFiledDraft(draft) {
  try {
    const {openSavedDraft}=await import("@/services/draft-list");
    await openSavedDraft(draft.draftId, router, props.folder, props.labelId);
  } catch (e) {error.value=e.message || "Could not open this draft.";}
}
const pageCursor = ref(null);
const offset = ref(0);
const selectedUnread = computed(() =>
  rows.value.some(
    (row) => selected.value.includes(row.lastEmailId) && row.unreadCount,
  ),
);
const filingAction = computed(() =>
  ["archived", "snoozed"].includes(props.folder) || selected.value.length>0 && rows.value.filter(row=>selected.value.includes(row.lastEmailId)).every(row=>row.filedAway) ? "inbox" : "archive",
);
const filingLabel = computed(() =>
  filingAction.value === "archive" ? "Archive" : "Move to Inbox",
);
const filingIcon = computed(() =>
  filingAction.value === "archive"
    ? "material-symbols:archive-outline"
    : "material-symbols:move-to-inbox-outline",
);
const readIcon = (unread) =>
  unread ? "material-symbols:drafts-outline" : "material-symbols:mail-outline";
const rowDate = (row) => {
  if (props.folder === "snoozed" && row.wakeAt)
    return new Date(row.wakeAt * 1000);
  const draftDate = replies(row)[0]?.lastDate || 0;
  if (draftDate || row.activityTime)
    return new Date(
      Math.max(
        draftDate,
        row.activityTime
          ? row.activityTime * 1000
          : tzDayjs(row.lastDate).valueOf(),
      ),
    );
  return row.lastDate;
};
const replies = (row) =>
  drafts.replies[row.threadId] ||
  drafts.replies["anchor-" + row.lastEmailId] ||
  [];
const snoozePicker=ref(),snoozeRow=ref(0);
function chooseSnooze(ids,event,row=0) {
  snoozeRow.value=row;
  snoozePicker.value?.show(event.currentTarget,ids);
}
async function load(
  target = { cursor: pageCursor.value, offset: offset.value },
  prior = history.value,
) {
  const request = ++generation;
  preparingSearch.value=false;
  loading.value = true;
  error.value = "";
  try {
    const includeScheduled = !target.cursor && (["starred","important","label","snoozed"].includes(props.folder) || (props.folder==='inbox' && (!category.value || category.value==='primary')))
      && owner.user.email && (props.folder==="starred" || account.currentAccountId);
    const [data, queue] = await Promise.all([
      searchPage(()=>conversationList({ ...params(), cursor: target.cursor }),()=>active && request===generation,()=>{preparingSearch.value=true;}),
      includeScheduled ? http.get("/v1/scheduled", {params:{...search.filters,q:search.query,mark:props.folder==="label" ? undefined : props.folder,labelId:props.folder==="label" ? props.labelId : undefined,
        accountId:props.folder==="starred" || account.currentAccount.allReceive ? undefined : account.currentAccountId},
        noMsg:true}).then(messages=>({messages}), e=>({error:e.message || "Could not load scheduled messages."})) : {},
    ]);
    if (request !== generation || !data) return;
    if (target.cursor && data.total !== total.value)
      return await load({ cursor: null, offset: 0 }, []);
    if (!data.threads.length && prior.length)
      return await load(prior.at(-1), prior.slice(0, -1));
    if (target.cursor !== pageCursor.value)
      containerProps.ref.value?.scrollTo?.(0, 0);
    if(category.value)categoryUnread.value=data.categoryUnread||{};
    scheduledMatches.value = queue.messages || [];
    scheduledError.value = queue.error || "";
    rows.value = data.threads;
    total.value = data.total;
    if(props.folder==="inbox" && !search.query && !Object.keys(search.filters).length)
      emailStore.inboxUnread={accountId:account.currentAccountId,allReceive:Boolean(account.currentAccount.allReceive),count:data.categoryUnread?Object.values(data.categoryUnread).reduce((acc,n)=>acc+n,0):data.unreadThreads};
    clearTimeout(wakeTimer);
    if (data.nextWakeAt && ["inbox", "snoozed"].includes(props.folder)) {
      const delay = Math.min(
        2147483647,
        Math.max(1000, data.nextWakeAt * 1000 - Date.now() + 500),
      );
      wakeTimer = setTimeout(() => {
        if (active) refresh();
      }, delay);
    }
    hasMore.value = data.hasMore;
    cursor.value = data.nextCursor;
    pageCursor.value = target.cursor;
    offset.value = target.offset;
    history.value = prior;
    selected.value = selected.value.filter((id) =>
      rows.value.some((row) => row.lastEmailId === id),
    );
  } catch (e) {
    if (request === generation)
      error.value = e.message || "Could not load conversations.";
  } finally {
    if (request === generation) loading.value = false;
  }
}
function refresh() {
  emailStore.conversationListRefresh++;
  return load();
}
function nextPage() {
  return load(
    { cursor: cursor.value, offset: offset.value + rows.value.length },
    [...history.value, { cursor: pageCursor.value, offset: offset.value }],
  );
}
function previousPage() {
  return load(history.value.at(-1), history.value.slice(0, -1));
}
watch(
  key,
  () => {
    generation++;
    snoozePicker.value?.close();
    history.value = [];
    pageCursor.value = null;
    offset.value = 0;
    hasMore.value = false;
    total.value = 0;
    rows.value = [];
    scheduledMatches.value = [];
    scheduledError.value = "";
    selected.value = [];
    cursor.value = null;
    containerProps.ref.value?.scrollTo?.(0, 0);
    load();
  },
  { immediate: true },
);
watch(
  [() => emailStore.conversationRevision, () => drafts.scheduledRevision],
  () => {
    if (active && !busy.value) refresh();
  },
);
// Undo can commit while the move is still loading the list. Starting a newer
// load discards the older response via its existing generation check.
watch([()=>labels.undoneMove,()=>labels.returnedToTrash],()=>{ if (active && busy.value) refresh(); });
watch(()=>labels.moved,change=>{
  if(change && !change.trash && change.path===route.fullPath)
    selected.value=selected.value.filter(id=>!change.ids.includes(id));
});
function toggle(id) {
  if (selected.value.includes(id))
    selected.value = selected.value.filter((value) => value !== id);
  else if (selected.value.length < 95) selected.value.push(id);
}
function selectMatching(option) {
  const matches = {
    All: () => true,
    None: () => false,
    Read: (r) => !r.unreadCount,
    Unread: (r) => r.unreadCount,
    Starred: (r) => r.starred,
    Unstarred: (r) => !r.starred,
  };
  selected.value = rows.value
    .filter(matches[option])
    .map((row) => row.lastEmailId);
}
function selectAll(checked) {
  selected.value = checked
    ? rows.value.slice(0, 95).map((row) => row.lastEmailId)
    : [];
}
async function openContext(row) {
  context.value = row.lastEmailId;
  await nextTick();
  (Array.isArray(contextDropdown.value)
    ? contextDropdown.value[0]
    : contextDropdown.value
  )?.handleOpen?.();
}
function rowOpenLabel(row) {
  const n = replies(row).length;
  const messages = row.messageCount + (row.messageCount === 1 ? " message" : " messages");
  const saved = n ? ", " + n + (n === 1 ? " draft" : " drafts") : "";
  return "Open " + (row.subject || "(no subject)") + ", " + messages + saved;
}
async function open(row, reply) {
  context.value = 0;
  const draft = replies(row)[0];
  if (draft && !reply) {
    try {
      const { openSavedDraft } = await import("@/services/draft-list");
      await openSavedDraft(draft.draftId, router, props.folder, props.labelId, route.query?.category);
    } catch (e) {
      error.value = e.message || "Could not open draft.";
    }
    return;
  }
  router.push({
    path: "/mail",
    query: {
      emailId: row.lastEmailId,
      folder: props.folder,
      ...(props.labelId ? {labelId:props.labelId} : {}),
      ...(props.folder==="inbox" && route.query?.category ? {category:route.query.category} : {}),
      ...(reply ? { reply } : {}),
    },
  });
}
async function mutate(action, extra = {}, ids = selected.value) {
  if (busy.value) return;
  const token = owner.authenticatedToken, path = route.fullPath, view = key.value;
  const sameSession = () => owner.authenticatedToken === token && localStorage.getItem("token") === token;
  busy.value = true;
  try {
    const result = action === "move" ? await labels.moveConversations(ids, extra) : await conversationAction(action, ids, extra);
    if (!sameSession()) return;
    if (action === "delete") feedback.trashed(result?.emailIds || [], ids.length);
    emailStore.conversationRevision++;
    if (!active || path !== route.fullPath || view !== key.value) return;
    selected.value = selected.value.filter((id) => !ids.includes(id));
    await refresh();
  } catch (e) {
    if (sameSession()) {
      const message = e.message || "Could not update the conversation.";
      if (active && path === route.fullPath && view === key.value) error.value = message;
      else if (action === "move") feedback.show(message);
    }
  } finally {
    busy.value = false;
  }
}
const dragSource = Symbol();
const rowAnchors = computed(() => new Set(rows.value.map(row => row.lastEmailId)));
function startMove(event, row) {
  const token = owner.authenticatedToken, path = route.fullPath, mailbox = account.currentAccountId, view = key.value;
  const ids = selected.value.includes(row.lastEmailId) ? [...selected.value] : [row.lastEmailId];
  const currentSession = () => token && owner.authenticatedToken === token && localStorage.getItem("token") === token;
  const currentView = () => active && route.fullPath === path && key.value === view && account.currentAccountId === mailbox;
  if (!event.dataTransfer || !currentSession() || !currentView() || busy.value) return event.preventDefault();
  startConversationDrag(event, dragSource, id => {
    if (!currentSession() || !currentView() || busy.value || !ids.every(anchor => rowAnchors.value.has(anchor))) return false;
    return id === 0 ? props.folder !== "inbox" : id !== props.labelId && labels.items.some(label => label.id === id);
  }, id => mutate("move", {labelId:id, fromLabelId:props.labelId || 0}, ids));
}
watch([key, () => route.fullPath, () => owner.authenticatedToken, () => account.currentAccountId], () => endConversationDrag(dragSource), {flush:"sync"});
function remove(ids = selected.value) {
  return mutate("delete", {}, Array.isArray(ids) ? ids : selected.value);
}
const selectedRows = computed(() => rows.value.filter(row => selected.value.includes(row.lastEmailId)));
function star(row) {
  return mutate("star", { starred: !row.starred }, [row.lastEmailId]);
}
onActivated(() => {
  active = true;
  if (!loading.value) refresh();
});
onDeactivated(() => {
  endConversationDrag(dragSource);
  active = false;
  snoozePicker.value?.close();
});
timer = setInterval(
  () => {
    if (
      active &&
      !search.query &&
      props.folder === "inbox" &&
      route.name === "email" &&
      settings.settings.autoRefresh > 1 &&
      !loading.value &&
      !busy.value
    )
      refresh();
  },
  Math.max(3, settings.settings.autoRefresh || 30) * 1000,
);
onUnmounted(() => {
  endConversationDrag(dragSource);
  generation++;
  clearInterval(timer);
  clearTimeout(wakeTimer);
});
defineExpose({ refresh });
</script>
<style scoped>
.queued-unread {font-weight:600;}
.conversation-list {
  container-type:inline-size;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.marked-scheduled { flex:none; font-size:14px; border-bottom:1px solid var(--el-border-color-lighter); }
.marked-scheduled summary { cursor:pointer; padding:8px 16px; font-weight:500; }
.scheduled-links { max-height:min(30vh,240px); overflow:auto; }
.scheduled-links button,.scheduled-links a { display:flex; gap:12px; align-items:center; padding:8px 16px; color:inherit; text-decoration:none; }
.scheduled-links button:hover,.scheduled-links button:focus-visible,.scheduled-links a:hover,.scheduled-links a:focus-visible,.marked-scheduled summary:hover { background:var(--mail-hover); }
.scheduled-links button {width:100%;text-align:left;cursor:pointer;font:inherit}
.filed-queue-row {position:relative;}
.filed-queue-row a {min-height:40px;box-sizing:border-box;}
.queued-preview {font-weight:400;color:var(--secondary-text-color);}
.scheduled-links .queue-archive {position:absolute;inset-inline-end:8px;top:50%;transform:translateY(-50%);width:32px;height:32px;justify-content:center;padding:0;opacity:0;pointer-events:none;}
.inbox-queue-row:focus-within .queue-archive {opacity:1;pointer-events:auto;}
.inbox-queue-row:focus-within:has(.queue-archive) time {visibility:hidden;min-width:32px;}
@media(hover:hover) {
  .inbox-queue-row.hover-actions:hover .queue-archive {opacity:1;pointer-events:auto;}
  .inbox-queue-row.hover-actions:hover:has(.queue-archive) time {visibility:hidden;min-width:32px;}
}
@media(hover:none) {
  .scheduled-links .queue-archive {position:static;transform:none;opacity:1;pointer-events:auto;flex:none;}
  .inbox-queue-row {display:flex;align-items:center;}
  .inbox-queue-row a {flex:1;min-width:0;}
  .inbox-queue-row:focus-within:has(.queue-archive) time {visibility:visible;}
}
.draft-marker {color:var(--mail-draft,#b3261e)}
.scheduled-links button span,.scheduled-links a span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.scheduled-links time { margin-left:auto; flex:none; font-size:12px; }
.conversation-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto !important;
}
.list-status {
  padding: 32px;
  text-align: center;
  color: var(--regular-text-color);
}
.list-status button {
  color: var(--el-color-primary);
  cursor: pointer;
}
.select-options {
  width: 18px;
  height: 28px;
  border-radius: 4px;
  margin-left: -8px;
  margin-right: 8px;
}
.pager:disabled {
  opacity: 0.32;
}
:global(.mail-action-menu .el-dropdown-menu__item.compact-page-action) { display:none; }
@media (max-width: 480px) {
  :global(.mail-action-menu .el-dropdown-menu__item.compact-page-action) { display:flex; }
  .has-selection .pager, .has-selection .total { display:none; }
  .mail-toolbar {
    gap: 0;
    padding: 0 4px;
  }
  .mail-toolbar .total {
    padding: 0 2px;
  }
}
</style>
