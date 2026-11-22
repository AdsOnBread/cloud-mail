<template>
  <el-dropdown ref="menu" trigger="click" placement="bottom-start" :show-arrow="false" :disabled="disabled"
    popper-class="mail-action-menu folder-selection-menu" :popper-options="placement" :offset="0" @command="$emit('select',$event)">
    <button type="button" class="mail-icon select-options" :disabled="disabled" aria-label="Selection options" data-tip="Select"
      @keydown.esc="menu?.handleClose()"><Icon icon="material-symbols:arrow-drop-down" width="16"/></button>
    <template #dropdown><el-dropdown-menu>
      <el-dropdown-item v-for="group in groups" :key="group" :command="group">{{ group }}</el-dropdown-item>
    </el-dropdown-menu></template>
  </el-dropdown>
</template>
<script setup>
import {onDeactivated,ref} from 'vue';
import {Icon} from '@iconify/vue';
defineProps({disabled:Boolean});
defineEmits(['select']);
const groups=['All','None','Read','Unread','Starred','Unstarred'];
const placement={modifiers:[{name:'offset',options:{offset:[-25,-5]}}]};
const menu=ref();
onDeactivated(()=>menu.value?.handleClose());
</script>
