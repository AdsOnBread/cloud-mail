<template>
  <div class="recipient-field" :class="{ 'has-error': error }">
    <button type="button" class="field-label" :aria-label="`Choose ${label} contacts`"
      :data-tip="`${label} - Select contacts`" @click="$emit('contacts')">{{ label }}</button>
    <div ref="entry" class="recipient-entry" @click.self="input?.focus()">
      <template v-for="(address, index) in modelValue" :key="index">
        <span v-if="editing !== index" class="recipient-chip" :style="{order:index}"
          :class="{ invalid: !isEmail(address), chosen: menuIndex === index }">
          <button type="button" class="chip-address" :data-index="index" :title="address" :aria-label="address"
            aria-haspopup="menu" :aria-expanded="menuIndex === index" tabindex="-1"
            @click="openMenu(index)" @contextmenu.prevent="openMenu(index)"
            @keydown="chipKey($event,index)" @copy="clipboardEvent($event,index)" @cut="clipboardEvent($event,index)">
            <span class="avatar" aria-hidden="true">{{ display(address).charAt(0).toUpperCase() }}</span>
            <span class="chip-text">{{ display(address) }}</span>
          </button>
          <button type="button" class="remove" :aria-label="`Remove ${address} from ${label}`" tabindex="-1"
            @click="remove(index)"> <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12m0-12L6 18"/></svg></button>
        </span>
      </template>
      <input ref="input" :id="inputId" v-model="pending" :list="`${inputId}-suggestions`"
        :style="{order:editing ?? modelValue.length}" :aria-label="`${label} recipients`"
        :aria-invalid="!!error" :aria-describedby="error ? `${inputId}-error` : undefined"
        autocomplete="off" autocapitalize="off" spellcheck="false" @keydown="keydown" @blur="commit" @paste="paste" />
      <datalist :id="`${inputId}-suggestions`">
        <option v-for="address in suggestions" :key="address" :value="address" />
      </datalist>
    </div>
    <slot />
    <p v-if="error" :id="`${inputId}-error`" class="recipient-error" role="alert">{{ error }}</p>
    <Teleport to="body">
      <div v-if="menuIndex !== null" ref="menu" role="menu" :aria-label="`${label} recipient actions`"
        class="recipient-menu compose-format-popup" :style="menuStyle" @keydown="menuKey" @focusout="leaveMenu">
        <button type="button" role="menuitem" @click="clipboardAction(false)">Copy email address</button>
        <button type="button" role="menuitem" @click="clipboardAction(true)">Cut</button>
        <button type="button" role="menuitem" @click="edit(menuIndex)">Change email address <kbd>Shift+F</kbd></button>
      </div>
    </Teleport>
  </div>
</template>
<script setup>
import { computed, nextTick, ref, useId, watch } from 'vue';
import { splitRecipients } from '@/utils/recipients.js';
import { isEmail } from '@/utils/verify-utils.js';
import { positionMailboxPopup } from '../mail-popup-position.js';
const props = defineProps({ modelValue: { type: Array, default: () => [] }, label: String,
  names: Object, contacts: { type: Array, default: () => [] }, error: String });
const emit = defineEmits(['update:modelValue', 'contacts']);
const input = ref(), entry = ref(), menu = ref(), menuStyle = ref({});
const pending = ref(''), editing = ref(null), menuIndex = ref(null);
const inputId = `recipient-${useId()}`;
const display = address => props.names?.[address.toLowerCase()] || address;
const suggestions = computed(() => props.contacts.filter(address => pending.value &&
  address.toLowerCase().includes(pending.value.toLowerCase()) &&
  !props.modelValue.some(value => value.toLowerCase() === address.toLowerCase())).slice(0, 10));
