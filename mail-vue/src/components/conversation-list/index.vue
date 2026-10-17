<template>
  <section class="conversation-list" aria-label="Conversations">
    <div class="list-toolbar">
      <input
        type="checkbox"
        aria-label="Select loaded conversations"
        :checked="rows.length > 0 && selected.length === rows.length"
        @change="selectAll($event.target.checked)"
      />
      <button
        aria-label="Refresh conversations"
        :disabled="loading"
        @click="refresh"
      >
        <Icon icon="material-symbols:refresh" width="21" />
      </button>
      <button
        :aria-label="ascending ? 'Sort newest first' : 'Sort oldest first'"
        @click="ascending = !ascending"
      >
        <Icon
          :icon="
            ascending
              ? 'material-symbols:arrow-upward'
              : 'material-symbols:arrow-downward'
          "
          width="21"
        />
      </button>
      <button
        v-if="selected.length"
        aria-label="Mark conversations read"
        :disabled="busy"
        @click="mutate('read')"
      >
        <Icon icon="material-symbols:mark-email-read-outline" width="21" />
      </button>
      <button
        v-if="selected.length"
        aria-label="Mark conversations unread"
        :disabled="busy"
        @click="mutate('read', { unread: 0 })"
      >
        <Icon icon="material-symbols:mark-email-unread-outline" width="21" />
      </button>
      <button
        v-if="selected.length"
        v-perm="'email:delete'"
        aria-label="Delete conversations"
        :disabled="busy"
        @click="remove"
      >
        <Icon icon="material-symbols:delete-outline" width="21" />
      </button>
      <span class="total"
        >{{ total }} conversation{{ total === 1 ? "" : "s" }}</span
      >
    </div>
    <p v-if="error" role="alert" class="list-status">
      {{ error }} <button @click="load(false)">Retry</button>
    </p>
    <div v-bind="containerProps" class="conversation-scroll">
      <div v-bind="wrapperProps">
        <div
          v-for="{ data: row, index } in virtualRows"
          :key="row.threadId"
          class="conversation-row"
          :class="{
            unread: row.unreadCount,
            selected: selected.includes(row.lastEmailId),
          }"
          @contextmenu.prevent="openContext(row)"
          @keydown.shift.f10.prevent="openContext(row)"
        >
          <input
            type="checkbox"
            :aria-label="`Select ${row.subject}`"
            :checked="selected.includes(row.lastEmailId)"
            @change="toggle(row.lastEmailId)"
          />
          <button
            :aria-label="
              row.starred ? 'Unstar conversation' : 'Star conversation'
            "
            :disabled="busy"
            @click="star(row)"
          >
            <Icon
              :icon="
                row.starred
                  ? 'fluent-color:star-16'
                  : 'material-symbols:star-outline'
              "
              width="20"
            />
          </button>
          <button
            class="conversation-open"
            @click="open(row)"
            :aria-label="`Open ${row.subject}, ${row.messageCount} messages`"
          >
            <span class="participants"
              >{{ row.participants }}
              <small v-if="row.messageCount > 1"
                >({{ row.messageCount }})</small
              ></span
            >
            <span class="summary"
              ><span class="subject">{{ row.subject || "(no subject)" }}</span
              ><span class="preview"> — {{ row.preview }}</span></span
            >
            <span
              v-if="folder === 'sent'"
              class="delivery-state"
              :title="deliveryState(row.status)"
              :aria-label="deliveryState(row.status)"
              ><Icon
                :icon="
                  row.status === 2
                    ? 'material-symbols:done-all'
                    : row.status >= 3
                      ? 'material-symbols:error-outline'
                      : 'material-symbols:send-outline'
                "
                width="16" /></span
            ><time>{{ fromNow(row.lastDate) }}</time>
          </button>
          <el-dropdown
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
        </div>
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
      <button v-if="hasMore && !loading" class="load-more" @click="load(true)">
        Load more conversations
      </button>
    </div>
  </section>
