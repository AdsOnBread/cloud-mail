<template>
  <section ref="root" class="conversation-list" aria-label="Conversations">
    <div class="mail-toolbar folder-toolbar" :class="{ 'has-selection': selected.length }">
      <label class="check-target" data-tip="Select">
        <input
          type="checkbox"
          aria-label="Select loaded conversations" :disabled="busy || loading"
          :checked="rows.length > 0 && selected.length === rows.length"
          :indeterminate="selected.length > 0 && selected.length < rows.length"
          @change="selectAll($event.target.checked)"
        />
      </label>
      <MailSelectionMenu :disabled="busy || loading" @select="selectMatching"/>
      <template v-if="!selected.length">
        <button
          class="mail-icon"
          data-tip="Refresh"
          aria-label="Refresh conversations"
          :disabled="loading || busy"
          @click="refresh"
        >
          <Icon icon="material-symbols:refresh" width="20" />
        </button>
        <MailPageActions label="More mailbox options" :disabled="pageReadDisabled"
          :key="JSON.stringify([key,offset])" @mark-read="markPageRead"/>
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
        <ConversationToolbarActions :snooze-anchor="snoozePicker?.anchor" :rows="selectedRows" label="More actions for selection" :scope="key"
          :disabled="busy || loading" :can-attach="hasPerm('email:send')" :forwarding="forwarding"
          :newer="offset>0" :older="hasMore" @newer="previousPage" @older="nextPage"
          @snooze="opener=>chooseSnooze(selected,opener)" @attach="forwardMessages(selected)"
          @importance="important=>mutate('importance',{important})" @apply="(ops,ids)=>mutate('label',ops,ids)">
          <MovePicker :show-categories="(folder==='inbox' && uiPreferences.inboxTabs) || categoryFolders.some(item=>item.id===folder)" @category="(id,ids)=>mutate('category',{category:id},ids)" :ids="selected" :from-label-id="labelId" :disabled="busy" @move="(ops,ids)=>mutate('move',ops,ids)" />
        </ConversationToolbarActions>
      </template>
      <MailRangeMenu :offset="offset" :count="rows.length" :total="total" :disabled="loading || busy" @jump="jumpPage"/>
      <button
        class="mail-icon pager"
        data-tip="Newer"
        aria-label="Newer"
        :disabled="!offset || loading || busy"
        @click="previousPage"
      >
        <Icon icon="material-symbols:chevron-left" width="20" />
      </button>
      <button
        class="mail-icon pager"
        data-tip="Older"
        aria-label="Older"
        :disabled="!hasMore || loading || busy"
        @click="nextPage"
      >
        <Icon icon="material-symbols:chevron-right" width="20" />
      </button>
    </div>
    <InboxTabs v-if="category" :value="category" :panel-id="panelId" :unread="{...categoryUnread,primary:(categoryUnread.primary || 0)+drafts.scheduledInboxUnread}" @select="selectCategory"/>
    <p v-if="error" role="alert" class="list-status">
      {{ error }} <button class="retry-list" @click="retry">Retry</button>
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
          @contextmenu.prevent="rowMenu?.show($event,row)"
        @keydown.shift.f10.stop.prevent="rowMenu?.show($event,row)"
        @keydown.context-menu.stop.prevent="rowMenu?.show($event,row)"
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
              @click="chooseSnooze([row.lastEmailId], $event.currentTarget, row.lastEmailId)"
            >
              <Icon icon="material-symbols:schedule-outline" width="20" />
            </button>
          </template>
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
    <RowContextMenu ref="rowMenu" :rows="selectedRows" :scope="key" :folder="folder" :category="category" :label-id="labelId"
      :busy="busy || loading" :forwarding="forwarding" @select-only="selected=$event" @command="rowCommand"
      @move="(ops,ids)=>mutate('move',ops,ids)" @label="(ops,ids)=>mutate('label',ops,ids)"
      @category="(category,ids)=>mutate('category',{category},ids)"/>
    <MailSnoozePicker ref="snoozePicker" @choose="(wakeAt,ids)=>mutate('snooze',{wakeAt},ids)"/>
  </section>
