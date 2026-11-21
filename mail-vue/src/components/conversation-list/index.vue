<template>
  <section class="conversation-list" aria-label="Conversations">
    <div class="mail-toolbar">
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
          :aria-expanded="Boolean(snoozeAnchor && !snoozeRow)"
          @click="chooseSnooze(selected, $event)"
        >
          <Icon icon="material-symbols:schedule-outline" width="20" />
        </button>
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
    <p v-if="error" role="alert" class="list-status">
      {{ error }} <button @click="refresh">Retry</button>
    </p>
    <div v-bind="containerProps" class="conversation-scroll">
      <div v-bind="wrapperProps">
        <MailRow
          v-for="{ data: row } in virtualRows"
          :key="row.threadId"
          :participants="row.participants"
          :count="row.messageCount"
          :subject="row.subject"
          :preview="replies(row)[0]?.preview || row.preview"
          :draft-count="replies(row).length"
          :date="mailboxDate(rowDate(row))"
          :date-title="formatDetailDate(rowDate(row))"
          :selected="selected.includes(row.lastEmailId)"
          :starred="Boolean(row.starred)"
          :unread="Boolean(row.unreadCount)"
          :busy="busy"
          :open-label="`Open ${row.subject || '(no subject)'}, ${row.messageCount} messages${replies(row).length ? ', draft' : ''}`"
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
              :data-tip="filingLabel"
              :aria-label="filingLabel"
              :disabled="busy"
              @click="mutate(filingAction, {}, [row.lastEmailId])"
            >
              <Icon :icon="filingIcon" width="20" />
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
                Boolean(snoozeAnchor) && snoozeRow === row.lastEmailId
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
        Loading conversations…
      </p>
      <p v-else-if="!rows.length && !error" class="list-status">
        {{
          search.query
            ? "No conversations match your search."
            : "No conversations here."
        }}
      </p>
    </div>
    <el-dropdown
      v-if="snoozeAnchor"
      ref="snoozeMenu"
      virtual-triggering
      :virtual-ref="snoozeAnchor"
      :trigger="[]"
      placement="bottom-end"
      :show-arrow="false"
      popper-class="mail-action-menu snooze-menu"
      @visible-change="!$event && (snoozeAnchor = null)"
      @command="snoozeCommand"
    >
      <template #dropdown>
        <el-dropdown-menu>
          <div class="snooze-heading">Snooze until</div>
          <el-dropdown-item
            v-for="option in snoozeOptions"
            :key="option.label"
            :command="option.date"
          >
            <span>{{ option.label }}</span><small>{{ option.detail }}</small>
          </el-dropdown-item>
          <el-dropdown-item divided command="custom"
            >Pick date &amp; time</el-dropdown-item
          >
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <el-dialog
      v-model="snoozeOpen"
      title="Pick date &amp; time"
      class="mail-dialog"
      width="340px"
      append-to-body
    >
      <div class="snooze-options">
        <label
          >Pick a date and time<input
            type="datetime-local"
            v-model="customTime"
        /></label>
        <el-button
          type="primary"
          :disabled="!(new Date(customTime) > new Date())"
          @click="applySnooze(new Date(customTime))"
          >Save</el-button
        >
      </div>
    </el-dialog>
  </section>
</template>
<script setup>
import { useMailFeedback } from "@/store/mail-feedback";
const feedback = useMailFeedback();
import {
  ref,
  computed,
  watch,
  onActivated,
  onDeactivated,
  onUnmounted,
  nextTick,
} from "vue";
import { useVirtualList, useWindowSize } from "@vueuse/core";
import { Icon } from "@iconify/vue";
import { useRouter, useRoute } from "vue-router";

import { useAccountStore } from "@/store/account";
import { useEmailStore } from "@/store/email";
import { useMailSearchStore } from "@/store/mail-search";
import { useSettingStore } from "@/store/setting";
import { conversationList, conversationAction } from "@/request/conversation";
import { formatDetailDate, mailboxDate, tzDayjs } from "@/utils/day";
import MailRow from "@/components/mail-row/index.vue";
import { userDraftStore } from "@/store/draft";
const drafts = userDraftStore();
const props = defineProps({ folder: String });
const account = useAccountStore(),
  emailStore = useEmailStore(),
  search = useMailSearchStore(),
  settings = useSettingStore();
const router = useRouter(),
  route = useRoute();
const rows = ref([]),
  selected = ref([]),
  ascending = ref(false),
  loading = ref(false),
  busy = ref(false),
  error = ref(""),
  total = ref(0),
  cursor = ref(null),
  hasMore = ref(false),
  context = ref(0),
  contextDropdown = ref();
const { width } = useWindowSize();
const {
  list: virtualRows,
  containerProps,
  wrapperProps,
} = useVirtualList(rows, {
  itemHeight: () => (width.value < 768 ? 84 : 40),
  overscan: 12,
});
let generation = 0,
  active = true,
  timer,
  wakeTimer;
