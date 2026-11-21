<template>
  <div class="recipient-field" :class="{ 'has-error': error }">
    <button type="button" class="field-label" ref="labelButton" :aria-label="`Choose ${label} contacts`"
      :data-tip="`${label} - Select contacts`" @click="$emit('contacts')">{{ label }}</button>
    <div ref="entry" class="recipient-entry" @click.self="input?.focus()">
      <template v-for="(address, index) in modelValue" :key="index">
        <span v-if="editing !== index" class="recipient-chip" :style="{order:index}"
          :class="{ invalid: !isEmail(address), chosen: menuIndex === index }">
          <button type="button" class="chip-address" :data-index="index" :title="address" :aria-label="address"
            aria-haspopup="menu" :aria-expanded="menuIndex === index" tabindex="-1"
            @pointerdown.prevent @click="openMenu(index)" @contextmenu.prevent="openMenu(index)"
            @keydown="chipKey($event,index)" @copy="clipboardEvent($event,index)" @cut="clipboardEvent($event,index)">
            <span class="avatar" aria-hidden="true">{{ display(address).charAt(0).toUpperCase() }}</span>
            <span class="chip-text">{{ display(address) }}</span>
          </button>
          <button type="button" class="remove" :aria-label="`Remove ${address} from ${label}`" tabindex="-1"
            @pointerdown.prevent @click="remove(index)"> <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12m0-12L6 18"/></svg></button>
        </span>
      </template>
      <input ref="input" :id="inputId" v-model="pending" role="combobox" aria-autocomplete="list"
        :aria-expanded="!!options.length" :aria-controls="options.length ? listId : undefined"
        :aria-activedescendant="options[active] ? listId+'-'+active : undefined"
        :style="{order:editing ?? modelValue.length}" :aria-label="`${label} recipients`"
        :aria-invalid="!!error" :aria-describedby="error ? `${inputId}-error` : undefined"
        autocomplete="off" autocapitalize="off" spellcheck="false" @input="typing=true" @keydown="keydown" @blur="commit" @paste="paste" />
    </div>
    <slot />
    <p v-if="error" :id="`${inputId}-error`" class="recipient-error" role="alert">{{ error }}</p>
    <Teleport to="body">
      <div v-if="options.length" ref="panel" :id="listId" class="recipient-suggestions" :style="position"
        role="listbox" :aria-label="`${label} suggestions`" @mousedown.prevent>
        <div v-for="(person,i) in options" :key="person.email" :id="listId+'-'+i"
          role="option" :aria-selected="active===i" @pointermove="active=i" @click="pick(person)">
          <span class="suggestion-avatar" aria-hidden="true">{{ person.name.charAt(0).toUpperCase() }}</span>
          <span class="suggestion-lines">
            <span v-for="(line,n) in [person.name===person.email ? person.email.split('@')[0] : person.name,person.email]" :key="n">
              <template v-for="(part,j) in highlighted(line)" :key="j"><b v-if="j===1">{{ part }}</b><template v-else>{{ part }}</template></template>
            </span>
          </span>
        </div>
      </div>
      <div v-if="menuIndex !== null" ref="menu" role="menu" :aria-label="`${label} recipient actions`"
        class="recipient-menu compose-format-popup" :style="menuStyle" @keydown="menuKey" @mousedown.prevent @focusout="leaveMenu">
        <button type="button" role="menuitem" @click="clipboardAction(false)">Copy email address</button>
        <button type="button" role="menuitem" @click="clipboardAction(true)">Cut</button>
        <button type="button" role="menuitem" @click="edit(menuIndex)">Change email address <kbd>Shift+F</kbd></button>
      </div>
    </Teleport>
  </div>
</template>
<script setup>
import { nextTick, ref, useId, watch } from 'vue';
import {useRecipientSuggestions} from './suggestions';
import { splitRecipients } from '@/utils/recipients.js';
import { isEmail } from '@/utils/verify-utils.js';
import { positionMailboxPopup } from '../mail-popup-position.js';
const props = defineProps({ modelValue: { type: Array, default: () => [] }, label: String,
  names: Object, removed: {type:Array,default:()=>[]}, recent: {type:Array,default:()=>[]}, otherRecipients: {type:Array,default:()=>[]}, accountId: Number, owner: String, error: String });
const emit = defineEmits(['update:modelValue', 'contacts', 'choosePerson']);
const input = ref(), entry = ref(), labelButton = ref(), menu = ref(), menuStyle = ref({});
const pending = ref(''), editing = ref(null), menuIndex = ref(null);
const inputId = `recipient-${useId()}`;
function display(address) {
  const key = address.toLowerCase();
  const name = props.names && Object.hasOwn(props.names,key) && props.names[key];
  return typeof name === 'string' && name ? name : address;
}
const listId = inputId+'-suggestions';
const {panel,position,typing,options,active,keys,close:hideSuggestions,pick,highlighted} =
  useRecipientSuggestions(props,pending,input,editing,person=>{
    emit('choosePerson',person);
    pending.value=person.email;
    commit();
    input.value?.focus();
  });
function clear() {
  hideSuggestions();
  pending.value = '';
  editing.value = null;
  menuIndex.value = null;
}
// A pointer can activate a different chip while the input still holds an edit.
// Resolve both changes against one version of the list before Vue moves the chips.
function resolveInput(targetIndex) {
  hideSuggestions();
  const updated = [...props.modelValue];
  const entered = splitRecipients(pending.value);
  const source = editing.value;
  const changed = entered.length > 0 || source !== null;
  if (changed) updated.splice(source ?? updated.length, source === null ? 0 : 1, ...entered);
  const index = source !== null && targetIndex > source ? targetIndex + entered.length - 1 : targetIndex;
  pending.value = '';
  editing.value = null;
  return {updated, index, changed};
}
function commit() {
  const {updated,changed} = resolveInput();
  if (changed) emit('update:modelValue', updated);
}
function chip(index) { return entry.value?.querySelector(`[data-index="${index}"]`); }
function focusAt(index) { (chip(index) || input.value)?.focus(); }
function remove(targetIndex) {
  const {updated,index} = resolveInput(targetIndex);
  menuIndex.value = null;
  updated.splice(index,1);
  emit('update:modelValue', updated);
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
  if (keys(event)) return;
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
async function openMenu(targetIndex) {
  const {updated,index,changed} = resolveInput(targetIndex);
  if (changed) emit('update:modelValue', updated);
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
  else if (event.key === 'Tab') {
    closeMenu(false);
    (event.shiftKey ? labelButton.value : input.value)?.focus();
  }
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
.recipient-suggestions { position:fixed; z-index:2450; box-sizing:border-box; padding:4px 0; overflow:auto; overscroll-behavior:contain; border-radius:8px; background:var(--mail-surface,#fff); color:var(--el-text-color-primary); box-shadow:0 2px 6px 2px #3c404326,0 1px 2px #3c40434d; font:14px/20px Roboto,Arial,sans-serif; }
.recipient-suggestions [role=option] { height:52px; box-sizing:border-box; display:flex; align-items:center; gap:16px; padding:0 12px; cursor:pointer; }
.recipient-suggestions [aria-selected=true] { background:var(--mail-hover,#f2f2f2); }
.suggestion-avatar { display:grid; place-items:center; flex:0 0 32px; height:32px; border-radius:50%; background:#647781; color:#fff; font-size:16px; }
.suggestion-lines { display:grid; min-width:0; }
.suggestion-lines > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.suggestion-lines > span + span { color:var(--regular-text-color); font-size:12px; line-height:16px; }
</style>
