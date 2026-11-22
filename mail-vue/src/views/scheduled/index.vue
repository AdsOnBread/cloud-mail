<template>
  <section class="scheduled-view" aria-label="Scheduled messages">
    <FolderFilters v-if="!messageId" folder="scheduled" :account-id="scope" />
    <div class="mail-toolbar" :class="{'selected-toolbar':selected.length && !messageId}">
      <button
        v-if="messageId"
        class="mail-icon"
        :data-tip="backLabel"
        :aria-label="backLabel"
        ref="backButton" data-reader-back
        @click="back"
      >
        <Icon icon="material-symbols:arrow-back" width="20" />
      </button>
      <template v-else>
        <label class="check-target" data-tip="Select">
          <input
            type="checkbox"
            aria-label="Select scheduled messages"
            :checked="page.length > 0 && selected.length === page.length"
            :indeterminate="
              selected.length > 0 && selected.length < page.length
            "
            :disabled="busy || !page.length"
            @change="select($event.target.checked)"
          />
        </label>
        <el-dropdown
          trigger="click"
          placement="bottom-start"
          :show-arrow="false"
          popper-class="mail-action-menu"
          @command="select"
        >
          <button
            class="mail-icon select-options"
            aria-label="Selection options"
            ref="selectionButton"
            data-tip="Select"
          >
            <Icon icon="material-symbols:arrow-drop-down" width="16" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="option in selectionOptions" :key="option" :command="option">{{ option }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button
          v-if="selected.length"
          class="cancel-action"
          :disabled="busy || targets.some((row) => !canCancel(row))"
          @click="cancel(targets)"
        >
          Cancel send
        </button>
        <template v-else>
          <button
            class="mail-icon"
            aria-label="Refresh scheduled mail"
            data-tip="Refresh"
            :disabled="loading"
            @click="drafts.scheduledRevision++"
          >
            <Icon icon="material-symbols:refresh" width="20" />
          </button>
          <el-dropdown
            trigger="click"
            placement="bottom-start"
            :show-arrow="false"
            popper-class="mail-action-menu"
          >
            <button
              class="mail-icon"
              aria-label="More email options"
              data-tip="More"
            >
              <Icon icon="material-symbols:more-vert" width="20" />
            </button>
            <template #dropdown
              ><el-dropdown-menu>
                <el-dropdown-item @click="latestFirst = !latestFirst">{{
                  latestFirst
                    ? "Show earliest scheduled first"
                    : "Show latest scheduled first"
                }}</el-dropdown-item>
              </el-dropdown-menu></template
            >
          </el-dropdown>
        </template>
      </template>
      <button v-if="readTargets.length" class="mail-icon" :aria-label="readAction" :data-tip="readAction"
        :disabled="busy || (messageId && !detail) || readTargets.some(row=>!canCancel(row) || reading.has(row.draftId))"
        @click="setRead(readTargets, readAction==='Mark as unread', Boolean(messageId))">
        <Icon :icon="readIcon(readAction==='Mark as read')" width="20" />
      </button>
      <button v-if="readTargets.length" class="mail-icon" :aria-label="inboxAction" :data-tip="inboxAction"
        :disabled="busy || readTargets.some(row=>!canCancel(row))" @click="fileInbox(readTargets, moveIntoInbox)">
        <Icon :icon="moveIntoInbox ? 'material-symbols:move-to-inbox-outline' : 'material-symbols:archive-outline'" width="20"/>
      </button>
      <ScheduledLabelActions v-if="readTargets.length" ref="labelActions" :rows="readTargets" :disabled="busy"
        :can-delete="canDelete" :filing-disabled="labelsDisabled" @trash="trash(readTargets)" @apply="applyLabels" @snooze="chooseSnooze(readTargets,$event)"/>
      <div class="scheduled-pager">
      <span class="total">{{ range }}</span>
      <button
        class="mail-icon"
        aria-label="Previous"
        data-tip="Previous"
        :disabled="busy || (messageId ? position <= 0 : offset === 0)"
        @click="step(-1)"
      >
        <Icon icon="material-symbols:chevron-left" width="20" />
      </button>
      <button
        class="mail-icon"
        aria-label="Next"
        data-tip="Next"
        :disabled="
          busy ||
          (messageId
            ? position < 0 || position >= ordered.length - 1
            : offset + 50 >= ordered.length)
        "
        @click="step(1)"
      >
        <Icon icon="material-symbols:chevron-right" width="20" />
      </button>
      </div>
    </div>
    <p v-if="listError || error" class="list-status" role="alert">
      {{ listError || error }}
      <button v-if="listError || detailError" @click="retry">Retry</button>
    </p>
    <div v-if="messageId" class="scroll">
      <ScheduledMessage
        v-if="item"
        :key="item.draftId"
        :row="item"
        :labels="visibleLabels(item,true)"
        :detail="detail"
        :status="status(item)"
        :short-recipients="who(item)"
        :can-cancel="canCancel(item)"
        :busy="busy"
        @star="mark(item, 'starred', !item.starred)"
        @importance="mark(item, 'important', $event)"
        @unsnooze="fileInbox([item],true)"
        @cancel="cancel([item])"
        @error="error = $event"
      />
      <p v-else-if="!listError" class="empty" role="status">
        {{ loading ? "Loading…" : "This message is no longer in Scheduled." }}
      </p>
    </div>
    <div v-else ref="scroll" class="scroll">
      <p class="notice">
        <Icon icon="material-symbols:schedule-send-outline" width="20" aria-hidden="true" />
        Messages in Scheduled will be sent at their scheduled time.
      </p>
      <MailRow
        v-for="row in page"
        :key="row.draftId"
        :data-scheduled-id="row.draftId"
        :class="{'awaiting-delivery':row.state==='scheduled'}"
        :starred="Boolean(row.starred)"
        :unread="Boolean(row.unread)"
        show-importance
        :importance-reason="row.importanceReason"
        :busy="busy || !canCancel(row)"
        @star="mark(row, 'starred', !row.starred)"
        @importance="mark(row, 'important', $event)"
        :participants="'To: ' + who(row)"
        :subject="row.subject"
        :labels="visibleLabels(row)"
        :preview="row.preview"
        :date="
          row.state === 'scheduled'
            ? mailboxDate(row.sendAt * 1000)
            : status(row)
        "
        :date-title="status(row)"
        :selected="selected.includes(row.draftId)"
        :attachments="row.attachments"
        :attachment-count="row.attachmentCount"
        :open-label="
          'Open scheduled message: ' + (row.subject || '(no subject)')
        "
        @select="toggle(row.draftId)"
        @open="open(row)"
      >
        <template v-if="canCancel(row)" #actions>
          <button class="mail-icon" aria-label="Archive" data-tip="Archive" :disabled="busy || !row.inbox" @click="fileInbox([row],false)">
            <Icon icon="material-symbols:archive-outline" width="20"/>
          </button>
          <button v-if="canDelete" class="mail-icon" aria-label="Delete" data-tip="Delete" :disabled="busy" @click="trash([row])">
            <Icon icon="material-symbols:delete-outline" width="20"/>
          </button>
          <button class="mail-icon" :aria-label="row.unread ? 'Mark as read' : 'Mark as unread'"
            :data-tip="row.unread ? 'Mark as read' : 'Mark as unread'" :disabled="busy || reading.has(row.draftId)"
            @click="setRead([row],!row.unread)">
            <Icon :icon="readIcon(row.unread)" width="20" />
          </button>
          <button class="mail-icon" aria-label="Snooze" data-tip="Snooze" aria-haspopup="menu"
            :aria-expanded="Boolean(snoozePicker?.anchor && snoozeRow===row.draftId)" :disabled="busy"
            @click="chooseSnooze([row],$event.currentTarget,row.draftId)"><Icon icon="material-symbols:schedule-outline" width="20"/></button>
          <button
            class="mail-icon"
            :aria-label="'Cancel send for ' + row.subject"
            data-tip="Cancel send"
            :disabled="busy"
            @click="cancel([row])"
          >
            <Icon icon="material-symbols:undo" width="20" />
          </button>
        </template>
      </MailRow>
      <p v-if="!page.length && !listError" class="empty" role="status">
        {{
          loading
            ? "Loading…"
            : filtered
              ? "No messages match your search."
              : "No scheduled messages."
        }}
      </p>
    </div>
    <MailSnoozePicker ref="snoozePicker" @choose="(wakeAt,batch)=>fileInbox(batch,true,wakeAt)"/>
  </section>
</template>
<script setup>
import {
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
} from "vue";
import { hasPerm } from "@/perm/perm";
import { Icon } from "@iconify/vue";
import { useRouter, useRoute } from "vue-router";
import http from "@/axios";
import db from "@/db/db";
import { useAccountStore } from "@/store/account";
import { useUserStore } from "@/store/user";
import { userDraftStore } from "@/store/draft";
import { useMailFeedback } from "@/store/mail-feedback";
import { useMailSearchStore } from "@/store/mail-search";
import {deleteScheduled} from '@/services/scheduled-trash';
import {fileScheduledMessages} from "@/services/scheduled-filing";
import {pendingScheduledReads} from "@/services/scheduled-read";
import { syncCloudDrafts } from "@/services/cloud-drafts";
import { openSavedDraft } from "@/services/draft-list";
import { mailboxDate, formatDetailDate } from "@/utils/day";
import MailRow from "@/components/mail-row/index.vue";
import MailSnoozePicker from "@/components/mail-snooze-picker.vue";
import FolderFilters from "@/components/mail-folder-filters.vue";
import {useMailLabels} from "@/store/mail-labels";
import ScheduledLabelActions from "./label-actions.vue";
import ScheduledMessage from "./message.vue";

const router = useRouter(),
  route = useRoute(),
  account = useAccountStore(),
  user = useUserStore(),
  drafts = userDraftStore(),
  feedback = useMailFeedback(),
  search = useMailSearchStore();
const labelStore = useMailLabels();
function visibleLabels(row,reader=false) {
  return labelStore.items.filter(label=>(reader || label.messages!=="hide") && row.labelIds?.includes(label.id));
}
const originLabelId = computed(()=>route.query.from==="label" && /^\d+$/.test(route.query.labelId || "") ? Number(route.query.labelId) : 0);
const originFolder = computed(() => originLabelId.value ? "label" : ["starred","important","inbox","snoozed"].includes(route.query.from) ? route.query.from : "");
const backLabel = computed(() => "Back to " + ({starred:"Starred", important:"Important",label:"label",inbox:"Inbox",snoozed:"Snoozed"}[originFolder.value] || "Scheduled"));
const receiptSender = computed(() => Number(route.query.message) > 0 && /^\d+$/.test(route.query.sender || "") ? Number(route.query.sender) : 0);
const scope = computed(() => receiptSender.value || (
  account.currentAccount.allReceive || originFolder.value === "starred" ? undefined : account.currentAccountId),
);
const identity = computed(() => JSON.stringify([user.user.email, account.currentAccountId, Boolean(account.currentAccount.allReceive)]));
const messageId = computed(() => Number(route.query.message) || 0);
const rows = ref([]),
  selected = ref([]),
  detail = ref(null),
  offset = ref(0),
  latestFirst = ref(false),
  scroll = ref();
const loading = ref(true),
  busy = ref(false),
  listError = ref(""),
  detailError = ref(false),
  error = ref("");
const ordered = computed(() => {
  // Opening the last unread result keeps its reader and pager until the user leaves.
  let matches = !receiptSender.value && search.filters.isUnread ? rows.value.filter(row=>row.unread || row.draftId===messageId.value) : rows.value;
  if (originLabelId.value) matches=matches.filter(row=>row.labelIds?.includes(originLabelId.value));
  if (originFolder.value === "snoozed") matches=matches.filter(row=>row.wakeAt && !row.inbox).sort((a,b)=>a.wakeAt-b.wakeAt || a.draftId-b.draftId);
  if (originFolder.value === "inbox") matches=matches.filter(row=>row.inbox);
  if (originFolder.value === "starred") matches = matches.filter(row => row.starred);
  if (originFolder.value === "important") matches = matches.filter(row => row.importanceReason);
  return latestFirst.value && !originFolder.value ? [...matches].reverse() : matches;
});
const page = computed(() =>
  ordered.value.slice(offset.value, offset.value + 50),
);
const position = computed(() =>
  ordered.value.findIndex((row) => row.draftId === messageId.value),
);
// Keep the open message readable when its last mark is removed.
const item = computed(() => rows.value.find(row => row.draftId === messageId.value));
const targets = computed(() =>
  page.value.filter((row) => selected.value.includes(row.draftId)),
);
const readTargets = computed(()=>messageId.value ? (item.value ? [item.value] : []) : targets.value);
const moveIntoInbox=computed(()=>readTargets.value.some(row=>!row.inbox));
const inboxAction=computed(()=>moveIntoInbox.value ? 'Move to Inbox' : 'Archive');
const readAction = computed(()=>readTargets.value.some(row=>row.unread) ? 'Mark as read' : 'Mark as unread');
const readIcon = unread => unread ? 'material-symbols:drafts-outline' : 'material-symbols:mail-outline';
const reading = computed(()=>pendingScheduledReads(db.value,user.authenticatedToken));
const selectionOptions = ['All','None','Read','Unread','Starred','Unstarred'];
const filtered = computed(() =>
  Boolean(search.query || Object.keys(search.filters).length),
);
const range = computed(() => {
  if (messageId.value)
    return position.value < 0
      ? ""
      : position.value + 1 + " of " + ordered.value.length;
  return page.value.length
    ? offset.value +
        1 +
        "–" +
        (offset.value + page.value.length) +
        " of " +
        ordered.value.length
    : "";
});
const canDelete = computed(()=>hasPerm("email:delete"));
const canCancel = (row) => ["scheduled", "schedule_failed"].includes(row.state);
const labelActions=ref();
const labelsDisabled=computed(()=>busy.value || !readTargets.value.length || readTargets.value.some(row=>!canCancel(row)));
async function applyLabels(ops,messages) {
  if (labelsDisabled.value) return;
  const owner=identity.value, token=user.authenticatedToken, navigation=navigations;
  const current=()=>!disposed && identity.value===owner && token===user.authenticatedToken && navigations===navigation;
  busy.value=true;
  error.value='';
  try {
    await labelStore.labelScheduled(messages,ops);
    if (current()) feedback.show('Labels updated.');
  } catch (e) {
    if (current()) error.value=e.message || 'Could not update labels.';
  } finally {
    busy.value=false;
    await nextTick();
    if (current() && document.activeElement===document.body) labelActions.value?.focus();
  }
}
function status(row) {
  if (row.state === "scheduled")
    return "Send scheduled for " + formatDetailDate(row.sendAt * 1000);
  if (row.state === "schedule_failed") return "Could not send";
  return row.state === "uncertain"
    ? "Delivery uncertain — check Sent"
    : "Sending…";
}
function who(row) {
  const recipients = row.recipients?.length
    ? row.recipients
    : [...(row.cc || []), ...(row.bcc || [])];
  return recipients
    .map((address) =>
      account.ownAddresses.some(
        (own) => own.toLowerCase() === address.toLowerCase(),
      )
        ? "me"
        : address.split("@")[0],
    )
    .join(", ");
}
let generation = 0,
  detailRequest = 0,
  interaction = 0,
  navigations = 0,
  disposed = false;
watch(
  () => route.fullPath,
  () => { interaction++; navigations++; },
  { flush: "sync" },
);
async function load() {
  const request = ++generation;
  const identityAtStart = identity.value;
  if (!user.user.email || !account.currentAccountId) return;
  loading.value = true;
  listError.value = "";
  try {
    const data = await http.get("/v1/scheduled", {
      // Scheduled is capped at 100 messages. Keep read state available for the open reader.
      params: { accountId: scope.value, ...(receiptSender.value ? {} : {q: search.query, ...search.filters}), isUnread:undefined },
      noMsg: true,
    });
    if (
      disposed ||
      request !== generation ||
      identityAtStart !== identity.value
    )
      return;
    rows.value = data;
    offset.value = Math.min(
      offset.value,
      Math.floor(Math.max(0, ordered.value.length - 1) / 50) * 50,
    );
    selected.value = selected.value.filter((id) =>
      page.value.some((row) => row.draftId === id),
    );
  } catch (e) {
    if (request === generation)
      listError.value = e.message || "Could not load Scheduled.";
  } finally {
    if (request === generation) loading.value = false;
  }
}
async function loadDetail() {
  const request = ++detailRequest;
  detail.value = null;
  error.value = "";
  detailError.value = false;
  if (!item.value) return;
  const id=messageId.value, owner=identity.value, session=localStorage.getItem('token');
  const current=()=>!disposed && request===detailRequest && id===messageId.value &&
    owner===identity.value && session===localStorage.getItem('token');
  try {
    // A row action can still be writing its unread mark when the reader opens.
    // Fetch the authoritative state only after that write has finished.
    const pending=reading.value.get(id);
    if (pending) await pending;
    if (!current()) return;
    const data = await http.get("/v1/scheduled/" + id, {
      noMsg: true,
    });
    if (
      current() &&
      data.draftId === messageId.value &&
      (scope.value == null || data.accountId === scope.value)
    ) {
      detail.value = data;
      if (data.scheduledUnread && canCancel(data)) await setRead([data],false);
    }
  } catch (e) {
    if (request === detailRequest) {
      detailError.value = true;
      error.value = e.message || "Could not open the scheduled message.";
    }
  }
}
function retry() {
  if (listError.value) load();
  else loadDetail();
}
function open(row, replace = false) {
  const location = { name: "scheduled", query: { message: row.draftId, window:route.query.window==="1" ? "1" : undefined, sender:receiptSender.value || undefined, from: originFolder.value || undefined, labelId:originLabelId.value || undefined } };
  return replace ? router.replace(location) : router.push(location);
}
function back() {
  if (originFolder.value) {
    const path = originLabelId.value ? "/label/"+originLabelId.value : "/" + originFolder.value;
    if (window.history.state?.back?.split("?")[0] === path) router.back();
    else router.replace(path);
    return;
  }
  if (window.history.state?.back === "/scheduled") router.back();
  else router.replace({ name: "scheduled" });
}
function step(direction) {
  if (item.value) return open(ordered.value[position.value + direction], true);
  interaction++;
  offset.value += 50 * direction;
  selected.value = [];
  scroll.value?.scrollTo(0, 0);
}
function select(option) {
  if (busy.value) return;
  const matches = {
    All:()=>true, None:()=>false, Read:row=>!row.unread, Unread:row=>row.unread,
    Starred:row=>row.starred, Unstarred:row=>!row.starred,
  };
  const match=matches[option===true ? 'All' : option===false ? 'None' : option];
  if (match) selected.value=page.value.filter(match).map(row=>row.draftId);
}
async function setRead(batch,unread,leaveReader=false) {
  const operations=reading.value;
  if (!batch.length || batch.some(row=>!canCancel(row) || operations.has(row.draftId))) return;
  const owner=identity.value, email=user.user.email, session=localStorage.getItem("token"), origin=route.fullPath;
  const sameSession=()=>user.user.email===email && localStorage.getItem("token")===session;
  const current=()=>!disposed && identity.value===owner && sameSession();
  const focused=document.activeElement, navigation=navigations;
  const messages=batch.map(({draftId,version})=>({draftId,version}));
  let finish;
  const pending=new Promise(resolve=>{finish=resolve});
  for (const {draftId} of messages) operations.set(draftId,pending);
  try {
    await http.post('/v1/scheduled/read',{messages,unread},{noMsg:true});
    // The user may already be back in a filtered Starred, Important or label list.
    if (sameSession()) drafts.scheduledRevision++;
    if (!current()) return;
    const ids=new Set(messages.map(row=>row.draftId));
    for (const row of rows.value) if (ids.has(row.draftId)) row.unread=Number(unread);
    if (leaveReader && route.fullPath===origin && navigation===navigations) back();
    else if (!messageId.value && search.filters.isUnread && !unread) {
      await nextTick();
      if (current() && route.fullPath===origin && navigation===navigations && !focused?.isConnected && document.activeElement===document.body)
        focusList();
    }
  } catch(e) {
    if (current()) {
      await load();
      if (current()) error.value=e.message || 'Could not update read status.';
    }
  } finally {
    for (const {draftId} of messages) operations.delete(draftId);
    finish();
  }
}
function toggle(id) {
  if (!busy.value)
    selected.value = selected.value.includes(id)
      ? selected.value.filter((key) => key !== id)
      : [...selected.value, id];
}
const snoozePicker=ref(),snoozeRow=ref(0);
function chooseSnooze(batch,element,rowId=0) {
  if (busy.value || !batch.length || batch.some(row=>!canCancel(row))) return;
  snoozeRow.value=rowId;
  snoozePicker.value?.show(element,batch.map(({draftId,version,state})=>({draftId,version,state})),batch.length===1 ? batch[0].wakeAt : 0);
}
watch([identity,()=>user.authenticatedToken,()=>route.fullPath,()=>selected.value.join(',')],()=>snoozePicker.value?.close(),{flush:'sync'});
async function trash(batch) {
  if (!canDelete.value || busy.value || !batch.length || batch.some(row=>!canCancel(row))) return;
  const owner=identity.value,token=user.authenticatedToken,navigation=navigations;
  const sameSession=()=>token && user.authenticatedToken===token && localStorage.getItem('token')===token;
  const current=()=>sameSession() && !disposed && identity.value===owner && navigations===navigation;
  const focused=document.activeElement;
  const focusId=Number(focused?.closest('[data-scheduled-id]')?.dataset.scheduledId);
  const toolbarFocus=Boolean(focused?.closest('.selected-toolbar'));
  const removed=new Set(batch.map(row=>row.draftId));
  const restoreFocus=removed.has(focusId) || toolbarFocus;
  const index=page.value.findIndex(row=>toolbarFocus ? removed.has(row.draftId) : row.draftId===focusId);
  busy.value=true;
  error.value='';
  try {
    if (!await deleteScheduled(batch)) return;
    if (current()) {
      rows.value=rows.value.filter(row=>!removed.has(row.draftId));
      selected.value=selected.value.filter(id=>!removed.has(id));
      if (removed.has(messageId.value)) back();
      else if (restoreFocus && (document.activeElement===focused || document.activeElement===document.body)) {
        nextTick(()=>{
          if (current() && document.activeElement===document.body)
            focusList(page.value[Math.min(index,page.value.length-1)]?.draftId);
        });
      }
    }
  } catch(e) {
    if (current()) error.value=e.message || 'Could not move the message to Trash.';
  } finally {
    if (sameSession()) drafts.scheduledRevision++;
    busy.value=false;
  }
}
async function fileInbox(batch,inbox,wakeAt=0) {
  if (busy.value || !batch.length || batch.some(row=>!canCancel(row))) return;
  const owner=identity.value, session=localStorage.getItem('token'), navigation=navigations;
  const current=()=>!disposed && identity.value===owner && session===localStorage.getItem('token');
  busy.value=true;
  error.value='';
  try {
    await fileScheduledMessages(batch,inbox,wakeAt);
    if (!current()) return;
    const ids=new Set(batch.map(row=>row.draftId));
    for (const row of rows.value) if (ids.has(row.draftId)) {row.inbox=Number(inbox && !wakeAt);row.wakeAt=wakeAt;}
    if (navigation===navigations && ids.has(messageId.value) &&
      ((originFolder.value==='inbox' && (!inbox || wakeAt)) || (originFolder.value==='snoozed' && !wakeAt))) back();
  } catch(e) {
    if (current()) error.value=e.message || 'Could not change Inbox placement.';
  } finally {busy.value=false;}
}
async function mark(row, field, value) {
  if (busy.value || !canCancel(row)) return;
  const owner = identity.value, email = user.user.email;
  const session = localStorage.getItem("token");
  const sameSession = () => user.user.email === email && localStorage.getItem("token") === session;
  const current = () => !disposed && identity.value === owner && sameSession();
  busy.value = true;
  error.value = "";
  try {
    await http.post("/v1/scheduled/" + row.draftId + "/mark", {version: row.version, field, value}, {noMsg:true});
    if (sameSession()) drafts.scheduledRevision++;
    if (!current()) return;
    const saved = rows.value.find(item => item.draftId === row.draftId);
    if (saved) {
      if (field === "starred") saved.starred = value;
      else saved.importanceReason = value ? "user" : null;
    }
  } catch (e) {
    if (current()) {
      await load();
      if (current()) error.value = e.message || "Could not update the scheduled message.";
    }
  } finally {
    busy.value = false;
  }
}
async function cancel(batch) {
  if (busy.value || !batch.length || batch.some((row) => !canCancel(row)))
    return;
  const database = db.value,
    owner = identity.value;
  const session = localStorage.getItem("token"),
    sameMailbox = () =>
      !disposed &&
      db.value === database &&
      identity.value === owner &&
      localStorage.getItem("token") === session;
  const context = interaction;
  const origin = route.fullPath;
  busy.value = true;
  error.value = "";
  const canceled = [];
  let changed = 0;
  try {
    for (const row of batch) {
      if (!sameMailbox()) break;
      try {
        await http.post(
          "/v1/scheduled/" + row.draftId + "/cancel",
          { version: row.version },
          { noMsg: true },
        );
        canceled.push(row.draftId);
      } catch (e) {
        const code = Number(e.code || e.response?.status);
        if (code !== 404 && code !== 409) throw e;
        changed++;
      }
    }
  } catch (e) {
    if (sameMailbox())
      error.value = e.message || "Could not cancel scheduled delivery.";
  }
  try {
    if (!sameMailbox()) return;
    if (changed)
      error.value = [
        error.value,
        changed === 1
          ? "One message changed before it could be canceled."
          : changed + " messages changed before they could be canceled.",
      ]
        .filter(Boolean)
        .join(" ");
    if (canceled.length) {
      const notice =
        canceled.length === 1
          ? "Message returned to Drafts."
          : canceled.length + " messages returned to Drafts.";
      feedback.show(notice);
      drafts.scheduledRevision++;
      await syncCloudDrafts();
      const stillAtOrigin = () => sameMailbox() && interaction === context && route.fullPath === origin;
      if (batch.length === 1 && stillAtOrigin()) {
        const draft = await database.draft.where("cloudDraftId").equals(canceled[0]).first();
        if (!draft || !stillAtOrigin()) return;
        if (canceled.includes(messageId.value)) {
          const before = navigations;
          const failure = await router.replace({name:"scheduled", query:route.query.window==="1" ? {window:"1"} : {}});
          // Leaving a filtered reader also resets search. Only a competing navigation
          // or mailbox switch should interrupt reopening the newly editable draft.
          if (failure || !sameMailbox() || route.name !== "scheduled" || messageId.value || navigations !== before + 1) return;
        }
        await openSavedDraft(draft.draftId, router, "draft");
      }
    } else await load();
  } catch (e) {
    if (sameMailbox())
      error.value = e.message || "Could not reopen this draft.";
  } finally {
    busy.value = false;
  }
}
watch(
  [() => user.user.email, scope, () => account.currentAccountId, receiptSender],
  (_, old) => {
    rows.value = [];
    selected.value = [];
    offset.value = 0;
    detail.value = null;
    error.value = "";
    if (old?.[0] && old[2] && messageId.value && (old[2] !== account.currentAccountId || old[0] !== user.user.email))
      router.replace({ name: "scheduled" });
    load();
  },
  { immediate: true, flush: "sync" },
);
watch(
  [() => search.query, () => search.filters],
  () => {
    interaction++;
    offset.value = 0;
    selected.value = [];
    rows.value = [];
    load();
  },
  { flush: "sync" },
);
watch(() => drafts.scheduledRevision, load);
watch(latestFirst, () => {
  interaction++;
  offset.value = 0;
  selected.value = [];
  scroll.value?.scrollTo(0, 0);
});
watch(
  [messageId, () => item.value?.draftId, () => item.value?.version],
  () => {
    if (position.value >= 0)
      offset.value = Math.floor(position.value / 50) * 50;
    loadDetail();
  },
  { immediate: true },
);
const backButton = ref(), selectionButton = ref();
function focusList(id) {
  const scroller=scroll.value;
  const wanted=scroller?.querySelector('[data-scheduled-id="'+id+'"] .conversation-open');
  (wanted || scroller?.querySelector('.conversation-open') || selectionButton.value)?.focus();
}
watch(messageId, (id, old) => {
  if (id) nextTick(() => backButton.value?.focus());
  if (!id && old) {
    offset.value=Math.min(offset.value, Math.floor(Math.max(0,ordered.value.length-1)/50)*50);
    nextTick(()=>focusList(old));
  }
});
function keydown(event) {
  if (
    event.key === "Escape" &&
    !event.defaultPrevented &&
    !event.target.closest(
      "input,textarea,[contenteditable],dialog,.el-popper,.send",
    ) &&
    item.value &&
    ![
      ...document.querySelectorAll(".el-popper,.el-dialog,.send,dialog[open]"),
    ].some((el) => el.getClientRects().length)
  )
    back();
}
const timer = setInterval(() => {
  if (!document.hidden && !busy.value) load();
}, 30000);
onMounted(() => window.addEventListener("keydown", keydown));
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  detailRequest++;
  clearInterval(timer);
  window.removeEventListener("keydown", keydown);
});
</script>
<style scoped>
.scheduled-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--el-text-color-primary);
}
.scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
}
.scheduled-pager {margin-inline-start:auto;display:flex;align-items:center;gap:4px;}
@media(max-width:420px) {
  .selected-toolbar {height:auto;min-height:48px;flex-wrap:wrap;padding-block:4px;row-gap:0;}
  .selected-toolbar .scheduled-pager {margin-inline-start:auto;}
}
.select-options {
  width: 18px;
  height: 28px;
  border-radius: 4px;
  margin-left: -8px;
  margin-right: 8px;
}
.notice,
.empty,
.list-status {
  text-align: center;
  padding: 14px 16px;
  margin: 0;
  font:
    14px/20px Arial,
    sans-serif;
  color: var(--regular-text-color);
}
.notice {
  display:flex;
  align-items:center;
  gap:10px;
  min-height:48px;
  box-sizing:border-box;
  padding:6px 16px;
  text-align:start;
  background:var(--mail-folder-notice);
  color:var(--secondary-text-color);
  border-radius:4px;
}
.notice svg {flex:none;}
.awaiting-delivery :deep(.row-date time) {
  color:var(--scheduled-date);
  font-size:14px;
  font-weight:700;
}
.awaiting-delivery.selected :deep(.row-date time) {
  color:var(--scheduled-date-selected,var(--scheduled-date));
}
.cancel-action {
  padding: 8px 12px;
  border-radius: 20px;
  color: var(--regular-text-color);
  font-size: 14px;
  cursor: pointer;
}
.cancel-action:hover {
  background: var(--mail-hover);
}
.cancel-action:disabled {
  opacity: 0.5;
  cursor: default;
}
.list-status button {
  color: var(--el-color-primary);
  cursor: pointer;
}
</style>
