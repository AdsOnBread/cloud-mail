<template>
    <el-dropdown
      v-if="snoozeAnchor"
      ref="snoozeMenu"
      virtual-triggering
      :virtual-ref="snoozeAnchor"
      :trigger="[]"
      placement="bottom-end"
      :show-arrow="false"
      popper-class="mail-action-menu snooze-menu"
      @visible-change="!$event && (snoozeAnchor = null)"
      @command="snoozeCommand"
    >
      <template #dropdown>
        <el-dropdown-menu>
          <div class="snooze-heading">Snooze until…</div>
          <el-dropdown-item
            v-for="option in snoozeOptions"
            :key="option.label"
            :command="option.date"
          >
            <span>{{ option.label }}</span><small>{{ option.detail }}</small>
          </el-dropdown-item>
          <el-dropdown-item divided command="custom"
            >Pick date &amp; time</el-dropdown-item
          >
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <el-dialog v-model="snoozeOpen" title="Pick date &amp; time" class="mail-dialog snooze-date-dialog" width="492px" append-to-body align-center destroy-on-close @opened="focusSnoozeCalendar" @closed="restoreSnoozeFocus">
      <MailDateTime v-if="snoozeOpen" ref="snoozePicker" :initial="initial" action="Save" @choose="applySnooze" @cancel="snoozeOpen=false"/>
    </el-dialog>
</template>
<script setup>
import {nextTick,ref,shallowRef,watch} from 'vue';
import MailDateTime from '@/components/mail-date-time/index.vue';
const emit=defineEmits(['choose']);
const snoozeAnchor=shallowRef(),snoozeMenu=ref(),snoozePicker=ref(),snoozeOpen=ref(false);
const snoozeOptions=ref([]),initial=ref();
let targets=[],opener;
function close(){snoozeAnchor.value=null;snoozeOpen.value=false;targets=[];}
watch(snoozeAnchor,(anchor,_,onCleanup)=>{
  if(!anchor)return;
  // A virtual dropdown may briefly move focus to the page while opening.
  const dismiss=event=>{
    if(event.key!=='Escape' || snoozeOpen.value)return;
    event.preventDefault();
    event.stopPropagation();
    close();
    restoreSnoozeFocus();
  };
  document.addEventListener('keydown',dismiss,true);
  onCleanup(()=>document.removeEventListener('keydown',dismiss,true));
},{flush:'sync'});
async function show(element,selection,wakeAt=0) {
  if(snoozeAnchor.value===element){close();return;}
  opener=element;
  targets=selection.slice();
  const now=new Date();
  const at=(days,hour)=>{const d=new Date(now);d.setDate(d.getDate()+days);d.setHours(hour,0,0,0);return d;};
  const tomorrow=at(1,8),weekday=now.getDay(),options=[];
  function choice(label,date) {
    if(date<=now || options.some(item=>+item.date===+date))return;
    options.push({label,date,detail:date.toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})});
  }
  choice('Later today',at(0,18));
  choice('Tomorrow',tomorrow);
  if(weekday>=1 && weekday<=2)choice('Later this week',at(4-weekday,8));
  if(weekday>=1 && weekday<=5)choice('This weekend',at(6-weekday,8));
  choice('Next week',at((8-weekday)%7 || 7,8));
  if(weekday===0 || weekday===6)choice('Next weekend',at((6-weekday+7)%7 || 7,8));
  snoozeOptions.value=options;
  initial.value=wakeAt*1000>now.getTime() ? new Date(wakeAt*1000) : tomorrow;
  snoozeAnchor.value=element;
  await nextTick();
  snoozeMenu.value?.handleOpen();
}
function focusSnoozeCalendar(){
  if(document.activeElement?.matches('.snooze-date-dialog'))snoozePicker.value?.focus();
}
async function restoreSnoozeFocus(){
  await new Promise(requestAnimationFrame);
  if(snoozeOpen.value || !opener?.isConnected)return;
  const current=document.activeElement;
  if(current!==document.body && current?.getClientRects().length && !current.closest('.snooze-date-dialog,.snooze-menu'))return;
  (opener.getClientRects().length ? opener : opener.closest('.conversation-row')?.querySelector('.conversation-open'))?.focus();
}
function snoozeCommand(value){
  if(value==='custom')snoozeOpen.value=true;
  else applySnooze(value);
}
function applySnooze(date){
  if(!(date>new Date()) || !targets.length)return;
  snoozeOpen.value=false;
  emit('choose',Math.floor(date.getTime()/1000),targets);
}
defineExpose({show,close,anchor:snoozeAnchor});
</script>
