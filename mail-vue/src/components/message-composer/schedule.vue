<template>
  <el-dialog
    v-model="visible"
    append-to-body
    align-center
    destroy-on-close
    :width="custom ? '492px' : '336px'"
    class="mail-dialog schedule-dialog"
    :title="custom ? 'Pick date & time' : 'Schedule send'"
    @opened="focusInitial"
    @closed="restoreFocus"
  >
    <MailDateTime
      v-if="custom"
      ref="picker"
      :initial="initial"
      action="Schedule send"
      @choose="choose"
      @cancel="visible = false"
    />
    <template v-else>
      <p class="zone" :title="zoneId">{{ zone }}</p>
      <button
        v-for="(option, index) in options"
        :key="option.label"
        :ref="
          (node) => {
            if (index === 0) firstOption = node;
          }
        "
        type="button"
        class="option"
        @click="choose(option.when)"
      >
        <span>{{ option.label }}</span
        ><time>{{ display(option.when) }}</time>
      </button>
      <button type="button" class="option custom" @click="showCalendar">
        <Icon icon="material-symbols:calendar-month-outline" width="20" />Pick
        date &amp; time
      </button>
      <p v-if="error" role="alert">{{ error }}</p>
    </template>
  </el-dialog>
</template>
<script setup>
import { computed, nextTick, ref } from "vue";
import { Icon } from "@iconify/vue";
import MailDateTime from "@/components/mail-date-time/index.vue";
import { suggestions } from "@/components/mail-date-time/dates";
const visible = defineModel({ type: Boolean }),
  emit = defineEmits(["schedule"]);
const custom = ref(false),
  options = ref([]),
  initial = ref(),
  picker = ref(),
  firstOption = ref(),
  error = ref("");
const zoneId = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zone = computed(() => {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZoneName: "long" });
  const names = new Set(
    options.value.map(
      ({ when }) =>
        formatter
          .formatToParts(when)
          .find((part) => part.type === "timeZoneName")?.value,
    ),
  );
  return names.size === 1 ? [...names][0] || zoneId : zoneId;
});
let opener;
function display(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function open(trigger) {
  opener = trigger;
  const now = new Date();
  options.value = suggestions(now);
  initial.value = options.value[0].when;
  custom.value = false;
  error.value = "";
  visible.value = true;
}
function focusInitial() {
  if (
    !custom.value &&
    (firstOption.value?.closest(".el-dialog") === document.activeElement || opener===document.activeElement || document.activeElement?.closest(".compose-format-popup"))
  )
    firstOption.value.focus();
}
function showCalendar() {
  custom.value = true;
  error.value = "";
  nextTick(() => picker.value?.focus());
}
async function restoreFocus() {
  // Element Plus releases its focus trap and commits v-model after its closed event.
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
    options.value = suggestions(new Date());
    initial.value = options.value[0].when;
    error.value = "That time has passed. Choose another time.";
    return;
  }
  visible.value = false;
  emit("schedule", Math.floor(date.getTime() / 1000));
}
defineExpose({ open });
</script>
<style scoped>
.zone {
  margin: -4px 0 14px;
  color: var(--regular-text-color);
  font:
    13px/20px Arial,
    sans-serif;
}
.option {
  width: calc(100% + 48px);
  margin: 0 -24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  padding: 0 24px;
  gap: 10px;
  min-height: 44px;
  font-size: 14px;
  color: inherit;
  cursor: pointer;
}
.option:hover,
.option:focus-visible {
  background: var(--mail-hover);
}
.option:focus-visible {
  outline-offset: -2px;
}
time {
  color: var(--regular-text-color);
  font-size: 13px;
  white-space: nowrap;
}
.custom {
  margin-top: 8px;
  margin-bottom: -12px;
  border-top: 1px solid var(--light-border-color);
  justify-content: flex-start;
  min-height: 48px;
}
[role="alert"] {
  margin: 16px 0 0;
  color: var(--mail-draft);
  font-size: 13px;
}
</style>
