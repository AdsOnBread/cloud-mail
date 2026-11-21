<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    placement="bottom-start"
    :width="236"
    :show-arrow="false"
    popper-class="label-picker"
    @after-enter="focusPicker"
  >
    <template #reference
      ><button
        ref="trigger"
        class="mail-icon"
        aria-label="Label as"
        data-tip="Labels"
        :disabled="disabled"
        :aria-expanded="open"
      >
        <Icon icon="material-symbols:label-outline" width="20" /></button
    ></template>
    <div ref="panel" @keydown.esc.stop.prevent="dismiss">
      <div class="picker-title">Label as</div>
      <div class="label-list">
        <label v-for="label in labels.items" :key="label.id">
          <input
            type="checkbox"
            :checked="state(label.id) === 1"
            :indeterminate="state(label.id) === 0"
            @change="changes[label.id] = $event.target.checked"
          />{{ label.name }}
        </label>
      </div>
      <button
        class="picker-option"
        @click="
          open = false;
          labels.edit = { anchors: [...anchors] };
        "
      >
        Create new
      </button>
      <button class="picker-option" @click="dismiss();router.push({name:'label-settings'})">Manage labels</button>
      <button
        class="picker-option apply"
        :disabled="!Object.keys(changes).length"
        @click="apply"
      >
        Apply
      </button>
    </div>
  </el-popover>
</template>
<script setup>
import { ref, watch } from "vue";
import {useRouter} from "vue-router";
import { Icon } from "@iconify/vue";
import { useMailLabels } from "@/store/mail-labels";
const props = defineProps({
  rows: { type: Array, required: true },
  disabled: Boolean,
});
const emit = defineEmits(["apply"]);
const router=useRouter();
const labels = useMailLabels(),
  open = ref(false),
  changes = ref({});
const panel = ref(),
  trigger = ref();
function focusPicker() {
  if (open.value) panel.value?.querySelector("input,button")?.focus();
}
function dismiss() {
  open.value = false;
  trigger.value?.focus();
}
let anchors = [];
watch(open, (value) => {
  if (value) {
    changes.value = {};
    anchors = props.rows.map((row) => row.lastEmailId);
  }
});
watch(
  () => props.rows.map((row) => row.lastEmailId).join(","),
  () => {
    open.value = false;
  },
);
function state(id) {
  if (Object.hasOwn(changes.value, id)) return changes.value[id] ? 1 : -1;
  const count = props.rows.filter((row) => row.labelIds?.includes(id)).length;
  return !count ? -1 : count === props.rows.length ? 1 : 0;
}
function apply() {
  const ops = { add: [], remove: [] };
  for (const [id, on] of Object.entries(changes.value))
    ops[on ? "add" : "remove"].push(Number(id));
  dismiss();
  emit("apply", ops, anchors);
}
</script>
<style scoped>
.picker-title {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
}
.label-list {
  max-height: 240px;
  overflow: auto;
}
label,
.picker-option {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 12px;
  padding: 7px 16px;
  font-size: 14px;
  cursor: pointer;
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
label:hover,
.picker-option:hover {
  background: var(--mail-read);
}
label input {
  accent-color: var(--el-color-primary);
}
.apply {
  border-top: 1px solid var(--light-border-color);
  color: var(--el-color-primary);
}
</style>
