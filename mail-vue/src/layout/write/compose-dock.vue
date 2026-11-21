<template>
  <div
    v-for="item in windows"
    :key="item.key"
    class="writer-slot"
    v-show="!item.open || layout.positions.has(item.key)"
    :style="position(item)"
    @pointerdown.capture="activate(item)"
    @focusin="activate(item)"
  >
    <MessageComposer
      :ref="(node) => remember(item.key, node)"
      :separate-window="separateWindow"
      :dock-active="item.key === active"
      :dock-hidden="item.open && !layout.positions.has(item.key)"
      @editor-focus="activate(item)"
      @dock-state="update(item, $event)"
      @closed="remove(item)"
      @sent="remove(item)"
    />
  </div>
  <div
    v-if="hidden.length && !layout.exclusive"
    class="dock-switcher"
    :style="{ right: layout.right + 'px' }"
  >
    <el-dropdown
      :key="menuVersion"
      trigger="click"
      placement="top-start"
      popper-class="mail-action-menu compose-window-menu"
      :show-arrow="false"
      @command="selectHidden"
    >
      <button
        class="more-drafts"
        aria-label="More compose windows"
        data-tip="More compose windows"
      >
        <Icon icon="material-symbols:more-horiz" width="20" /><span>{{
          hidden.length
        }}</span>
      </button>
      <template #dropdown
        ><el-dropdown-menu>
          <el-dropdown-item
            v-for="item in hidden"
            :key="item.key"
            :command="item.key"
            >{{ item.caption || "New Message" }}</el-dropdown-item
          >
        </el-dropdown-menu></template
      >
    </el-dropdown>
  </div>
</template>
<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { Icon } from "@iconify/vue";
import MessageComposer from "@/components/message-composer/index.vue";
import {useRouter} from "vue-router";
import {useAccountStore} from "@/store/account";
import {hasPerm} from "@/perm/perm";
import {userDraftStore} from "@/store/draft";
import {refreshLocalDraft, readSavedDraft} from "@/services/draft-list";
import {checkWindowSession, notifyWindowDraft, separateEditors, focusSeparateDraft, openSeparateWindow, receiveComposeWindows, saveWindowState, windowState} from "./separate-window";
import { ElMessage } from "element-plus";
import { draftSession, discardDrafts } from "@/services/cloud-drafts";
import { useMailFeedback } from "@/store/mail-feedback";
import { useUserStore } from "@/store/user";
import { dockLayout } from "./dock";
const props = defineProps({ separateWindow:String, sideInset: { type:Number, default:0 } });
const router = useRouter(), accounts = useAccountStore();
const feedback = useMailFeedback(),
  user = useUserStore();
const editors = new Map();
const separateIdle = ref(false);
const menuVersion = ref(0);
const mailboxTitle = document.title;
let serial = 0,
  usage = 0;
function empty() {
  return {
    key: ++serial,
    used: 0,
    open: false,
    minimized: false,
    expanded: false,
    caption: "",
    draftId: null,
  };
}
const windows = ref([empty()]),
  active = ref(windows.value[0].key),
  viewport = ref(window.innerWidth);
