<template>
  <div
    class="color-grid"
    role="group"
    :aria-label="title"
    :style="{ '--columns': columns }"
  >
    <button
      v-for="(color, index) in colors"
      :key="index"
      type="button"
      :aria-label="title + ' ' + color"
      :aria-pressed="color === selected"
      :tabindex="index === cursor ? 0 : -1"
      :disabled="disabled"
      :style="{
        backgroundColor: color,
        color: samples ? presetText(index) : undefined,
      }"
      @focus="cursor = index"
      @keydown="navigate($event, index)"
      @click="$emit('choose', color, index)"
    >
      <span aria-hidden="true">{{ samples ? "a" : "" }}</span>
    </button>
  </div>
</template>
<script setup>
import { ref, watch } from "vue";
import { presetText } from "./colors";
const props = defineProps({
  title: String,
  colors: Array,
  columns: Number,
  selected: String,
  samples: Boolean,
  disabled: Boolean,
});
defineEmits(["choose"]);
const cursor = ref(0);
watch(
  () => props.selected,
  (value) => {
    cursor.value = Math.max(0, props.colors.indexOf(value));
  },
  { immediate: true },
);
function navigate(event, index) {
  const last = props.colors.length - 1;
  const target = {
    ArrowLeft: index - 1,
    ArrowRight: index + 1,
    ArrowUp: index - props.columns,
    ArrowDown: index + props.columns,
    Home: 0,
    End: last,
  }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.parentElement.children[
    Math.min(last, Math.max(0, target))
  ].focus();
}
</script>
<style scoped>
.color-grid {
  display: grid;
  grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
  gap: 2px;
}
.color-grid button {
  aspect-ratio: 1;
  min-width: 0;
  padding: 0;
  line-height: 1;
  border: 1px solid #0002;
  border-radius: 2px;
  cursor: pointer;
  font:
    600 13px Arial,
    sans-serif;
}
.color-grid button:is(:hover, :focus-visible, [aria-pressed="true"]) {
  outline: 2px solid var(--el-text-color-primary);
  outline-offset: 0;
  z-index: 1;
}
</style>
