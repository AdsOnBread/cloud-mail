<template>
  <TransitionGroup name="mail-feedback" @before-leave="hideActions" tag="div" class="mail-feedback-stack">
    <div v-for="notice in notices" :key="notice.id" class="mail-feedback"
      @mouseenter="pause" @mouseleave="schedule" @focusin="pause" @focusout="schedule">
      <span role="status">{{ notices.length > 1 && notice.holding && notice.subject ? 'Sending “' + notice.subject + '”…' : notice.message }}</span>
      <button v-if="notice.recovery || notice.undoFiling || notice.emailIds.length" :disabled="notice.busy" @click="feedback.undo(notice)">Undo</button>
      <RouterLink v-if="notice===feedback.notice && messageLocation" custom :to="messageLocation" v-slot="{href,navigate}">
        <a :href="href" @click="openMessage($event,navigate)">View message</a>
      </RouterLink>
      <button v-if="notice.retry" :disabled="notice.busy" @click="notice.retry()">Retry</button>
      <button class="dismiss" aria-label="Dismiss notification" @click="feedback.dismiss(notice)"><Icon icon="material-symbols:close" width="18" /></button>
    </div>
  </TransitionGroup>
</template>
<script setup>
import { computed, nextTick, watch, onMounted, onBeforeUnmount } from "vue";
import {useRoute} from "vue-router";
import { Icon } from "@iconify/vue";
import {retryPendingTrash} from '@/services/scheduled-trash';
import { useMailFeedback } from "@/store/mail-feedback";
import { useUserStore } from "@/store/user";
const feedback = useMailFeedback(), user = useUserStore();
const route=useRoute();
const notices=computed(()=>[...feedback.previousHolds.filter(n=>n.undoFiling || n.busy), ...(feedback.notice ? [feedback.notice] : [])]);
const messageLocation=computed(()=>{
  const notice=feedback.notice;
  const windowQuery=route.query.window==='1' ? {window:'1'} : {};
  if (notice?.scheduledMessage) return {name:'scheduled',query:{
    message:notice.scheduledMessage.draftId,sender:notice.scheduledMessage.accountId,...windowQuery
  }};
  if (notice?.sentEmailId) return {name:'content',query:{emailId:notice.sentEmailId,folder:'sent',
    ...windowQuery}};
  return null;
});
async function openMessage(event,navigate) {
  if (event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const link=event.currentTarget,notice=feedback.notice;
  const failure=await navigate(event);
  await nextTick();
  if (failure || feedback.notice!==notice) return;
  const scheduled=notice.scheduledMessage;
  if (scheduled ? route.name!=='scheduled' || Number(route.query.message)!==scheduled.draftId :
      route.name!=='content' || Number(route.query.emailId)!==notice.sentEmailId) return;
  if (document.activeElement===link || document.activeElement===document.body)
    document.querySelector(scheduled ? '.scheduled-view [data-reader-back]' : '.conversation-view [data-reader-back]')?.focus({preventScroll:true});
  feedback.dismiss();
}
function hideActions(element) { element.inert=true; }
let timer;
function pause() { clearTimeout(timer); }
function schedule() {
  pause();
  if (feedback.notice && !feedback.notice.busy && !feedback.notice.retry && !feedback.notice.holding)
    timer = setTimeout(() => { feedback.dismiss(); }, 10000);
}
watch(() => [feedback.notice, feedback.notice?.busy, feedback.notice?.holding], schedule, {immediate:true});
function clearNotices() { feedback.dismiss(); feedback.previousHolds=[]; }
watch([() => user.user.email, () => user.authenticatedToken],clearNotices);
watch(()=>[user.user.email,user.authenticatedToken],retryPendingTrash,{immediate:true});
watch(()=>feedback.notice?.scheduledTrash,(current,previous)=>{if (previous && !current) retryPendingTrash();});
onMounted(()=>window.addEventListener('online',retryPendingTrash));
onBeforeUnmount(() => { window.removeEventListener('online',retryPendingTrash); pause(); clearNotices(); });
</script>
<style scoped>
.mail-feedback-stack {position:fixed;z-index:1500;bottom:24px;left:24px;max-width:calc(100vw - 48px);display:flex;flex-direction:column;align-items:flex-start;gap:6px;pointer-events:none}
.mail-feedback { pointer-events:auto;max-width:100%; min-height:48px; padding:8px 12px 8px 20px; border-radius:6px; display:flex; align-items:center; gap:16px; background:#323232; color:#fff; box-shadow:0 2px 6px #0003; font-size:14px; }
.mail-feedback [role=status]{overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere}
button,a { color:#a8c7fa;text-decoration:none; padding:6px; font-weight:600; border-radius:4px; cursor:pointer; }
button:hover,a:hover { background:#ffffff14; }
.dismiss { color:#e3e3e3; display:grid; place-items:center; }
.mail-feedback-enter-active,.mail-feedback-leave-active { transition:opacity .14s,transform .14s; }
.mail-feedback-enter-from,.mail-feedback-leave-to { opacity:0; transform:translateY(5px); }
@media(max-width:767px){.mail-feedback-stack{bottom:16px;left:12px;max-width:calc(100vw - 24px)}}
@media(prefers-reduced-motion:reduce){.mail-feedback-enter-active,.mail-feedback-leave-active{transition:none}}
</style>