const key = computed(() =>
  [
    props.folder,
    props.folder === "starred" ? "" : account.currentAccountId,
    props.folder === "starred" ? "" : account.currentAccount.allReceive,
    ascending.value,
    search.query,
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
    accountId: account.currentAccountId,
    allReceive: account.currentAccount.allReceive ? 1 : 0,
    timeSort: ascending.value ? 1 : 0,
    q: search.query,
    limit: 50,
  };
}
const history = ref([]);
const pageCursor = ref(null);
const offset = ref(0);
const selectedUnread = computed(() =>
  rows.value.some(
    (row) => selected.value.includes(row.lastEmailId) && row.unreadCount,
  ),
);
const filingAction = computed(() =>
  ["archived", "snoozed"].includes(props.folder) ? "inbox" : "archive",
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
const snoozeOpen = ref(false),
  snoozeIds = ref([]),
  customTime = ref(""),
  snoozeOptions = ref([]);
const snoozeAnchor = ref(null),
  snoozeMenu = ref(null),
  snoozeRow = ref(0);
async function chooseSnooze(ids, event, row = 0) {
  if (snoozeAnchor.value === event.currentTarget) {
    snoozeAnchor.value = null;
    return;
  }
  snoozeAnchor.value = event.currentTarget;
  snoozeRow.value = row;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const nextWeek = new Date(tomorrow);
  nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7));
  const option = (label, date) => ({
    label,
    date,
    detail: date.toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }),
  });
  snoozeOptions.value = [option("Tomorrow", tomorrow)];
  if (nextWeek > tomorrow)
    snoozeOptions.value.push(option("Next week", nextWeek));
  snoozeIds.value = [...ids];
  customTime.value = "";
  await nextTick();
  snoozeMenu.value?.handleOpen();
}
function snoozeCommand(value) {
  if (value === "custom") snoozeOpen.value = true;
  else applySnooze(value);
}
function applySnooze(date) {
  if (!(date > new Date())) return;
  snoozeOpen.value = false;
  return mutate(
    "snooze",
    { wakeAt: Math.floor(date.getTime() / 1000) },
    snoozeIds.value,
  );
}
async function load(
  target = { cursor: pageCursor.value, offset: offset.value },
  prior = history.value,
) {
  const request = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const data = await conversationList({ ...params(), cursor: target.cursor });
    if (request !== generation) return;
    if (target.cursor && data.total !== total.value)
      return await load({ cursor: null, offset: 0 }, []);
    if (!data.threads.length && prior.length)
      return await load(prior.at(-1), prior.slice(0, -1));
    if (target.cursor !== pageCursor.value)
      containerProps.ref.value?.scrollTo?.(0, 0);
    rows.value = data.threads;
    total.value = data.total;
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
    snoozeAnchor.value = null;
    snoozeOpen.value = false;
    history.value = [];
    pageCursor.value = null;
    offset.value = 0;
    hasMore.value = false;
    total.value = 0;
    rows.value = [];
    selected.value = [];
    cursor.value = null;
    containerProps.ref.value?.scrollTo?.(0, 0);
    load();
  },
  { immediate: true },
);
watch(
  () => emailStore.conversationRevision,
  () => {
    if (active && !busy.value) refresh();
  },
);
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
async function open(row, reply) {
  context.value = 0;
  const draft = replies(row)[0];
  if (draft && !reply) {
    try {
      const { openSavedDraft } = await import("@/services/draft-list");
      await openSavedDraft(draft.draftId, router, props.folder);
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
      ...(reply ? { reply } : {}),
    },
  });
}
async function mutate(action, extra = {}, ids = selected.value) {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await conversationAction(action, ids, extra);
    if (action === "delete") feedback.trashed(result?.emailIds || [], ids.length);
    selected.value = selected.value.filter((id) => !ids.includes(id));
    emailStore.conversationRevision++;
    await refresh();
  } catch (e) {
    error.value = e.message || "Could not update the conversation.";
  } finally {
    busy.value = false;
  }
}
function remove(ids = selected.value) {
  return mutate("delete", {}, Array.isArray(ids) ? ids : selected.value);
}
function star(row) {
  return mutate("star", { starred: !row.starred }, [row.lastEmailId]);
}
onActivated(() => {
  active = true;
  if (!loading.value) refresh();
});
onDeactivated(() => {
  active = false;
  snoozeAnchor.value = null;
  snoozeOpen.value = false;
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
  generation++;
  clearInterval(timer);
  clearTimeout(wakeTimer);
});
defineExpose({ refresh });
</script>
<style scoped>
.conversation-list {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
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
.snooze-options {
  display: grid;
  gap: 8px;
}
.snooze-options label {
  display: flex;
  justify-content: space-between;
  padding: 8px;
  gap: 8px;
}
.snooze-options label {
  flex-direction: column;
}
.snooze-options input {
  color: inherit;
  background: var(--mail-surface);
  border: 1px solid var(--light-border-color);
  padding: 8px;
}
@media (max-width: 480px) {
  .mail-toolbar {
    gap: 0;
    padding: 0 4px;
  }
  .mail-toolbar .total {
    padding: 0 2px;
  }
}
</style>
