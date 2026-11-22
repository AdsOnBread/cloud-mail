<template>
  <button v-if="advanced" ref="snoozeButton" type="button" class="mail-icon" data-tip="Snooze" aria-label="Snooze conversations"
    aria-haspopup="menu" :aria-expanded="!!snoozeAnchor && snoozeAnchor===snoozeButton" :disabled="disabled" @click="emit('snooze',$event.currentTarget)">
    <Icon icon="material-symbols:schedule-outline" width="20"/>
  </button>
  <slot/>
  <LabelPicker v-if="advanced" :rows="rows" :disabled="disabled" @apply="(...args)=>emit('apply',...args)"/>
  <el-popover :visible="open" :width="284" :persistent="false" placement="bottom-start" :offset="0"
    :show-arrow="false" popper-class="conversation-more-menu" @after-enter="focusFirst">
    <template #reference>
      <button ref="trigger" type="button" class="mail-icon" :aria-label="label" data-tip="More" aria-haspopup="menu"
        :aria-expanded="open" :disabled="disabled" @click="open=!open" @keydown.down.prevent="open=true"
        @keydown.esc="escapeTrigger"><Icon icon="material-symbols:more-vert" width="20"/></button>
    </template>
    <div ref="panel" role="menu" aria-label="More email options" @keydown="navigate">
      <template v-if="!advanced">
        <button role="menuitem" tabindex="-1" @pointerenter="sub=false" @click="command('snooze',trigger)"><Icon icon="material-symbols:schedule-outline"/>Snooze</button>
        <button ref="labelItem" role="menuitem" tabindex="-1" aria-haspopup="menu" :aria-expanded="sub"
          @pointerenter="$event.pointerType==='mouse' && showLabels()" @click="showLabels" @keydown.right.stop.prevent="showLabels">
          <Icon icon="material-symbols:label-outline"/>Label as<Icon class="arrow" icon="material-symbols:arrow-right"/>
        </button>
        <div role="separator"></div>
      </template>
      <button v-if="canAttach" role="menuitem" tabindex="-1" :disabled="forwarding" @pointerenter="sub=false"
        @click="command('attach')"><Icon icon="material-symbols:forward-to-inbox-outline"/>Forward as attachment</button>
      <button v-if="sender" role="menuitem" tabindex="-1" @pointerenter="sub=false" @click="filterSender">
        <Icon icon="material-symbols:filter-alt-outline"/>Filter messages like these</button>
      <button v-if="rows.some(row=>!row.importanceReason)" role="menuitem" tabindex="-1" @pointerenter="sub=false"
        @click="command('importance',true)"><Icon icon="material-symbols:label-important-outline"/>Mark as important</button>
      <button v-if="rows.some(row=>row.importanceReason)" role="menuitem" tabindex="-1" @pointerenter="sub=false"
        @click="command('importance',false)"><Icon icon="material-symbols:label-important"/>Mark as not important</button>
      <button v-if="newer" class="compact-page-action" role="menuitem" tabindex="-1" @pointerenter="sub=false"
        @click="command('newer')"><Icon icon="material-symbols:chevron-left"/>Newer</button>
      <button v-if="older" class="compact-page-action" role="menuitem" tabindex="-1" @pointerenter="sub=false"
        @click="command('older')"><Icon icon="material-symbols:chevron-right"/>Older</button>
      <div role="separator"></div>
      <button role="menuitem" tabindex="-1" :disabled="saving" @pointerenter="sub=false" @click="switchMode">
        <Icon icon="material-symbols:tune"/>Switch to {{ advanced ? 'simple' : 'advanced' }} toolbar</button>
      <LabelPicker v-if="sub" ref="picker" external submenu :reference="labelItem" :rows="rows" :return-focus="focusTrigger"
        @back="sub=false" @finish="close(true)" @apply="(...args)=>emit('apply',...args)"/>
    </div>
  </el-popover>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,onDeactivated,ref,watch} from 'vue';
import {useRoute} from 'vue-router';
import {Icon} from '@iconify/vue';
import http from '@/axios';
import {useUserStore} from '@/store/user';
import {useMailFeedback} from '@/store/mail-feedback';
import {useMessageFilters} from '@/store/message-filters';
import LabelPicker from '@/components/mail-labels/picker.vue';

const props=defineProps({rows:{type:Array,required:true},label:{type:String,default:'More email options'},
  scope:String,snoozeAnchor:Object,disabled:Boolean,canAttach:Boolean,forwarding:Boolean,newer:Boolean,older:Boolean});