function clear() {
  pending.value = '';
  editing.value = null;
  menuIndex.value = null;
}
function commit() {
  const entered = splitRecipients(pending.value);
  if (entered.length) {
    const updated = [...props.modelValue];
    updated.splice(editing.value ?? updated.length, editing.value === null ? 0 : 1, ...entered);
    emit('update:modelValue', updated);
  }
  pending.value = '';
  editing.value = null;
}
function chip(index) { return entry.value?.querySelector(`[data-index="${index}"]`); }
function focusAt(index) { (chip(index) || input.value)?.focus(); }
function remove(index) {
  clear();
  emit('update:modelValue', props.modelValue.filter((_, i) => i !== index));
  nextTick(() => focusAt(index));
}
async function edit(index) {
  if (index === null) return;
  menuIndex.value = null;
  editing.value = index;
  pending.value = props.modelValue[index];
  await nextTick();
  input.value?.focus();
  input.value?.select();
}
function keydown(event) {
  if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Escape' && editing.value !== null) {
    const index = editing.value;
    event.preventDefault(); event.stopPropagation(); clear();
    nextTick(() => focusAt(index)); return;
  }
  if (['Backspace','ArrowLeft'].includes(event.key) && !pending.value && editing.value === null && props.modelValue.length) {
    event.preventDefault(); focusAt(props.modelValue.length - 1); return;
  }
  if (event.key === 'Enter' || ([',',';','，'].includes(event.key) &&
      splitRecipients(pending.value.slice(0,input.value.selectionStart) + event.key + 'x').length > 1)) {
    event.preventDefault(); commit();
  }
  if (event.key === 'Tab') commit();
}
function chipKey(event,index) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  switch (event.key) {
    case 'Backspace': case 'Delete': remove(index); break;
    case 'ArrowLeft': focusAt(Math.max(0,index-1)); break;
    case 'ArrowRight': focusAt(index+1); break;
    case 'Escape': input.value?.focus(); break;
    case 'F': case 'f': if (!event.shiftKey) return; edit(index); break;
    case 'Enter': case ' ': case 'ArrowDown': openMenu(index); break;
    default: return;
  }
  event.preventDefault(); event.stopPropagation();
}
function paste(event) {
  const text = event.clipboardData.getData('text');
  if (!/[,，;\n\r<>]/.test(text)) return;
  event.preventDefault();
  const {selectionStart, selectionEnd} = input.value;
  pending.value = pending.value.slice(0,selectionStart) + text + pending.value.slice(selectionEnd);
  commit();
}
function clipboardEvent(event,index) {
  if (!event.clipboardData) return;
  event.clipboardData.setData('text/plain', props.modelValue[index]);
  event.preventDefault();
  if (event.type === 'cut') remove(index);
}
async function clipboardAction(cut) {
  const index = menuIndex.value, address = props.modelValue[index];
  try { await navigator.clipboard.writeText(address); }
  catch { if (menuIndex.value === index) await edit(index); return; }
  if (menuIndex.value !== index || props.modelValue[index] !== address) return;
  if (cut) remove(index);
  else closeMenu(true);
}
function reposition() {
  const anchor = chip(menuIndex.value);
  if (menu.value && anchor) menuStyle.value = positionMailboxPopup(menu.value,anchor,252);
}
async function openMenu(index) {
  menuIndex.value = index;
  await nextTick();
  reposition();
  menu.value?.querySelector('button')?.focus({preventScroll:true});
}
function closeMenu(restore) {
  const index = menuIndex.value;
  menuIndex.value = null;
  if (restore && index !== null) focusAt(index);
}
function leaveMenu(event) {
  if (!menu.value?.contains(event.relatedTarget)) closeMenu(false);
}
function menuKey(event) {
  const items = [...menu.value.querySelectorAll('button')];
  const index = items.indexOf(document.activeElement);
  if (event.key === 'Escape') closeMenu(true);
  else if (event.key === 'ArrowDown') items[(index + 1) % items.length].focus();
  else if (event.key === 'ArrowUp') items[(index + items.length - 1) % items.length].focus();
  else if (event.key.toLowerCase() === 'f' && event.shiftKey) edit(menuIndex.value);
  else return;
  event.stopPropagation(); event.preventDefault();
}
watch(menuIndex,(index,_,onCleanup) => {
  if (index === null) return;
  const outside = event => { if (!menu.value?.contains(event.target) && !chip(index)?.contains(event.target)) closeMenu(false); };
  document.addEventListener('pointerdown',outside,true);
  window.addEventListener('resize',reposition);
  window.addEventListener('scroll',reposition,true);
  onCleanup(() => {
    document.removeEventListener('pointerdown',outside,true);
    window.removeEventListener('resize',reposition);
    window.removeEventListener('scroll',reposition,true);
  });
});
defineExpose({ commit, focus: () => input.value?.focus(), clear });
</script>
<style scoped>
.recipient-field { display:flex; align-items:center; flex-wrap:wrap; gap:8px; min-height:36px; box-sizing:border-box; border-bottom:1px solid var(--compose-divider, var(--light-border-color)); padding:3px 0; }
.field-label { cursor:pointer; text-align:left; flex-shrink:0; color:var(--regular-text-color); font-size:14px; }
.recipient-entry { flex:1; min-width:100px; display:flex; align-items:center; flex-wrap:wrap; gap:4px; cursor:text; }
input { appearance:none; border:0; border-radius:0; outline:none; background:transparent; font:inherit; flex:1; width:100px; min-width:80px; padding:4px 0; color:inherit; }
.recipient-chip { display:inline-flex; align-items:center; border-radius:999px; padding:2px; box-shadow:inset 0 0 0 1px var(--compose-chip-border,#c4c7c5); color:var(--regular-text-color,#444746); max-width:100%; box-sizing:border-box; }
.chip-address,.remove { display:inline-flex; align-items:center; cursor:pointer; border:0; padding:0; background:transparent; color:inherit; outline:none; }
.chip-address { min-width:0; font:500 14px/20px Roboto,Arial,sans-serif; border-radius:999px; }
.chip-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0 8px; }
.avatar { display:grid; place-items:center; width:24px; height:24px; flex:none; border-radius:50%; background:#687783; color:white; font-size:13px; }
.remove { flex:none; justify-content:center; width:22px; height:24px; border-radius:50%; }
.remove svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; }
.recipient-chip:hover { background:var(--base-fill); }
.recipient-chip:focus-within,.recipient-chip.chosen { background:#c2e7ff; color:#001d35; box-shadow:none; }
.recipient-chip.invalid { box-shadow:inset 0 0 0 1px var(--el-color-danger); }
.field-label:hover { text-decoration:underline; }
.remove:hover { background:rgba(68,71,70,.12); }
.recipient-error { width:100%; font-size:12px; color:var(--el-color-danger); padding-left:40px; }
.recipient-menu { position:fixed; z-index:10000; box-sizing:border-box; padding:8px 0; overflow:auto; border-radius:8px; background:var(--el-bg-color,#fff); color:var(--regular-text-color); box-shadow:0 2px 8px #0003,0 1px 3px #0002; }
.recipient-menu button { display:flex; align-items:center; justify-content:space-between; width:100%; padding:0 16px; height:34px; cursor:pointer; text-align:left; color:inherit; font:400 14px/20px Roboto,Arial,sans-serif; }
.recipient-menu button:hover,.recipient-menu button:focus-visible { background:var(--base-fill); outline:none; }
.recipient-menu kbd { color:var(--placeholder-text-color); font:inherit; }
</style>
