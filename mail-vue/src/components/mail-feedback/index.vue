<template>
  <Transition name="mail-feedback">
    <div v-if="feedback.notice" class="mail-feedback" @mouseenter="pause" @mouseleave="schedule" @focusin="pause" @focusout="schedule">
      <span role="status">{{ feedback.notice.message }}</span>
      <button v-if="feedback.notice.recovery || feedback.notice.undoFiling || feedback.notice.emailIds.length" :disabled="feedback.notice.busy" @click="feedback.undo()">Undo</button>
      <button v-if="feedback.notice.retry" :disabled="feedback.notice.busy" @click="feedback.notice.retry()">Retry</button>
      <button class="dismiss" aria-label="Dismiss notification" @click="feedback.dismiss()"><Icon icon="material-symbols:close" width="18" /></button>
    </div>
  </Transition>
</template>
<script setup>
import { watch, onMounted, onBeforeUnmount } from "vue";
import { Icon } from "@iconify/vue";
import {retryPendingTrash} from '@/services/scheduled-trash';
import { useMailFeedback } from "@/store/mail-feedback";
import { useUserStore } from "@/store/user";
const feedback = useMailFeedback(), user = useUserStore();
let timer;
function pause() { clearTimeout(timer); }
function schedule() {
  pause();
  if (feedback.notice && !feedback.notice.busy && !feedback.notice.retry)
    timer = setTimeout(() => { feedback.dismiss(); }, 10000);
}
watch(() => [feedback.notice, feedback.notice?.busy], schedule, {immediate:true});
watch(() => user.user.email, () => { feedback.dismiss(); });
watch(()=>[user.user.email,user.authenticatedToken],retryPendingTrash,{immediate:true});
watch(()=>feedback.notice?.scheduledTrash,(current,previous)=>{if (previous && !current) retryPendingTrash();});
onMounted(()=>window.addEventListener('online',retryPendingTrash));
onBeforeUnmount(() => { window.removeEventListener('online',retryPendingTrash); pause(); feedback.dismiss(); });
</script>
<style scoped>
.mail-feedback { position:fixed; z-index:1500; bottom:24px; left:24px; max-width:calc(100vw - 48px); min-height:48px; padding:8px 12px 8px 20px; border-radius:6px; display:flex; align-items:center; gap:16px; background:#323232; color:#fff; box-shadow:0 2px 6px #0003; font-size:14px; }
button { color:#a8c7fa; padding:6px; font-weight:600; border-radius:4px; cursor:pointer; }
button:hover { background:#ffffff14; }
.dismiss { color:#e3e3e3; display:grid; place-items:center; }
.mail-feedback-enter-active,.mail-feedback-leave-active { transition:opacity .14s,transform .14s; }
.mail-feedback-enter-from,.mail-feedback-leave-to { opacity:0; transform:translateY(5px); }
@media(max-width:767px){.mail-feedback{bottom:16px;left:12px;max-width:calc(100vw - 24px)}}
@media(prefers-reduced-motion:reduce){.mail-feedback-enter-active,.mail-feedback-leave-active{transition:none}}
</style>
