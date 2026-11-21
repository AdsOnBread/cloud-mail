<template>
  <el-dropdown trigger="click" placement="bottom-start" :show-arrow="false" :disabled="disabled"
    :popper-options="placement" popper-class="compose-format-popup response-menu" @command="$emit('command',$event)">
    <button type="button" class="response-trigger" aria-label="Type of response" data-tip="Type of response" :disabled="disabled">
      <Icon :icon="icons[mode]" width="20"/><Icon icon="material-symbols:arrow-drop-down" width="20"/>
    </button>
    <template #dropdown><el-dropdown-menu aria-label="Type of response">
      <el-dropdown-item v-for="choice in choices" :key="choice.id" :command="choice.id">
        <Icon :icon="icons[choice.id]" width="20"/>{{ choice.label }}
      </el-dropdown-item>
      <el-dropdown-item divided command="subject">Edit subject</el-dropdown-item>
      <el-dropdown-item v-if="inline" command="pop">Pop out reply</el-dropdown-item>
    </el-dropdown-menu></template>
  </el-dropdown>
</template>
<script setup>
import { computed } from "vue";
import { Icon } from "@iconify/vue";
const props=defineProps({mode:String,all:Boolean,inline:Boolean,disabled:Boolean});
defineEmits(["command"]);
const icons={reply:"material-symbols:reply",all:"material-symbols:reply-all",forward:"material-symbols:forward"};
const choices=computed(()=>[{id:"reply",label:"Reply"},...(props.all?[{id:"all",label:"Reply all"}]:[]),{id:"forward",label:"Forward"}]);
const placement={modifiers:[{name:"offset",options:{offset:[0,0]}}]};
</script>
<style scoped>
.response-trigger {height:36px;width:56px;display:inline-flex;align-items:center;justify-content:center;padding:8px;
  border:0;border-radius:4px;color:var(--regular-text-color);background:transparent;cursor:pointer;}
.response-trigger:hover,.response-trigger[aria-expanded=true] {background:var(--base-fill);}
:global(.response-menu.el-popper) {border:0;border-radius:4px;background:var(--mail-surface);box-shadow:0 8px 10px 1px #00000024,0 3px 14px 2px #0000001f,0 5px 5px -3px #0003;overflow:hidden;}
:global(.response-menu .el-dropdown-menu) {min-width:180px;padding:6px 0;background:var(--mail-surface);}
:global(.response-menu .el-dropdown-menu__item) {position:relative;height:32px;padding:6px 30px 6px 48px;color:var(--regular-text-color);font:14px/20px Arial,sans-serif;}
:global(.response-menu .el-dropdown-menu__item svg) {position:absolute;left:16px;}
:global(.response-menu .el-dropdown-menu__item--divided) {margin-top:13px;}
:global(.response-menu .el-dropdown-menu__item--divided::before) {position:absolute;top:-7px;left:0;width:100%;height:1px;margin:0;background:var(--compose-divider);}
:global(.response-menu .el-dropdown-menu__item:focus),:global(.response-menu .el-dropdown-menu__item:hover) {background:var(--mail-hover);color:var(--el-text-color-primary);}
@media(forced-colors:active){:global(.response-menu.el-popper){border:1px solid ButtonText;}:global(.response-menu .el-dropdown-menu__item:focus){outline:2px solid Highlight;outline-offset:-2px;}}
</style>
