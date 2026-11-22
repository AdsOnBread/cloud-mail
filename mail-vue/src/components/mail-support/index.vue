<template>
  <el-dropdown ref="dropdown" trigger="click" placement="bottom-end" :offset="0" :show-arrow="false"
    popper-class="mail-support-menu" @visible-change="expanded=$event" @command="choose">
    <button ref="trigger" type="button" class="support-trigger" data-tip="Support" aria-label="Support" :aria-expanded="expanded">
      <Icon icon="material-symbols:help-outline" width="24" aria-hidden="true"/>
    </button>
    <template #dropdown>
      <el-dropdown-menu aria-label="Support" @focusin="focusFirst">
        <el-dropdown-item command="home">Help</el-dropdown-item>
        <el-dropdown-item command="shortcuts">Keyboard shortcuts</el-dropdown-item>
        <el-dropdown-item command="notice" divided>Announcements</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
  <HelpPanel v-if="view" :key="view" :initial="view" @close="closePanel" @shortcuts="openShortcuts"/>
</template>
<script setup>
import {nextTick,ref,watch} from 'vue';
import {Icon} from '@iconify/vue';
import {useUserStore} from '@/store/user';
import {useUiStore} from '@/store/ui';
import {useSettingStore} from '@/store/setting';
import HelpPanel from './panel.vue';

const emit=defineEmits(['shortcuts']);
const trigger=ref(), dropdown=ref(), expanded=ref(false), view=ref('');
const user=useUserStore(), ui=useUiStore(), settings=useSettingStore();
function focusFirst(event) {
  if(event.target===event.currentTarget) event.target.querySelector('[role=menuitem]')?.focus({preventScroll:true});
}
function closePanel(restore=true) {
  view.value='';
  if(restore) trigger.value?.focus({preventScroll:true});
}
function openShortcuts() {
  closePanel();
  emit('shortcuts',trigger.value);
}
async function choose(command) {
  const token=user.authenticatedToken;
  await nextTick();
  if(!token || user.authenticatedToken!==token || localStorage.getItem('token')!==token) return;
  if(command==='shortcuts') return openShortcuts();
  if(command==='notice' && settings.settings.notice!==1 && settings.settings.noticeContent?.trim()) {
    closePanel();
    ui.showNotice();
    return;
  }
  view.value=command;
}
watch(()=>user.authenticatedToken,()=>{closePanel(false);dropdown.value?.handleClose();});
</script>
<style scoped>
.support-trigger{display:grid;place-items:center;width:40px;height:40px;padding:8px;flex:none;border-radius:50%;color:var(--regular-text-color);cursor:pointer}
.support-trigger:is(:hover,[aria-expanded=true]){background:var(--mail-hover)}
:global(.photo-theme) .support-trigger{color:white}
@media(max-width:767px){.support-trigger{width:32px;height:36px;padding:4px}}
</style>
<style>
.mail-support-menu.el-popper.is-light{border:0;border-radius:4px;background:white;color:#202124;box-shadow:0 1px 2px #3c40434d,0 2px 6px 2px #3c404326}
.mail-support-menu .el-dropdown-menu{min-width:220px;padding:6px 0;background:inherit;color:inherit}
.mail-support-menu .el-dropdown-menu__item{color:inherit;font:14px/20px Arial,sans-serif;padding:6px 30px}
.mail-support-menu .el-dropdown-menu__item:not(.is-disabled):is(:hover,:focus){background:#eee;color:inherit}
.mail-support-menu .el-dropdown-menu__item--divided{margin:7px 0}
html.dark .mail-support-menu.el-popper.is-light{background:var(--mail-surface);color:var(--el-text-color-primary)}
html.dark .mail-support-menu .el-dropdown-menu__item:not(.is-disabled):is(:hover,:focus){background:var(--mail-hover)}
@media(forced-colors:active){.mail-support-menu.el-popper.is-light{outline:1px solid CanvasText}}
</style>
