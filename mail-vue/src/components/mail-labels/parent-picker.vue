<template>
  <div ref="root" class="parent-picker" @focusout="leave">
    <el-popover :visible="open" :trigger="[]" :teleported="false" :persistent="false"
      :width="width" :offset="0" :show-arrow="false" placement="bottom-start"
      @after-enter="focusOpenedList" popper-class="label-parent-options" :popper-style="{padding:0}">
      <template #reference>
        <span class="parent-anchor">
          <button ref="trigger" type="button" role="combobox" aria-label="Nest label under:" aria-haspopup="listbox"
          :aria-expanded="open" :aria-controls="open ? listId : undefined" :disabled="disabled"
          @click="open ? close() : show()" @keydown="keydown">
          <span>{{ labels.find(label => label.id === modelValue)?.name }}</span>
          <span class="parent-caret" aria-hidden="true"></span>
          </button>
        </span>
      </template>
      <ul v-if="open" ref="list" :id="listId" role="listbox" aria-label="Nest label under:" @keydown="keydown">
        <li role="option" aria-disabled="true" :aria-selected="modelValue == null" tabindex="-1">Please select a parent...</li>
        <li v-for="label in labels" :key="label.id" role="option" :aria-selected="modelValue === label.id"
          tabindex="-1" @click="choose(label)">{{ label.name }}</li>
      </ul>
    </el-popover>
  </div>
</template>
<script setup>
import { nextTick, ref, useId } from 'vue';
import { onClickOutside, useElementSize } from '@vueuse/core';

const props = defineProps({ labels: { type: Array, required: true }, modelValue: Number, disabled: Boolean });
const emit = defineEmits(['update:modelValue']);
const root = ref(), trigger = ref(), list = ref(), open = ref(false);
const { width } = useElementSize(root);
const listId = useId();
let prefix = '', lastTyped = 0, requestedRow = 0;

function close() { open.value = false; prefix = ''; }
function leave(event) {
  if (event.relatedTarget && !root.value.contains(event.relatedTarget)) close();
}
onClickOutside(root, close);
function focusRow(index) {
  requestedRow = index;
  list.value?.children[index]?.focus();
}
function focusOpenedList() {
  if (open.value && document.activeElement === trigger.value) focusRow(requestedRow);
}
async function show(index = props.labels.findIndex(label => label.id === props.modelValue) + 1) {
  requestedRow = index;
  trigger.value?.focus({ preventScroll: true });
  open.value = true;
  await nextTick();
  focusOpenedList();
}
function choose(label) {
  if (label) emit('update:modelValue', label.id);
  close();
  trigger.value?.focus();
}
function keydown(event) {
  const { key } = event;
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const rows = props.labels;
  const index = open.value && list.value
    ? (event.target === trigger.value ? requestedRow : Array.from(list.value.children).indexOf(event.target))
    : rows.findIndex(label => label.id === props.modelValue) + 1;
  if (key === 'Tab') {
    if (open.value) { close(); trigger.value?.focus(); }
    return;
  }
  if (key === 'Escape') {
    if (!open.value) return;
    event.stopPropagation();
    close();
    trigger.value?.focus();
  } else if (key === 'Enter' || key === ' ') {
    if (!open.value) show();
    else if (index > 0) choose(rows[index - 1]);
  } else if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
    if (!open.value) show();
    else if (rows.length) {
      let next = key === 'Home' || key === 'ArrowDown' ? 1 : rows.length;
      if (key === 'ArrowDown' && index < rows.length) next = index + 1;
      if (key === 'ArrowUp' && index > 1) next = index - 1;
      focusRow(next);
    }
  } else if (key.length === 1) {
    const now = performance.now(), letter = key.toLocaleLowerCase();
    prefix = now - lastTyped < 700 ? prefix + letter : letter;
    lastTyped = now;
    // Repeating an initial cycles through choices that begin with that letter.
    const repeat = Array.from(prefix).every(char => char === letter);
    const start = repeat ? Math.max(0, index) : Math.max(0, index - 1);
    for (let offset = 0; offset < rows.length; offset++) {
      const i = (start + offset) % rows.length;
      if (!rows[i].name.toLocaleLowerCase().startsWith(repeat ? letter : prefix)) continue;
      if (open.value) focusRow(i + 1);
      else emit('update:modelValue', rows[i].id);
      break;
    }
  } else return;
  event.preventDefault();
}
</script>
