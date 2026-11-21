<template>
  <el-dialog
    v-model="visible"
    append-to-body
    width="360px"
    class="mail-dialog schedule-dialog"
    :title="custom ? 'Pick date & time' : 'Schedule send'"
    :show-close="true"
  >
    <p class="zone">{{ zone }}</p>
    <template v-if="!custom"
      ><button
        v-for="option in options"
        :key="option.label"
        class="option"
        @click="choose(option.when)"
      >
        <span>{{ option.label }}</span
        ><time>{{ display(option.when) }}</time>
      </button>
      <button
        class="option custom"
        @click="
          custom = true;
          nextTick(() => field?.focus());
        "
      >
        <Icon icon="material-symbols:schedule-outline" width="18" />Pick date &
        time
      </button></template
    >
    <form v-else @submit.prevent="choose(new Date(value))">
      <label
        >Date and time<input
          ref="field"
          type="datetime-local"
          v-model="value"
          required
      /></label>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" @click="visible = false">Cancel</button
        ><button class="primary">Schedule send</button>
      </div>
    </form>
  </el-dialog>
</template>
<script setup>
import { ref, nextTick } from "vue";
import { Icon } from "@iconify/vue";
const visible = defineModel({ type: Boolean }),
  emit = defineEmits(["schedule"]);
const custom = ref(false),
  options = ref([]),
  value = ref(""),
  error = ref(""),
  field = ref();
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const display = (date) =>
  date.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
function open() {
  const now = new Date();
  const at = (days, hour) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const tomorrow = at(1, 8);
  options.value = [
    { label: "Tomorrow morning", when: tomorrow },
    { label: "Tomorrow afternoon", when: at(1, 13) },
    { label: "Monday morning", when: at((8 - now.getDay()) % 7 || 7, 8) },
  ].filter((o, i, a) => a.findIndex((x) => +x.when === +o.when) === i);
  const pad = (v) => String(v).padStart(2, "0");
  value.value =
    tomorrow.getFullYear() +
    "-" +
    pad(tomorrow.getMonth() + 1) +
    "-" +
    pad(tomorrow.getDate()) +
    "T08:00";
  custom.value = false;
  error.value = "";
  visible.value = true;
}
function choose(date) {
  if (!Number.isFinite(date.getTime()) || date <= new Date()) {
    error.value = "Choose a future date and time.";
    return;
  }
  visible.value = false;
  emit("schedule", Math.floor(date.getTime() / 1000));
}
defineExpose({ open });
</script>
<style scoped>
.zone {
  margin: 0 0 12px;
  color: var(--regular-text-color);
  font-size: 13px;
}
.option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  padding: 11px 6px;
  gap: 10px;
  font-size: 14px;
  color: inherit;
  cursor: pointer;
}
.option:hover {
  background: var(--mail-read);
}
time {
  color: var(--regular-text-color);
  font-size: 13px;
}
.custom {
  border-top: 1px solid var(--light-border-color);
  justify-content: flex-start;
}
label {
  display: grid;
  gap: 8px;
}
input {
  padding: 8px;
  border-radius: 5px;
  border: 1px solid var(--secondary-text-color);
  color: inherit;
  background: var(--mail-surface);
}
[role="alert"] {
  color: var(--mail-draft);
}
</style>