const occupied = computed(() => windows.value.filter((item) => item.open));
const layout = computed(() =>
  dockLayout(occupied.value, viewport.value, active.value, props.sideInset),
);
const modalOpen = computed(
  () =>
    viewport.value >= 768 &&
    occupied.value.some(
      (item) => item.key === active.value && item.expanded && !item.minimized,
    ),
);
const hidden = computed(() =>
  occupied.value.filter((item) => !layout.value.positions.has(item.key)),
);
function remember(key, node) {
  if (node) editors.set(key, node);
  else editors.delete(key);
}
function position(item) {
  const rect = layout.value.positions.get(item.key);
  return rect
    ? { "--dock-right": rect.right + "px", "--dock-width": rect.width + "px" }
    : {};
}
function update(item, state) {
  const previousId = item.draftId;
  Object.assign(item, state);
  if (props.separateWindow && (state.draftId || previousId)) {
    const saved = windowState(props.separateWindow);
    if (saved.owner === user.user.email && saved.draftId !== state.draftId) {
      notifyWindowDraft(props.separateWindow);
      saveWindowState(props.separateWindow, {...saved, person:null, draftId:state.draftId || null});
      notifyWindowDraft(props.separateWindow);
    }
  }
  if (props.separateWindow && state.caption) document.title = state.caption + " - phooey! mail";
}
function activate(item) {
  if (!item.open || active.value === item.key) return;
  active.value = item.key;
  item.used = ++usage;
}
function remove(item) {
  if (props.separateWindow) {
    notifyWindowDraft(props.separateWindow);
    // Keep action feedback and Undo available in this window after sending,
    // scheduling or discarding. A plain save-and-close closes the window.
    if (feedback.notice) {
      document.title = mailboxTitle;
      separateIdle.value = true;
      const state = windowState(props.separateWindow);
      saveWindowState(props.separateWindow,{...state,person:null,draftId:null,idle:true});
    }
    else window.close();
  }
  const owned = editors.get(item.key)?.ownsFocus();
  windows.value = windows.value.filter((row) => row.key !== item.key);
  if (!windows.value.length) windows.value.push(empty());
  if (active.value === item.key)
    active.value = windows.value.reduce((a, b) =>
      a.used > b.used ? a : b,
    ).key;
  if (owned)
    nextTick(() => {
      if (document.activeElement !== document.body) return;
      const next = windows.value.find((row) => row.key === active.value);
      if (next?.open) editors.get(next.key)?.resumeFocus();
      else if (item.origin?.isConnected)
        item.origin.focus({ preventScroll: true });
    });
}
function selectHidden(key) {
  // Replacing this trigger prevents the closing menu's focus trap from taking
  // keyboard focus back after the chosen editor restores its selection.
  menuVersion.value++;
  return switchTo(key);
}
async function switchTo(key) {
  const item = windows.value.find((row) => row.key === key);
  if (!item) return;
  activate(item);
  await nextTick();
  editors.get(key)?.focusWindow();
}
async function focusDraft(id) {
  if (!id) return false;
  if (focusSeparateDraft(id)) return true;
  const existing = occupied.value.find(
    (item) => item.draftId === id || item.requestedId === id,
  );
  if (!existing) return false;
  await switchTo(existing.key);
  return true;
}
async function launch(method, arg, extra) {
  const owner = user.user.email,
    token = user.authenticatedToken;
  if (method === "openDraft") {
    if (focusSeparateDraft(arg.draftId)) return;
    if (arg.ownerEmail && arg.ownerEmail !== owner)
      throw new Error("This draft belongs to a different account.");
    // Reserve the first request synchronously. Concurrent requests for the same
    // draft should see that reservation before either editor finishes mounting.
    const existing = occupied.value.find(
      (item) =>
        arg.draftId &&
        (item.draftId === arg.draftId || item.requestedId === arg.draftId),
    );
    if (existing) {
      if (extra?.handoff) throw new Error("This draft is already open in the compose dock.");
      await switchTo(existing.key);
      return;
    }
  }
  if (props.separateWindow && separateIdle.value) {
    const state = windowState(props.separateWindow);
    saveWindowState(props.separateWindow,{...state,idle:false,draftId:arg?.draftId || null});
    notifyWindowDraft(props.separateWindow);
    separateIdle.value = false;
  }
  let item = windows.value.find((row) => !row.open);
  if (!item) {
    windows.value.push(empty());
    item = windows.value.at(-1);
  }
  item.origin = document.activeElement;
  item.open = true;
  item.used = ++usage;
  active.value = item.key;
  item.requestedId = method === "openDraft" ? arg.draftId : null;
  await nextTick();
  const editor = editors.get(item.key);
  if (!editor) return;
  try {
    if (
      owner !== user.user.email ||
      token !== user.authenticatedToken ||
      token !== localStorage.getItem("token")
    )
      return;
    await editor[method](arg, extra);
    return Boolean(editor.visible);
  } finally {
    item.requestedId = null;
    if (!editor.visible && windows.value.includes(item)) remove(item);
  }
}
async function openRowResponses(rows, command) {
  const owner=user.user.email, token=user.authenticatedToken, mailbox=accounts.currentAccountId, allReceive=accounts.currentAccount.allReceive;
  let path=router.currentRoute.value.fullPath;
  const current=()=>owner===user.user.email && token && token===user.authenticatedToken && token===localStorage.getItem("token") &&
    mailbox===accounts.currentAccountId && allReceive===accounts.currentAccount.allReceive && path===router.currentRoute.value.fullPath && hasPerm("email:send");
  if (!current()) return;
  if (rows.length>1 && props.separateWindow && separateIdle.value) {
    // An idle detached composer has one persisted draft slot. Resume the ordinary
    // mailbox dock before opening several independent responses there.
    const {composeWindow,...query}=router.currentRoute.value.query;
    const location={path:router.currentRoute.value.path,query};
    path=router.resolve(location).fullPath;
    await router.replace(location);
    if (!current()) return;
    connectWindows();
    separateIdle.value=false;
  }
  for (const message of rows) {
    if (!current() || !await launch("openRowResponse", message, {command,current})) break;
  }
}
async function discardEditor(ids, session) {
  const matches = occupied.value.filter(
    (item) => ids.includes(item.draftId) || ids.includes(item.requestedId),
  );
  const targets = [...matches.map(item => editors.get(item.key)), ...separateEditors(ids)];
  if (!targets.length) return false;
  const locked = [];
  try {
    for (const editor of targets) {
      if (!editor) throw new Error("Wait until the draft is open before discarding.");
      const expected = await editor.prepareDiscard(session);
      locked.push({ editor, expected });
    }
    const recovery = await discardDrafts(
      ids,
      locked.map((item) => item.expected),
      session,
    );
    feedback.dismissedDrafts(recovery);
    for (const { editor } of locked) editor.finishDiscard();
    return true;
  } finally {
    for (const { editor } of locked) editor.unlockDiscard();
  }
}
async function followDelivery(...args) {
  await nextTick();
  return editors.get(windows.value[0]?.key)?.followDelivery(...args);
}
function resize() {
  viewport.value = window.innerWidth;
}
async function restoreWindow(state, check) {
  check();
  if (state.owner !== user.user.email || !hasPerm("email:send"))
    throw new Error("This window belongs to another mailbox.");
  const draft = state.draftId ? await readSavedDraft(state.draftId) : null;
  check();
  await launch("restoreWindow", state, draft);
  check();
}
async function openFromButton(event) {
  if (!event.shiftKey) return launch("open");
  try {
    const session = draftSession(), account = accounts.currentAccount?.email ? accounts.currentAccount : user.user.account;
    await openSeparateWindow(() => ({owner:session.owner,sender:{accountId:account.accountId,email:account.email,name:account.name || user.user.name}}),session);
  } catch (error) { ElMessage.error(error.message); }
}
const draftStore = userDraftStore();
watch(() => [draftStore.items,draftStore.refreshList], () => notifyWindowDraft(props.separateWindow), {flush:"post"});
let stopReceiving;
function connectWindows() {
  stopReceiving?.();
  const id = props.separateWindow;
  const endpoint = receiveComposeWindows({restore:restoreWindow, getSession:draftSession, draftChanged:refreshLocalDraft, id,
    discardEditor(draftId) {
      const item = occupied.value.find(row => row.draftId === draftId);
      const editor = item && editors.get(item.key);
      if (!editor || !id || !editor.visible) return;
      const session = draftSession();
      return {prepareDiscard:() => editor.prepareDiscard(session), unlockDiscard:() => editor.unlockDiscard(),
        finishDiscard:() => { session.check(); editor.finishDiscard(); }};
    },
  });
  stopReceiving = endpoint.stop;
  return endpoint;
}
onMounted(async () => {
  window.addEventListener("resize", resize);
  const endpoint=connectWindows(), id=props.separateWindow;
  if (!id) return;
  try {
    const state = windowState(id), session = draftSession();
    await checkWindowSession(state,session);
    separateIdle.value = Boolean(state.idle);
    if (!separateIdle.value) await restoreWindow(state,session.check);
    await endpoint.opened();
  } catch (error) {
    endpoint.failed();
    ElMessage.error(error.message);
    router.replace("/inbox");
  }
});
onBeforeUnmount(() => stopReceiving?.());
onBeforeUnmount(() => window.removeEventListener("resize", resize));
defineExpose({
  openRowResponses,
  openFromButton,
  open: (person) => launch("open", person),
  openReply: (email) => launch("openReply", email),
  openReplyAll: (email) => launch("openReplyAll", email),
  openAttachedMessages: (request) => launch("openAttachedMessages", request),
  openForward: (email) => launch("openForward", email),
  openDraft: (draft, options) => launch("openDraft", draft, options),
  focusDraft,
  followDelivery,
  discardEditor,
  modalOpen, separateIdle,
});
</script>
<style scoped>
.writer-slot {
  display: contents;
}
.dock-switcher {
  position: fixed;
  bottom: 0;
  z-index: 200;
}
@media (min-width:768px) { .dock-switcher { bottom:16px; } }
.more-drafts {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 40px;
  height: 40px;
  padding: 0 4px;
  background: var(--mail-compose-header);
  color: var(--el-text-color-primary);
  border-radius: 8px 8px 0 0;
  box-shadow: 0 2px 8px #0003;
  cursor: pointer;
}
:global(.compose-window-menu) {
  max-width: min(360px, calc(100vw - 16px));
}
:global(.compose-window-menu .el-dropdown-menu__item) {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 32px;
}
</style>
