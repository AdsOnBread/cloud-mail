<template>
  <div class="mail-range">
    <el-dropdown v-if="total" ref="menu" :disabled="disabled" trigger="click" placement="bottom-start"
      :offset="0" :show-arrow="false" popper-class="mail-action-menu folder-range-menu" @command="$emit('jump',$event)">
      <button type="button" class="toolbar-text range-trigger" :disabled="disabled" aria-label="Show more messages"
        :aria-description="range" data-tip="Show more messages" @keydown.esc="menu?.handleClose()">{{ range }}</button>
      <template #dropdown><el-dropdown-menu>
        <el-dropdown-item command="newest" :disabled="offset===0">Newest</el-dropdown-item>
        <el-dropdown-item command="oldest" :disabled="offset+count>=total">Oldest</el-dropdown-item>
      </el-dropdown-menu></template>
    </el-dropdown>
  </div>
</template>
<script setup>
import {computed,onDeactivated,ref} from 'vue';
const props=defineProps({offset:Number,count:Number,total:Number,disabled:Boolean});
defineEmits(['jump']);
const menu=ref();
const numbers=new Intl.NumberFormat("en-US");
const range=computed(()=>`${numbers.format(props.offset+1)}–${numbers.format(props.offset+props.count)} of ${numbers.format(props.total)}`);
onDeactivated(()=>menu.value?.handleClose());
</script>
<style scoped>
.mail-range {margin-inline-start:auto;flex:none}
.mail-range .range-trigger {margin:0;font:400 12px/16px Arial,sans-serif;color:var(--secondary-text-color);white-space:nowrap}
:global(.folder-range-menu .el-dropdown-menu__item) {padding:6px 48px;line-height:20px}
:global(.folder-range-menu .el-dropdown-menu__item.is-disabled) {color:var(--el-text-color-disabled)}
</style>
