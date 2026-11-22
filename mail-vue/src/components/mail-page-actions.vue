<template>
  <el-dropdown ref="dropdown" trigger="click" placement="bottom-start" :show-arrow="false"
    :popper-options="placement" popper-class="mail-action-menu mail-page-actions" @command="$emit('mark-read')">
    <button type="button" class="mail-icon page-more-trigger" :aria-label="label" data-tip="More"
      @keydown.esc="dropdown?.handleClose()">
      <Icon icon="material-symbols:more-vert" width="20"/>
    </button>
    <template #dropdown>
      <el-dropdown-menu @focusin="focusCommand">
        <el-dropdown-item command="read" :disabled="disabled" :aria-describedby="hint">
          <Icon aria-hidden="true" icon="material-symbols:drafts-outline" width="20"/>
          Mark all as read
        </el-dropdown-item>
        <li role="presentation" class="page-action-divider"></li>
        <li role="presentation" :id="hint" class="page-action-hint">Select messages to see more actions</li>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import {ref,useId} from 'vue';
import {Icon} from '@iconify/vue';
defineProps({label:{type:String,required:true},disabled:Boolean});
defineEmits(['mark-read']);
const dropdown=ref(), hint=useId();
function focusCommand(event) {
  if (event.target===event.currentTarget)
    event.target.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus({preventScroll:true});
}
const placement={modifiers:[{name:'offset',options:{
  offset:({reference})=>[(reference.width-20)/2,-(reference.height-20)/2],
}}]};
</script>

<style>
.mail-page-actions.el-popper.is-light {
  border:0;
  border-radius:4px;
  color:#202124;
  background:white;
}
.mail-page-actions .el-dropdown-menu {
  width:256px;
  max-width:calc(100vw - 16px);
  padding:6px 0;
  color:inherit;
  background:inherit;
}
.mail-page-actions .el-dropdown-menu__item {
  position:relative;
  padding:6px 48px;
  color:inherit;
  font:14px/20px Arial,sans-serif;
}
.mail-page-actions .el-dropdown-menu__item svg {
  position:absolute;
  inset-inline-start:16px;
  width:20px;
  height:20px;
  margin:0;
  color:var(--regular-text-color);
}
.mail-page-actions .el-dropdown-menu__item:not(.is-disabled):is(:hover,:focus) {background:#eee;color:inherit}
.mail-page-actions .page-action-divider {margin:6px 0;border-top:1px solid var(--light-border-color)}
.mail-page-actions .page-action-hint {padding:6px 48px;color:var(--secondary-text-color);font:italic 14px/20px Arial,sans-serif}
html.dark .mail-page-actions.el-popper.is-light {color:var(--el-text-color-primary);background:var(--mail-surface)}
html.dark .mail-page-actions .el-dropdown-menu__item:not(.is-disabled):is(:hover,:focus) {background:var(--mail-hover)}
@media (forced-colors:active) {
  .mail-page-actions.el-popper.is-light {outline:1px solid CanvasText}
  .mail-page-actions .el-dropdown-menu__item:focus-visible {outline:2px solid Highlight;outline-offset:-2px}
}
</style>
