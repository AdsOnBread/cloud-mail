<template>
  <button ref="trigger" type="button" tabindex="0" class="support-trigger" data-tip="Support" aria-label="Support"
    aria-haspopup="menu" :aria-expanded="expanded" :aria-controls="expanded ? id : undefined"
    @click="expanded ? closeMenu(true) : openMenu()" @keydown.down.stop.prevent="openMenu()"
    @keydown.up.stop.prevent="openMenu(-1)" @keydown.esc="escapeMenu">
    <Icon icon="material-symbols:help-outline" width="24" aria-hidden="true"/>
  </button>
  <Teleport to="body">
    <div v-if="expanded" :id="id" ref="menu" class="mail-support-menu" role="menu" aria-label="Support"
      :style="position" @keydown="navigate">
      <button type="button" role="menuitem" tabindex="-1" @click="choose('home')">Help</button>
      <button type="button" role="menuitem" tabindex="-1" @click="choose('shortcuts')">Keyboard shortcuts</button>
      <div role="separator"></div>
      <button type="button" role="menuitem" tabindex="-1" @click="choose('notice')">Announcements</button>
    </div>
  </Teleport>
  <HelpPanel v-if="view" :key="opening" :initial="view" @close="closePanel" @shortcuts="openShortcuts"/>
</template>
<script setup>
import {nextTick,ref,useId,watch} from 'vue';
import {Icon} from '@iconify/vue';
import {useUserStore} from '@/store/user';
import {useUiStore} from '@/store/ui';
import {useSettingStore} from '@/store/setting';
import {positionMailboxPopup} from '../mail-popup-position';
import HelpPanel from './panel.vue';

const emit=defineEmits(['shortcuts']);
const trigger=ref(), menu=ref(), expanded=ref(false), view=ref(''), opening=ref(0);
const id=useId(), position=ref({});
const user=useUserStore(), ui=useUiStore(), settings=useSettingStore();

function placeMenu() {
  if(menu.value && trigger.value) position.value=positionMailboxPopup(menu.value,trigger.value,220,trigger.value,true,0);
}
function focusItem(index) {
  const items=menu.value?.querySelectorAll('[role=menuitem]');
  if(items?.length) items[(index+items.length)%items.length].focus({preventScroll:true});
}
async function openMenu(index=0) {
  expanded.value=true;
  await nextTick();
  placeMenu();
  focusItem(index);
}
function closeMenu(restore=false) {
  expanded.value=false;
  if(restore) trigger.value?.focus({preventScroll:true});
}
function escapeMenu(event) {
  if(!expanded.value) return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu(true);
}
function navigate(event) {
  const items=Array.from(menu.value.querySelectorAll('[role=menuitem]'));
  const index=items.indexOf(document.activeElement);
  switch(event.key) {
    case 'Tab': closeMenu(true); return;
    case 'Escape': escapeMenu(event); return;
    case 'ArrowDown': focusItem(index+1); break;
    case 'ArrowUp': focusItem(index-1); break;
    case 'Home': focusItem(0); break;
    case 'End': focusItem(-1); break;
    default: return;
  }
  event.preventDefault();
  event.stopPropagation();
}
watch(expanded,(visible,_,cleanup)=>{
  if(!visible) return;
  function outside(event) {
    if(!menu.value?.contains(event.target) && !trigger.value?.contains(event.target)) closeMenu();
  }
  document.addEventListener('pointerdown',outside,true);
  document.addEventListener('focusin',outside,true);
  window.addEventListener('resize',placeMenu);
  window.visualViewport?.addEventListener('resize',placeMenu);
  window.visualViewport?.addEventListener('scroll',placeMenu);
  cleanup(()=>{
    document.removeEventListener('pointerdown',outside,true);
    document.removeEventListener('focusin',outside,true);
    window.removeEventListener('resize',placeMenu);
    window.visualViewport?.removeEventListener('resize',placeMenu);
    window.visualViewport?.removeEventListener('scroll',placeMenu);
  });
});
function closePanel(restore=true) {
  view.value='';
  if(restore) trigger.value?.focus({preventScroll:true});
}
function openShortcuts() {
  closePanel();
  emit('shortcuts',trigger.value);
}
async function choose(command) {
  closeMenu();
  const token=user.authenticatedToken;
  await nextTick();
  if(!token || user.authenticatedToken!==token || localStorage.getItem('token')!==token) return;
  if(command==='shortcuts') return openShortcuts();
  if(command==='notice' && settings.settings.notice!==1 && settings.settings.noticeContent?.trim()) {
    closePanel();
    ui.showNotice();
    return;
  }
  opening.value++;
  view.value=command;
}
watch(()=>user.authenticatedToken,()=>{closePanel(false);closeMenu();});
</script>
<style scoped>
.support-trigger{display:grid;place-items:center;width:40px;height:40px;padding:8px;flex:none;border-radius:50%;color:var(--regular-text-color);cursor:pointer}
.support-trigger:is(:hover,[aria-expanded=true]){background:var(--mail-hover)}
@media(max-width:767px){.support-trigger{width:32px;height:36px;padding:4px}}
</style>
<style>
.photo-theme .mail-header .support-trigger{color:white}
.mail-support-menu{position:fixed;z-index:2400;box-sizing:border-box;width:220px;overflow:auto;padding:6px 0;border-radius:4px;background:white;color:#202124;box-shadow:0 1px 2px #3c40434d,0 2px 6px 2px #3c404326}
.mail-support-menu button{display:block;width:100%;border:0;background:transparent;color:inherit;text-align:start;font:14px/20px Arial,sans-serif;padding:6px 30px;cursor:pointer}
.mail-support-menu button:is(:hover,:focus-visible){background:#eee}
.mail-support-menu [role=separator]{margin:7px 0;border-top:1px solid #dadce0}
html.dark .mail-support-menu{background:var(--mail-surface);color:var(--el-text-color-primary)}
html.dark .mail-support-menu button:is(:hover,:focus-visible){background:var(--mail-hover)}
html.dark .mail-support-menu [role=separator]{border-color:var(--el-border-color)}
@media(forced-colors:active){.mail-support-menu{outline:1px solid CanvasText}}
</style>
