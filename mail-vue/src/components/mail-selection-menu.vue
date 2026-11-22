<template>
  <el-dropdown ref="menu" trigger="click" placement="bottom-start" :show-arrow="false" :disabled="disabled"
    popper-class="mail-action-menu folder-selection-menu" :popper-options="placement" :offset="0" @command="$emit('select',$event)">
    <button ref="trigger" type="button" class="mail-icon select-options" :disabled="disabled" aria-label="Selection options" data-tip="Select"
      @keydown.esc="menu?.handleClose()"><Icon icon="material-symbols:arrow-drop-down" width="16"/></button>
    <template #dropdown><el-dropdown-menu>
      <el-dropdown-item v-for="group in groups" :key="group" :command="group">{{ group }}</el-dropdown-item>
    </el-dropdown-menu></template>
  </el-dropdown>
</template>
<script setup>
import {onDeactivated,onMounted,onUnmounted,ref} from 'vue';
import {Icon} from '@iconify/vue';
import {selectionKeys} from './mail-keyboard-shortcuts/selection-keys';
const props=defineProps({disabled:Boolean});
const emit=defineEmits(['select']);
const groups=Object.values(selectionKeys);
const placement={modifiers:[{name:'offset',options:{offset:[-25,-5]}}]};
const menu=ref(), trigger=ref();
function selectGroup(event) {
  if (event.defaultPrevented || props.disabled || !trigger.value?.getClientRects().length || !groups.includes(event.detail)) return;
  event.preventDefault();
  emit('select',event.detail);
}
onMounted(()=>window.addEventListener('mail-select-group',selectGroup));
onUnmounted(()=>window.removeEventListener('mail-select-group',selectGroup));
defineExpose({focus:()=>trigger.value?.focus()});
onDeactivated(()=>menu.value?.handleClose());
</script>
