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
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from "vue";
import { Icon } from "@iconify/vue";
import MessageComposer from "@/components/message-composer/index.vue";
import { discardDrafts } from "@/services/cloud-drafts";
import { useMailFeedback } from "@/store/mail-feedback";
import { useUserStore } from "@/store/user";
import { dockLayout } from "./dock";
const props = defineProps({ sideInset: { type:Number, default:0 } });
const feedback = useMailFeedback(),
  user = useUserStore();
const editors = new Map();
const menuVersion = ref(0);
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
  Object.assign(item, state);
}
function activate(item) {
  if (!item.open || active.value === item.key) return;
  active.value = item.key;
  item.used = ++usage;
}
function remove(item) {
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
  const existing = occupied.value.find(
    (item) => item.draftId === id || item.requestedId === id,
  );
  if (!existing) return false;
  await switchTo(existing.key);
  return true;
}
async function launch(method, arg) {
  const owner = user.user.email,
    token = user.authenticatedToken;
  if (method === "openDraft") {
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
      await switchTo(existing.key);
      return;
    }
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
    await editor[method](arg);
  } finally {
    item.requestedId = null;
    if (!editor.visible && windows.value.includes(item)) remove(item);
  }
}
async function discardEditor(ids, session) {
  const matches = occupied.value.filter(
    (item) => ids.includes(item.draftId) || ids.includes(item.requestedId),
  );
  if (!matches.length) return false;
  const locked = [];
  try {
    for (const item of matches) {
      const editor = editors.get(item.key);
      if (!editor)
        throw new Error("Wait until the draft is open before discarding.");
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
onMounted(() => window.addEventListener("resize", resize));
onBeforeUnmount(() => window.removeEventListener("resize", resize));
defineExpose({
  open: (person) => launch("open", person),
  openReply: (email) => launch("openReply", email),
  openReplyAll: (email) => launch("openReplyAll", email),
  openForward: (email) => launch("openForward", email),
  openDraft: (draft) => launch("openDraft", draft),
  focusDraft,
  followDelivery,
  discardEditor,
  modalOpen,
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