</template>
<script setup>
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
import { ElMessageBox } from "element-plus";
import { useAccountStore } from "@/store/account";
import { useEmailStore } from "@/store/email";
import { useMailSearchStore } from "@/store/mail-search";
import { useSettingStore } from "@/store/setting";
import { conversationList, conversationAction } from "@/request/conversation";
import { fromNow } from "@/utils/day";
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
  timer;
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
async function load(more = false, preserve = false) {
  if (more && loading.value) return;
  const request = ++generation,
    filter = key.value;
  loading.value = true;
  error.value = "";
  const target = preserve ? Math.max(rows.value.length, 50) : 50;
  try {
    const loaded = [];
    let next = more ? cursor.value : null;
    let data;
    do {
      data = await conversationList({ ...params(), cursor: next });
      if (request !== generation || filter !== key.value) return;
      loaded.push(...data.threads);
      next = data.nextCursor;
    } while (preserve && data.hasMore && loaded.length < target);
    rows.value = more
      ? [
          ...rows.value,
          ...loaded.filter(
            (item) => !rows.value.some((old) => old.threadId === item.threadId),
          ),
        ]
      : loaded;
    total.value = data.total;
    hasMore.value = data.hasMore;
    cursor.value = data.nextCursor;
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
  return load(false, true);
}
watch(
  key,
  () => {
    generation++;
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
    if (active) refresh();
  },
);
function toggle(id) {
  if (selected.value.includes(id))
    selected.value = selected.value.filter((value) => value !== id);
  else if (selected.value.length < 95) selected.value.push(id);
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
function open(row, reply) {
  context.value = 0;
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
    await conversationAction(action, ids, extra);
    emailStore.conversationRevision++;
    await refresh();
  } catch (e) {
    error.value = e.message || "Could not update the conversation.";
  } finally {
    busy.value = false;
  }
}
async function remove(ids = selected.value) {
  if (!Array.isArray(ids)) ids = selected.value;
  const count = rows.value
    .filter((row) => ids.includes(row.lastEmailId))
    .reduce((sum, row) => sum + row.messageCount, 0);
  try {
    await ElMessageBox.confirm(
      `Delete ${ids.length} conversation(s), containing ${count} message(s)?`,
      {
        confirmButtonText: "Delete",
        cancelButtonText: "Cancel",
        type: "warning",
      },
    );
    await mutate("delete", {}, ids);
  } catch {}
}
function star(row) {
  return mutate("star", { starred: !row.starred }, [row.lastEmailId]);
}
onActivated(() => {
  active = true;
  if (rows.value.length) refresh();
});
onDeactivated(() => {
  active = false;
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
.list-toolbar {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
}
.list-toolbar button,
.conversation-row > button {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  color: var(--regular-text-color);
}
button:hover {
  background: var(--mail-hover);
}
input[type="checkbox"] {
  accent-color: var(--el-color-primary);
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  cursor: pointer;
}
.total {
  margin-left: auto;
  color: var(--regular-text-color);
  font-size: 12px;
}
.conversation-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto !important;
}
.conversation-row {
  height: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--light-border-color);
  background: var(--mail-read);
}
.conversation-row.unread {
  background: var(--mail-surface);
  font-weight: 600;
}
.conversation-row:hover {
  box-shadow:
    inset 0 -1px var(--light-border-color),
    0 1px 4px #0002;
  position: relative;
}
.conversation-row.selected {
  background: var(--mail-selected);
}
.conversation-open {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 20px;
  height: 100%;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;
  font-size: 14px;
}
.participants {
  width: 180px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.participants small {
  font-weight: 400;
}
.summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview {
  font-weight: 400;
  color: var(--regular-text-color);
}
.delivery-state {
  display: flex;
  align-items: center;
  color: var(--regular-text-color);
  flex-shrink: 0;
}
time {
  flex-shrink: 0;
  font-size: 12px;
}
.list-status {
  padding: 32px;
  text-align: center;
  color: var(--regular-text-color);
}
.list-status button,
.load-more {
  color: var(--el-color-primary);
  cursor: pointer;
}
.load-more {
  display: block;
  margin: 20px auto 80px;
  padding: 12px 20px;
  border-radius: 24px;
}
@media (max-width: 767px) {
  .conversation-row {
    height: 84px;
    gap: 8px;
    padding: 0 12px;
  }
  .conversation-open {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 8px;
    padding: 12px 0;
  }
  .participants {
    width: auto;
  }
  .summary {
    grid-column: 1/-1;
    grid-row: 2;
  }
  .preview {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .delivery-state {
    display: none;
  }
  .total {
    font-size: 11px;
  }
  .list-toolbar {
    padding: 0 12px;
    gap: 4px;
  }
}
</style>
