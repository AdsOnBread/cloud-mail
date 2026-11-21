<template>
  <el-dialog
    v-model="visible"
    append-to-body
    align-center
    destroy-on-close
    :width="custom ? '512px' : '353px'"
    class="mail-dialog schedule-dialog"
    :class="custom ? 'schedule-calendar' : 'schedule-presets'"
    :show-close="!custom"
    :title="custom ? 'Pick date & time' : 'Schedule send'"
    @opened="focusInitial"
    @closed="restoreFocus"
  >
    <MailDateTime
      v-if="custom"
      ref="picker"
      :initial="initial"
      action="Schedule send"
      scheduling
      @choose="choose"
      @cancel="visible = false"
    />
    <template v-else>
      <p class="zone" :title="zoneId">{{ zone }}</p>
      <div
        ref="menu"
        role="menu"
        aria-label="Schedule send"
        @keydown="navigate"
      >
        <button
          v-for="(option, index) in options"
          :key="option.label"
          type="button"
          role="menuitem"
          :tabindex="active === index ? 0 : -1"
          class="option"
          @focus="active = index"
          @click="choose(option.when)"
        >
          <span>{{ option.label }}</span
          ><time>{{ display(option.when) }}</time>
        </button>
        <button
          type="button"
          role="menuitem"
          class="option custom"
          :tabindex="active === options.length ? 0 : -1"
          @focus="active = options.length"
          @click="showCalendar"
        >
          <Icon icon="material-symbols:calendar-month-outline" width="20" />Pick
          date &amp; time
        </button>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
    </template>
  </el-dialog>
</template>
<script setup>
import { nextTick, ref } from "vue";
import { Icon } from "@iconify/vue";
import MailDateTime from "@/components/mail-date-time/index.vue";
import { suggestions } from "@/components/mail-date-time/dates";
import { useUserStore } from "@/store/user";

const visible = defineModel({ type: Boolean }),
  emit = defineEmits(["schedule"]);
const custom = ref(false),
  options = ref([]),
  initial = ref(),
  picker = ref(),
  menu = ref(),
  active = ref(0),
  error = ref("");
const user = useUserStore(),
  zoneId = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zone = ref("");
let opener;
function setOptions(now) {
  const previous = new Date((user.user.lastSchedule?.sendAt || 0) * 1000);
  options.value = suggestions(now);
  if (previous > now)
    options.value.unshift({ label: "Last scheduled time", when: previous });
  const names = new Set(
    options.value.map(
      ({ when }) =>
        new Intl.DateTimeFormat("en-US", { timeZoneName: "long" })
          .formatToParts(when)
          .find((part) => part.type === "timeZoneName")?.value,
    ),
  );
  zone.value = names.size === 1 ? [...names][0] || zoneId : zoneId;
}
function display(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function open(trigger) {
  opener = trigger;
  setOptions(new Date());
  active.value = 0;
  custom.value = false;
  error.value = "";
  visible.value = true;
}
function focusInitial() {
  if (!visible.value || custom.value || !menu.value) return;
  const focused = document.activeElement,
    dialog = menu.value.closest(".el-dialog");
  if (
    focused === dialog ||
    focused === opener ||
    focused === document.body ||
    focused?.closest(".compose-format-popup")
  )
    menu.value.children[active.value]?.focus();
}
function navigate(event) {
  const last = options.value.length;
  const next = {
    ArrowDown: (active.value + 1) % (last + 1),
    ArrowUp: (active.value + last) % (last + 1),
    Home: 0,
    End: last,
  }[event.key];
  if (next === undefined || event.altKey || event.ctrlKey || event.metaKey)
    return;
  event.preventDefault();
  menu.value?.children[next]?.focus();
}
function showCalendar() {
  initial.value = new Date(Date.now() + 3600000);
  custom.value = true;
  error.value = "";
  nextTick(() => picker.value?.focus());
}
async function restoreFocus() {
  await new Promise(requestAnimationFrame);
  if (
    !visible.value &&
    opener?.isConnected &&
    opener.getClientRects().length &&
    (document.activeElement === document.body ||
      document.activeElement?.closest(".compose-format-popup,.schedule-dialog"))
  )
    opener.focus();
}
function choose(date) {
  if (date <= new Date()) {
    setOptions(new Date());
    active.value = 0;
    error.value = "That time has passed. Choose another time.";
    nextTick(() => menu.value?.firstElementChild?.focus());
    return;
  }
  visible.value = false;
  emit("schedule", Math.floor(date.getTime() / 1000));
}
defineExpose({ open });
</script>
<style>
.schedule-dialog.el-dialog {
  padding: 0;
  max-width: calc(100vw - 24px);
  border-radius: 28px;
  box-shadow: none;
}
.schedule-dialog .el-dialog__header {
  padding: 24px 24px 16px;
}
.mail-dialog.schedule-dialog .el-dialog__title {
  font-size: 24px;
  line-height: 32px;
  font-weight: 400;
}
.schedule-presets .el-dialog__header {
  padding: 20px 60px 0 24px;
}
.schedule-presets .el-dialog__headerbtn {
  top: 9px;
  right: 12px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.schedule-presets .el-dialog__headerbtn:hover {
  background: var(--mail-hover);
}
.schedule-presets .zone {
  margin: 0;
  padding: 0 24px 20px;
  font:
    14px/20px Arial,
    sans-serif;
  color: var(--regular-text-color);
}
.schedule-presets .option {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  gap: 12px;
  min-height: 36px;
  text-align: left;
  font:
    14px/20px Arial,
    sans-serif;
  color: inherit;
  cursor: pointer;
}
.schedule-presets .option:is(:hover, :focus-visible) {
  background: var(--mail-hover);
}
.schedule-presets .option:focus-visible {
  outline-offset: -2px;
}
.schedule-presets time {
  color: var(--regular-text-color);
  white-space: nowrap;
}
.schedule-presets .custom {
  min-height: 53px;
  margin-top: 8px;
  border-top: 1px solid var(--light-border-color);
  justify-content: flex-start;
  border-radius: 0 0 28px 28px;
}
.schedule-presets [role="alert"] {
  margin: 0;
  padding: 8px 24px 16px;
  color: var(--mail-draft);
}
</style>
