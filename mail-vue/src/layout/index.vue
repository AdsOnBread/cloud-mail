<template>
  <div v-if="!sessionEnded" class="mail-layout" :style="shellStyle" :class="{ 'conversation-window': conversationWindow,'nav-expanded': uiStore.asideShow, 'settings-open':uiStore.quickSettings,'photo-theme':!!theme.active.image,'nav-compact':!uiStore.asideShow && !peek,'nav-peek':peek && !uiStore.asideShow && !isMobile }">
    <header :inert="composeModal" v-show="!conversationWindow" class="mail-header"><Header /></header>
    <aside v-show="!conversationWindow" @pointerenter="enterRail" @pointerleave="leaveRail" @focusin="focusRail" @focusout="blurRail" class="mail-sidebar" aria-label="Mail navigation" :inert="composeModal || (isMobile && !uiStore.asideShow)" :aria-hidden="isMobile && !uiStore.asideShow ? true : undefined"><Aside /></aside>
    <button v-if="!conversationWindow && uiStore.asideShow && isMobile" class="nav-overlay" :inert="composeModal" aria-label="Close navigation" @click="uiStore.asideShow = false" />
    <main class="mail-main" :inert="composeModal"><Main /></main>
    <writer ref="writerRef" :key="user.authenticatedToken" />
    <MailTooltip />
    <MailFeedback />
    <LabelEditor /><QuickSettings />
    <FilterEditor v-if="filters.editor" :key="filters.editor.id" :rule="filters.editor"/>
    <button v-if="!conversationWindow && route.name !== 'content'" v-perm="'email:send'" class="mobile-compose" :inert="composeModal" aria-label="Compose message" @click="uiStore.writerRef.open()"><Icon icon="material-symbols:edit-outline" width="24" /><span>Compose</span></button>
  </div>