const emit=defineEmits(['snooze','importance','attach','apply','newer','older']);
const user=useUserStore(),feedback=useMailFeedback(),filters=useMessageFilters(),route=useRoute();
const advanced=computed(()=>user.user.generalSettings?.advancedToolbar===true);
const sender=computed(()=>props.rows.length===1 && props.rows[0].lastSenderEmail);
const snoozeButton=ref(),trigger=ref(),panel=ref(),labelItem=ref(),picker=ref(),open=ref(false),sub=ref(false),saving=ref(false);
const sessionCurrent=()=>user.authenticatedToken && user.authenticatedToken===localStorage.getItem('token');
function focusTrigger(){trigger.value?.focus({preventScroll:true});}
function escapeTrigger(event){
  if(!open.value)return;
  close(true);
  event.stopPropagation();event.preventDefault();
}
function close(restore=false){sub.value=false;open.value=false;if(restore)focusTrigger();}
let openingFocus;
function focusFirst(){
  if(open.value && !sub.value && (document.activeElement===trigger.value || document.activeElement===document.body || document.activeElement===openingFocus))
    panel.value?.querySelector('button:not(:disabled)')?.focus();
}
async function showLabels(){
  if(!open.value || props.disabled || !sessionCurrent())return;
  sub.value=true;
  await nextTick();
  picker.value?.show();
}
function command(name,value){
  if(!open.value || props.disabled || !sessionCurrent())return close();
  close(true);emit(name,value);
}
function filterSender(){
  if(!open.value || !sender.value || !sessionCurrent())return close();
  close(true);filters.fromMessage(sender.value);
}
async function switchMode(){
  if(!open.value || saving.value || !sessionCurrent())return;
  const token=user.authenticatedToken, owner=user.user.userId, value=!advanced.value;
  const current=()=>sessionCurrent() && user.authenticatedToken===token && user.user.userId===owner;
  close(true);saving.value=true;
  try {
    const config={headers:{Authorization:token},noMsg:true};
    const saved=await http.get('/v1/general-settings',config);
    if(!current())return;
    const next=Boolean(saved.advancedToolbar)===value ? saved : await http.put('/v1/general-settings',{
      version:saved.version,undoSeconds:saved.undoSeconds ?? user.undoSeconds,replyAll:saved.replyAll,advancedToolbar:value,
    },config);
    if(current() && (user.user.generalSettings?.version ?? 0)<=next.version) user.user.generalSettings=next;
  } catch(error){if(current())feedback.show(error.message || 'Could not save toolbar preference.');}
  finally{saving.value=false;}
}
function navigate(event){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
  if(event.key==='Tab'){close(true);return;}
  if(!['Home','End','ArrowDown','ArrowUp'].includes(event.key))return;
  const items=[...panel.value.querySelectorAll(':scope > button:not(:disabled)')].filter(el=>el.getClientRects().length);
  if(!items.length)return;
  event.preventDefault();sub.value=false;
  const i=items.indexOf(document.activeElement), step=event.key==='ArrowUp'?-1:1;
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:(i+step+items.length)%items.length;
  items[next].focus();
}
function outside(event){
  if(!trigger.value?.contains(event.target) && !panel.value?.contains(event.target) &&
    !(sub.value && event.target.closest?.('.filing-submenu')))close();
}
watch(open,(visible,_,onCleanup)=>{
  if(!visible){sub.value=false;return;}
  openingFocus=document.activeElement;
  for(const event of ['pointerdown','focusin'])document.addEventListener(event,outside,true);
  onCleanup(()=>{for(const event of ['pointerdown','focusin'])document.removeEventListener(event,outside,true);});
});
watch([()=>props.disabled,()=>props.scope,()=>route.fullPath,()=>user.authenticatedToken,
  ()=>props.rows.map(row=>row.lastEmailId).join(',')],()=>close(),{flush:'sync'});
onDeactivated(()=>close());
onBeforeUnmount(()=>close());
</script>
<style>
.conversation-more-menu.el-popover.el-popper.is-light {max-width:calc(100vw - 16px);padding:6px 0;border:0;border-radius:4px;background:#fff;color:#202124;box-shadow:0 8px 10px 1px #00000024,0 3px 14px 2px #0000001f,0 5px 5px -3px #00000033}
.conversation-more-menu [role=menu] {max-height:calc(100dvh - 24px);overflow:auto}
.conversation-more-menu [role=menuitem] {position:relative;display:flex;align-items:center;width:100%;height:32px;padding:6px 40px 6px 48px;text-align:start;font:14px/20px Arial,sans-serif;color:inherit;cursor:pointer}
.conversation-more-menu [role=menuitem] svg {position:absolute;left:16px;width:18px;height:18px;color:var(--regular-text-color)}
.conversation-more-menu [role=menuitem] .arrow {left:auto;right:12px}
.conversation-more-menu [role=separator] {margin:6px 0;border-top:1px solid var(--light-border-color)}
.conversation-more-menu [role=menuitem]:is(:focus-visible,:hover,[aria-expanded=true]) {background:#eee}
.conversation-more-menu [role=menuitem]:disabled {opacity:.4;cursor:default}
.conversation-more-menu .compact-page-action {display:none}
html.dark .conversation-more-menu.el-popover.el-popper.is-light {background:var(--mail-surface);color:var(--el-text-color-primary)}
html.dark .conversation-more-menu [role=menuitem]:is(:focus-visible,:hover,[aria-expanded=true]) {background:var(--mail-hover)}
@media(max-width:480px){.conversation-more-menu .compact-page-action {display:flex}}
@media(forced-colors:active){.conversation-more-menu.el-popper {outline:1px solid CanvasText}.conversation-more-menu [role=menuitem]:focus-visible {outline:2px solid Highlight;outline-offset:-2px}}
</style>
