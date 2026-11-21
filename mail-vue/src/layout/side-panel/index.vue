<template>
  <Contacts
    v-if="open"
    :id="panelId"
    :key="accountId"
    :account-id="accountId"
    @close="close"
  />
  <aside
    v-if="!ui.sideRailHidden"
    class="side-rail"
    aria-label="Side panel"
    data-tip-placement="left"
  >
    <div
      ref="toolbar"
      role="toolbar"
      aria-label="Side panel tools"
      aria-orientation="vertical"
      @keydown="navigate"
    >
      <a
        v-for="(tool, index) in links"
        :key="tool.name"
        class="rail-tool"
        :href="tool.href"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="tool.name + ' (opens in a new tab)'"
        :data-tip="tool.name"
        :tabindex="active === index ? 0 : -1"
        @focus="active = index"
      >
        <span><img :src="tool.icon" alt="" width="20" height="20" /></span>
      </a>
      <button
        ref="contactsButton"
        type="button"
        class="rail-tool"
        :class="{ selected: open }"
        aria-label="Contacts"
        data-tip="Contacts"
        :aria-expanded="open"
        :aria-controls="open ? panelId : undefined"
        :tabindex="active === 3 ? 0 : -1"
        @focus="active = 3"
        @click="toggleContacts"
      >
        <span
          ><Icon
            icon="material-symbols:account-circle-outline"
            class="contact-symbol"
            width="22"
        /></span>
      </button>
      <hr />
      <RouterLink
        class="rail-tool"
        :to="{ name: 'account-settings', hash: '#connected-apps' }"
        data-tip="Connected apps"
        aria-label="Connected apps"
        :tabindex="active === 4 ? 0 : -1"
        @focus="active = 4"
        @click="openConnections"
        ><span><Icon icon="material-symbols:add" width="22" /></span
      ></RouterLink>
    </div>
  </aside>
  <button
    v-if="!open"
    class="rail-toggle"
    :class="{ hiddenRail: ui.sideRailHidden }"
    type="button"
    data-tip-placement="left"
    :aria-label="toggleLabel"
    :data-tip="toggleLabel"
    @click="ui.sideRailHidden = !ui.sideRailHidden"
  >
    <span
      ><Icon
        :icon="
          ui.sideRailHidden
            ? 'material-symbols:chevron-left'
            : 'material-symbols:chevron-right'
        "
        width="20"
    /></span>
  </button>
</template>
<script setup>
import { computed, nextTick, ref, useId } from "vue";
import { Icon } from "@iconify/vue";
import { useRoute } from "vue-router";
import { useUserStore } from "@/store/user";
import { useUiStore } from "@/store/ui";
import Contacts from "./contacts.vue";
defineProps({ accountId: { type: Number, required: true } });
const open = defineModel({ type: Boolean, required: true });
const route = useRoute(),
  user = useUserStore();
const ui = useUiStore(),
  active = ref(0),
  toolbar = ref(),
  contactsButton = ref(),
  panelId = useId();
const links = [
  {
    name: "Calendar",
    href: "https://calendar.google.com/",
    icon: "/side-panel/calendar.png",
  },
  {
    name: "Keep",
    href: "https://keep.google.com/",
    icon: "/side-panel/keep.png",
  },
  {
    name: "Tasks",
    href: "https://tasks.google.com/",
    icon: "/side-panel/tasks.png",
  },
];
const toggleLabel = computed(() =>
  ui.sideRailHidden ? "Show side panel" : "Hide side panel",
);
function openConnections(event) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  open.value = false;
  ui.quickSettings = false;
  if (route.name === "account-settings" && route.hash === "#connected-apps") {
    const section = document.getElementById("connected-apps");
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: "start" });
  }
}
function toggleContacts() {
  if (
    !user.authenticatedToken ||
    user.authenticatedToken !== localStorage.getItem("token")
  ) {
    open.value = false;
    return;
  }
  ui.quickSettings = false;
  open.value = !open.value;
}
function close() {
  open.value = false;
  nextTick(() => contactsButton.value?.focus());
}
function navigate(event) {
  const items = [...toolbar.value.querySelectorAll("a,button")],
    index = items.indexOf(event.target);
  if (index < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
  const next = {
    ArrowDown: (index + 1) % items.length,
    ArrowUp: (index + items.length - 1) % items.length,
    Home: 0,
    End: items.length - 1,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  items[next].focus();
}
</script>
<style scoped>
.side-rail {
  position: fixed;
  right: 0;
  top: 64px;
  bottom: 56px;
  width: 56px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}
.rail-tool,
.rail-toggle {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  color: var(--regular-text-color);
  cursor: pointer;
}
.rail-tool span,
.rail-toggle span {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.rail-tool:is(:hover, :focus-visible) span,
.rail-toggle:is(:hover, :focus-visible) span {
  background: var(--mail-hover);
}
.rail-tool.selected span {
  background: var(--mail-selected);
}
.contact-symbol {
  color: #1967d2;
}
html.dark .contact-symbol {
  color: #a8c7fa;
}
.side-rail hr {
  width: 20px;
  margin: 16px auto;
  border: 0;
  border-top: 1px solid var(--secondary-text-color);
  opacity: 0.5;
}
.rail-toggle {
  position: fixed;
  bottom: 0;
  right: 0;
  z-index: 15;
}
.rail-toggle.hiddenRail {
  justify-items: end;
}
.hiddenRail span {
  width: 48px;
  border-radius: 24px 0 0 24px;
  background: var(--mail-surface);
  box-shadow: 0 1px 4px #0003;
}
.photo-theme :is(.rail-tool, .rail-toggle):not(.hiddenRail) {
  color: white;
  --mail-hover: #ffffff29;
}
</style>
