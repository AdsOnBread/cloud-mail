<template>
  <div class="recipient-field" :class="{ 'has-error': error }">
    <label :for="inputId">{{ label }}</label>
    <div class="recipient-entry" @click="input?.focus()">
      <span v-for="(address, index) in modelValue" :key="index" class="recipient-chip" :class="{ invalid: !isEmail(address) }">
        <span :title="address">{{ address }}</span>
        <button type="button" :aria-label="`Remove ${address} from ${label}`" @click.stop="remove(index)">×</button>
      </span>
      <input ref="input" :id="inputId" v-model="pending" :list="`${inputId}-suggestions`"
        :aria-label="`${label} recipients`" :aria-invalid="!!error" :aria-describedby="error ? `${inputId}-error` : undefined"
        autocomplete="off" autocapitalize="off" spellcheck="false" @keydown="keydown" @blur="commit" @paste="paste" />
      <datalist :id="`${inputId}-suggestions`">
        <option v-for="address in suggestions" :key="address" :value="address" />
      </datalist>
    </div>
    <slot />
    <button type="button" class="contact-button" :aria-label="`Choose ${label} contacts`" title="Recent contacts" @click="$emit('contacts')">
      <Icon icon="material-symbols:person-add-outline" width="18" />
    </button>
    <p v-if="error" :id="`${inputId}-error`" class="recipient-error" role="alert">{{ error }}</p>
  </div>
</template>
<script setup>
import { computed, ref, useId } from 'vue';
import { Icon } from '@iconify/vue';
import { splitRecipients } from '@/utils/recipients.js';
import { isEmail } from '@/utils/verify-utils.js';
const props = defineProps({ modelValue: { type: Array, default: () => [] }, label: String,
  contacts: { type: Array, default: () => [] }, error: String });
const emit = defineEmits(['update:modelValue', 'contacts']);
const pending = ref('');
const input = ref();
const inputId = `recipient-${useId()}`;
const suggestions = computed(() => props.contacts.filter(address => pending.value &&
  address.toLowerCase().includes(pending.value.toLowerCase()) &&
  !props.modelValue.some(value => value.toLowerCase() === address.toLowerCase())).slice(0, 10));
function commit() {
  const entered = splitRecipients(pending.value);
  if (entered.length) emit('update:modelValue', [...props.modelValue, ...entered]);
  pending.value = '';
}
function remove(index) { emit('update:modelValue', props.modelValue.filter((_, i) => i !== index)); }
function keydown(event) {
  if (['Enter', ',', ';'].includes(event.key)) { event.preventDefault(); commit(); }
  if (event.key === 'Tab') commit();
  if (event.key === 'Backspace' && !pending.value) remove(props.modelValue.length - 1);
}
function paste(event) {
  const text = event.clipboardData.getData('text');
  if (/[,，;\n\r]/.test(text)) { event.preventDefault(); pending.value += text; commit(); }
}
defineExpose({ commit, focus: () => input.value?.focus(), clear: () => { pending.value = ''; } });
</script>
<style scoped>
.recipient-field { display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-height:40px; border-bottom:1px solid var(--compose-divider, var(--light-border-color)); padding:5px 0; }
label { width:35px; flex-shrink:0; color:var(--regular-text-color); font-size:13px; }
.recipient-entry { flex:1; min-width:100px; display:flex; align-items:center; flex-wrap:wrap; gap:4px; cursor:text; }
input { appearance:none; border:0; border-radius:0; outline:none; background:transparent; font:inherit; flex:1; width:100px; min-width:80px; padding:4px 0; color:inherit; }
.recipient-chip { display:inline-flex; align-items:center; border:1px solid var(--compose-divider, var(--light-border-color)); border-radius:16px; padding:1px 6px 1px 10px; font-size:12px; max-width:100%; gap:4px; }
.recipient-chip > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.recipient-chip button { width:20px; height:24px; cursor:pointer; color:var(--regular-text-color); border-radius:50%; }
.invalid { border-color:var(--el-color-danger); }
.contact-button { display:flex; padding:6px; border-radius:50%; color:var(--regular-text-color); cursor:pointer; }
button:hover { background:var(--base-fill); }
.recipient-error { width:100%; font-size:12px; color:var(--el-color-danger); padding-left:40px; }
</style>
