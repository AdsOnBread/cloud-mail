<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    placement="bottom-start"
    :width="240"
    :show-arrow="false"
    popper-class="label-picker"
    @after-enter="input?.focus()"
  >
    <template #reference
      ><button
        ref="trigger"
        class="mail-icon"
        :aria-expanded="open"
        aria-label="Move to"
        data-tip="Move to"
        :disabled="disabled"
      >
        <Icon
          icon="material-symbols:drive-file-move-outline"
          width="20"
        /></button
    ></template>
    <div class="move-picker" @keydown.esc.stop.prevent="dismiss">
      <strong>Move to</strong
      ><input
        ref="input"
        v-model="query"
        type="search"
        aria-label="Find destination"
        placeholder="Find a label"
      />
      <button
        v-for="item in destinations"
        :key="item.id"
        @click="choose(item.id)"
      >
        <Icon
          :icon="
            item.id
              ? 'material-symbols:label-outline'
              : 'material-symbols:inbox-outline'
          "
          width="18"
        />{{ item.name }}
      </button>
      <span v-if="!destinations.length">No matching labels</span>
    </div>
  </el-popover>
</template>
<script setup>
import { ref, computed, watch } from "vue";
import { Icon } from "@iconify/vue";
import { useMailLabels } from "@/store/mail-labels";
const props = defineProps({
  ids: { type: Array, required: true },
  fromLabelId: Number,
  disabled: Boolean,
});
const emit = defineEmits(["move"]);
const labels = useMailLabels(),
  open = ref(false),
  query = ref(""),
  input = ref(),
  trigger = ref();
let anchors = [];
const destinations = computed(() =>
  [{ id: 0, name: "Inbox" }, ...labels.items].filter(
    (item) =>
      item.id !== props.fromLabelId &&
      item.name.toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
);
watch(
  () => props.ids.join(","),
  () => {
    open.value = false;
  },
);
watch(open, (value) => {
  if (value) {
    query.value = "";
    anchors = [...props.ids];
  }
});
function dismiss() {
  open.value = false;
  trigger.value?.focus();
}
function choose(id) {
  dismiss();
  emit("move", { labelId: id, fromLabelId: props.fromLabelId || 0 }, anchors);
}
</script>
<style scoped>
.move-picker {
  max-height: 320px;
  overflow: auto;
  padding: 6px 0;
}
.move-picker strong,
.move-picker span {
  display: block;
  padding: 6px 14px;
}
.move-picker input {
  margin: 6px 12px;
  width: calc(100% - 24px);
  padding: 6px;
  border: 1px solid var(--light-border-color);
  border-radius: 4px;
  color: inherit;
}
.move-picker button {
  width: 100%;
  display: flex;
  align-items: center;
  text-align: left;
  gap: 12px;
  padding: 7px 14px;
  color: inherit;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.move-picker button:hover,
.move-picker button:focus-visible {
  background: var(--mail-read);
}
</style>