</template>
<script setup>
import {useMessageFilters} from '@/store/message-filters';
import FilterEditor from '@/components/mail-filters/filter-editor.vue';
import {useAccountStore} from '@/store/account';
import { startDraftList } from '@/services/draft-list';
import { startDraftSync } from '@/services/cloud-drafts';
import QuickSettings from "@/components/quick-settings/index.vue";
import {useMailLabels} from "@/store/mail-labels";
import LabelEditor from "@/components/mail-labels/editor.vue";
import MailFeedback from '@/components/mail-feedback/index.vue';
import MailTooltip from '@/components/mail-tooltip/index.vue';
import Aside from '@/layout/aside/index.vue';
import Header from '@/layout/header/index.vue';
import Main from '@/layout/main/index.vue';
import writer from '@/layout/write/compose-dock.vue';
import { Icon } from '@iconify/vue';
import { computed, provide, shallowRef, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useUiStore } from '@/store/ui.js';
import { useMailTheme } from '@/store/mail-theme';
import {advancedSearchOpenerKey} from '@/store/mail-search';
provide(advancedSearchOpenerKey,shallowRef(null));
const theme=useMailTheme(),uiStore = useUiStore();
const shellStyle=computed(()=>{
  const active=theme.active;
  return {'--mail-row-height':uiStore.rowHeight+'px',
    '--mail-canvas':!['light','dark'].includes(active.id) && !uiStore.dark ? active.color : undefined,
    '--theme-image': active.image?'url("'+active.image+'")':undefined};
});
import {useUserStore} from '@/store/user';
const user=useUserStore();
const labels=useMailLabels(), filters=useMessageFilters(), filterAccount=useAccountStore();
watch(()=>[user.authenticatedToken,user.user.userId,filterAccount.currentAccountId],()=>{filters.editor=null;filters.senderRequest=null},{flush:'sync'});
function filterStorage(event){
  if((event.key===null || event.key==='token') && localStorage.getItem('token')!==user.authenticatedToken){
    filters.editor=null;filters.senderRequest=null;
  }
}
onMounted(()=>window.addEventListener('storage',filterStorage));
onBeforeUnmount(()=>{window.removeEventListener('storage',filterStorage);filters.editor=null;filters.senderRequest=null;});
const pointerInRail=ref(false),keyboardInRail=ref(false);
const peek=computed(()=>!isMobile.value && (pointerInRail.value || keyboardInRail.value || labels.optionsAnchor!==null));
let railTimer;
function enterRail(e){
  clearTimeout(railTimer);
  if(e.pointerType==='mouse' && !isMobile.value && !uiStore.asideShow)railTimer=setTimeout(()=>{pointerInRail.value=true;},150);
}
function leaveRail(){clearTimeout(railTimer);pointerInRail.value=false;}
function focusRail(e){keyboardInRail.value=e.target.matches(':focus-visible,.label-options');}
function blurRail(e){if(!e.currentTarget.contains(e.relatedTarget))keyboardInRail.value=false;}
watch(()=>uiStore.asideShow,()=>{leaveRail();keyboardInRail.value=false;});
const route = useRoute();
const conversationWindow=computed(()=>route.query.window==='1' && ((route.name==='content' && !!route.query.emailId) || route.name==='scheduled' || route.name==='trash'));
const sessionEnded = ref(false);
function checkReaderSession(event) {
  if (!conversationWindow.value || sessionEnded.value) return;
  if (event?.type === "storage" && (event.storageArea !== localStorage || (event.key !== null && event.key !== "token"))) return;
  if (user.authenticatedToken && user.authenticatedToken === localStorage.getItem("token")) return;
  event?.preventDefault();
  event?.stopImmediatePropagation();
  sessionEnded.value = true;
  window.location.replace("/");
}
const sessionEvents = ["storage", "pageshow", "focus", "click", "keydown"];
onMounted(() => {
  for (const event of sessionEvents) window.addEventListener(event, checkReaderSession, true);
  checkReaderSession();
});
onBeforeUnmount(() => {
  for (const event of sessionEvents) window.removeEventListener(event, checkReaderSession, true);
});
const writerRef = ref();
const composeModal=computed(()=>Boolean(writerRef.value?.modalOpen));
const isMobile = ref(window.innerWidth < 768);
let stopDraftSync, stopDraftList;
let size = window.innerWidth >= 1024 ? 'desktop' : window.innerWidth >= 768 ? 'tablet' : 'mobile';
function resize() {
  isMobile.value = window.innerWidth < 768;
  const next = window.innerWidth >= 1024 ? 'desktop' : window.innerWidth >= 768 ? 'tablet' : 'mobile';
  if (next !== size) { uiStore.asideShow = next === 'desktop'; size = next; }
}
watch(() => route.path, () => { if (isMobile.value) uiStore.asideShow = false; });
onMounted(() => { stopDraftList=startDraftList(); stopDraftSync=startDraftSync((...args)=>writerRef.value?.followDelivery(...args)); uiStore.writerRef = writerRef; window.addEventListener('resize', resize); });
onBeforeUnmount(() => { clearTimeout(railTimer);stopDraftList?.(); stopDraftSync?.(); uiStore.writerRef = null; window.removeEventListener('resize', resize); });
</script>
<style scoped>
.mail-layout { --nav-width:72px; position:fixed; inset:0; display:grid; grid-template-columns:var(--nav-width) minmax(0,1fr); grid-template-rows:64px minmax(0,1fr); background:var(--mail-canvas); }
.photo-theme {background:linear-gradient(#15191fd9,#15191f52 100%),var(--theme-image) center/cover no-repeat}
.photo-theme .mail-header :deep(.header-brand),.photo-theme .mail-header :deep(.toolbar > .icon-button){--regular-text-color:white;--mail-hover:#ffffff26}
.photo-theme .mail-header :deep(.page-title){color:white}
@media(min-width:768px){.photo-theme .mail-sidebar{--regular-text-color:white;--el-text-color-primary:white;--mail-hover:#ffffff29;--mail-selected:#ffffff3b;color:white}
.photo-theme .mail-sidebar :deep(.mail-icon){color:white}.photo-theme .mail-sidebar :deep(.el-menu){--el-menu-text-color:white}
.nav-peek .mail-sidebar{width:256px;position:relative;z-index:105;background:var(--mail-canvas);box-shadow:4px 4px 12px #0003;border-radius:0 16px 16px 0}
.photo-theme.nav-peek .mail-sidebar{background:#242830}
}
.nav-expanded { --nav-width:256px; }
.mail-header { grid-column:1/-1; min-width:0; }
.mail-sidebar { grid-column:1; grid-row:2; min-height:0; overflow:hidden; }
.mail-main { grid-column:2; grid-row:2; min-width:0; min-height:0; padding:0 16px 16px 0; }
.mobile-compose { display:none; }
@media (max-width:767px) {
 .mail-layout { grid-template-columns:minmax(0,1fr); }
 .mail-main { grid-column:1; padding:0; }
 .mail-sidebar { position:fixed; top:64px; bottom:0; left:0; width:280px; background:var(--mail-canvas); z-index:110; transform:translateX(-100%); transition:transform .15s; }
 .nav-expanded .mail-sidebar { transform:translateX(0); }
 .nav-overlay { position:fixed; inset:64px 0 0; background:#0006; z-index:100; }
 .mobile-compose { display:flex; position:fixed; right:16px; bottom:24px; padding:16px 20px; align-items:center; gap:12px; border-radius:16px; background:var(--mail-compose); color:var(--mail-on-compose); box-shadow:0 3px 8px #0003; z-index:20; cursor:pointer; }
}
@media (min-width:768px) and (prefers-reduced-motion:no-preference) { .mail-layout { transition:grid-template-columns .16s cubic-bezier(.2,0,0,1); } }
@media (prefers-reduced-motion:reduce) { .mail-sidebar { transition:none; } }
@media(min-width:900px){.settings-open .mail-main{padding-right:344px}}
.mail-layout.conversation-window { grid-template: minmax(0,1fr) / minmax(0,1fr); }
.conversation-window .mail-main { grid-area:1 / 1; padding:0; }
</style>