</template>
<script setup>
import {useForwardAttachments} from "@/services/forward-attachments";
import {hasPerm} from "@/perm/perm";
import {draftSearchMatcher} from "@/utils/draft-summary";
import http from "@/axios";
import {startConversationDrag, endConversationDrag} from "@/components/mail-labels/conversation-drag";
import MovePicker from "@/components/mail-labels/move.vue";
import ConversationToolbarActions from "@/components/conversation-toolbar-actions.vue";
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
import MailRangeMenu from "@/components/mail-range-menu.vue";
import MailSelectionMenu from "@/components/mail-selection-menu.vue";
import MailPageActions from "@/components/mail-page-actions.vue";
import {holdScheduledReads,pendingScheduledReads} from "@/services/scheduled-read";
import InboxTabs from "@/components/inbox-tabs.vue";
import {inboxCategories,categoryFolders,categoryMessageKey} from "@/utils/inbox-categories";
import MailSnoozePicker from "@/components/mail-snooze-picker.vue";
import RowContextMenu from "@/components/mail-row/context-menu.vue";
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
const root=ref();
const rows = ref([]),
  selected = ref([]),
  loading = ref(false), preparingSearch=ref(false),
  busy = ref(false),
  error = ref(""),
  total = ref(0),
  cursor = ref(null),
  hasMore = ref(false),
  rowMenu = ref();
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
    search.query, JSON.stringify(search.filters),
  ].join("|"),
);
const {forwarding, forwardMessages} = useForwardAttachments(() => JSON.stringify([key.value, selected.value]));
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
    timeSort: 0,
    q: search.query, ...search.filters,
    limit: 50,
  };
}
const firstPage={cursor:null};
let currentPage=firstPage, failedPage;
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
const firstCursor = ref(null);
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
function chooseSnooze(ids,opener,row=0) {
  snoozeRow.value=row;
  snoozePicker.value?.show(opener,ids);
}
async function load(target=currentPage) {
  const request = ++generation, token=owner.authenticatedToken, scope=key.value;
  const current=()=>active && generation===request && scope===key.value && token &&
    token===owner.authenticatedToken && token===localStorage.getItem("token");
  if (!current()) {loading.value=false;return;}
  failedPage=undefined;
  preparingSearch.value=false;
  loading.value = true;
  error.value = "";
  try {
    const showQueue=(["starred","important","label","snoozed"].includes(props.folder) ||
      (props.folder==='inbox' && (!category.value || category.value==='primary'))) &&
      owner.user.email && (props.folder==="starred" || account.currentAccountId);
    const fetchQueue=()=>http.get("/v1/scheduled", {params:{...search.filters,q:search.query,
      mark:props.folder==="label" ? undefined : props.folder,labelId:props.folder==="label" ? props.labelId : undefined,
      accountId:props.folder==="starred" || account.currentAccount.allReceive ? undefined : account.currentAccountId},
      noMsg:true,headers:{Authorization:token}}).then(messages=>({messages}),e=>({error:e.message || "Could not load scheduled messages."}));
    const first=!target.cursor && !target.backward;
    const [data,initialQueue]=await Promise.all([
      searchPage(()=>conversationList({...params(),cursor:target.cursor,includeOffset:1,pageDirection:target.backward ? "backward" : undefined},token),
        current,()=>{preparingSearch.value=true;}),
      first && showQueue ? fetchQueue() : {},
    ]);
    if (!data || !current()) return;
    if (target.cursor && !data.threads.length) return load(target.backward || !data.total ? firstPage : {backward:true,cursor:null});
    const start=data.offset;
    const queue=start===0 && !first && showQueue ? await fetchQueue() : initialQueue;
    if (!current()) return;
    if (start!==offset.value && containerProps.ref.value) containerProps.ref.value.scrollTop=0;
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
    currentPage = target;
    firstCursor.value = data.firstCursor;
    offset.value = start;
    selected.value = selected.value.filter((id) =>
      rows.value.some((row) => row.lastEmailId === id),
    );
    return "loaded";
  } catch (e) {
    if (current()) {
      failedPage=target;
      error.value = e.message || "Could not load conversations.";
      return "failed";
    }
  } finally {
    if (request === generation) loading.value = false;
  }
}
function refresh() {
  emailStore.conversationListRefresh++;
  return load();
}
function retry() { return navigate(failedPage ?? currentPage,".range-trigger"); }
async function navigate(target,selector) {
  if (busy.value || loading.value) return;
  const scope=key.value, path=route.fullPath, token=owner.authenticatedToken;
  const menu=document.activeElement?.closest('[role="menu"]');
  const status=await load(target);
  await nextTick();
  if (!status || !active || !root.value?.isConnected || key.value!==scope || path!==route.fullPath ||
      token!==localStorage.getItem("token") || loading.value ||
      document.activeElement!==document.body && !menu?.contains(document.activeElement)) return;
  if (status==="failed") {
    root.value.querySelector(".retry-list")?.focus();
    return;
  }
  const bar=root.value.querySelector(".mail-toolbar");
  for (const control of [selector,".range-trigger",".select-options"]) {
    const button=bar?.querySelector(control);
    if (button && !button.disabled && button.getClientRects().length) {button.focus();break;}
  }
}
function jumpPage(edge) {
  return navigate(edge==="oldest" ? {backward:true,cursor:null} : firstPage,".range-trigger");
}
function nextPage() {
  if (hasMore.value) return navigate({cursor:cursor.value},'[aria-label="Older"]');
}
function previousPage() {
  if (offset.value) return navigate({backward:true,cursor:firstCursor.value},'[aria-label="Newer"]');
}
watch(
  [key,()=>owner.authenticatedToken],
  () => {
    generation++;
    snoozePicker.value?.close();
    currentPage = firstPage;
    firstCursor.value = null;
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
  if (busy.value || loading.value) return;
  if (selected.value.includes(id))
    selected.value = selected.value.filter((value) => value !== id);
  else if (selected.value.length < 95) selected.value.push(id);
}
const unreadQueue=computed(()=>scheduledMatches.value.filter(row=>row.unread));
const pageReadDisabled=computed(()=>busy.value || loading.value || filingQueue.value || !!error.value || !!scheduledError.value ||
  unreadQueue.value.some(row=>!["scheduled","schedule_failed"].includes(row.state)));
async function markPageRead() {
  if (pageReadDisabled.value || selected.value.length) return;
  const token=owner.authenticatedToken, scope=key.value, path=route.fullPath;
  const sameSession=()=>token && token===owner.authenticatedToken && token===localStorage.getItem("token");
  const current=()=>active && scope===key.value && path===route.fullPath && sameSession();
  if (!current()) return;
  const ids=rows.value.filter(row=>row.unreadCount).map(row=>row.lastEmailId);
  const queued=unreadQueue.value.map(({draftId,version})=>({draftId,version}));
  if (!ids.length && !queued.length) return feedback.show("No unread conversations.");
  const config={noMsg:true,headers:{Authorization:token}};
  let release,failure,changed=0;
  busy.value=true;
  try {
    if (queued.length) {
      const {default:db}=await import("@/db/db");
      if (!current()) return;
      release=holdScheduledReads(pendingScheduledReads(db.value,token),queued);
    }
    if (ids.length) {
      await conversationAction("read",ids,{},http,config);
      if (!sameSession()) return;
      changed+=ids.length;
      emailStore.conversationRevision++;
    }
    for (let i=0;i<queued.length;i+=50) {
      if (!sameSession()) return;
      const messages=queued.slice(i,i+50);
      await http.post("/v1/scheduled/read",{messages,unread:false},config);
      if (!sameSession()) return;
      changed+=messages.length;
      drafts.scheduledRevision++;
    }
  } catch(e) {
    failure=e.message || "Could not mark the page as read.";
  } finally {
    release?.();
    // A filter may have changed while its revision watcher was suppressed by busy.
    // Reconcile that view too, including successful batches before a later failure.
    if (sameSession() && active && (changed || failure)) await refresh();
    busy.value=false;
  }
  if (sameSession() && failure) feedback.show((changed ? changed+" marked as read. " : "")+failure);
  else if (current()) feedback.show(changed===1 ? "Conversation marked as read." : changed+" conversations marked as read.");
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
function rowOpenLabel(row) {
  const n = replies(row).length;
  const messages = row.messageCount + (row.messageCount === 1 ? " message" : " messages");
  const saved = n ? ", " + n + (n === 1 ? " draft" : " drafts") : "";
  return "Open " + (row.subject || "(no subject)") + ", " + messages + saved;
}
async function open(row) {
  const draft = replies(row)[0];
  if (draft) {
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
    },
  });
}
function rowCommand(command, ids, opener) {
  if (command === 'attach') return forwardMessages(ids);
  if (command === 'snooze') return snoozePicker.value?.show(opener,ids);
  if (command === 'read' || command === 'unread') return mutate('read',{unread:Number(command==='read')},ids);
  if (command === 'important' || command === 'unimportant') return mutate('importance',{important:command==='important'},ids);
  return mutate(command,{},ids);
}
async function mutate(action, extra = {}, ids = selected.value) {
  if (busy.value) return;
  const token = owner.authenticatedToken, path = route.fullPath, view = key.value;
  const sameSession = () => owner.authenticatedToken === token && localStorage.getItem("token") === token;
  if (!token || !sameSession()) return;
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
.pager:disabled {
  opacity: 0.32;
}
@media (max-width: 480px) {
  .has-selection .pager, .has-selection .mail-range { display:none; }
  .mail-toolbar {
    gap: 0;
    padding: 0 4px;
  }
  .mail-toolbar :deep(.select-options) {width:18px}
}
</style>
