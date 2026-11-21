<template>
  <section class="scheduled-view" aria-label="Scheduled messages">
    <div v-if="!messageId" class="filter-row" aria-label="Filter Scheduled">
      <SearchOptions chips field="from"/><SearchOptions chips field="days"/>
      <button class="filter-chip" :aria-pressed="Boolean(search.filters.hasAttachment)" @click="toggleFiles">Has attachment</button>
      <SearchOptions chips field="to"/><SearchOptions chips/>
    </div>
    <div class="mail-toolbar">
      <button v-if="messageId" class="mail-icon" data-tip="Back to Scheduled" aria-label="Back to Scheduled" @click="back"><Icon icon="material-symbols:arrow-back" width="20"/></button>
      <template v-else>
        <label class="check-target" data-tip="Select">
          <input type="checkbox" aria-label="Select scheduled messages" :checked="page.length>0 && selected.length===page.length"
            :indeterminate="selected.length>0 && selected.length<page.length" :disabled="busy || !page.length" @change="select($event.target.checked)"/>
        </label>
        <el-dropdown trigger="click" placement="bottom-start" :show-arrow="false" popper-class="mail-action-menu" @command="select">
          <button class="mail-icon select-options" aria-label="Selection options" data-tip="Select"><Icon icon="material-symbols:arrow-drop-down" width="16"/></button>
          <template #dropdown><el-dropdown-menu><el-dropdown-item :command="true">All</el-dropdown-item><el-dropdown-item :command="false">None</el-dropdown-item></el-dropdown-menu></template>
        </el-dropdown>
        <button v-if="selected.length" class="cancel-action" :disabled="busy || targets.some(row=>!canCancel(row))" @click="cancel(targets)">Cancel send</button>
        <template v-else>
          <button class="mail-icon" aria-label="Refresh scheduled mail" data-tip="Refresh" :disabled="loading" @click="load"><Icon icon="material-symbols:refresh" width="20"/></button>
          <el-dropdown trigger="click" placement="bottom-start" :show-arrow="false" popper-class="mail-action-menu">
            <button class="mail-icon" aria-label="More email options" data-tip="More"><Icon icon="material-symbols:more-vert" width="20"/></button>
            <template #dropdown><el-dropdown-menu>
              <el-dropdown-item @click="latestFirst=!latestFirst">{{ latestFirst?'Show earliest scheduled first':'Show latest scheduled first' }}</el-dropdown-item>
            </el-dropdown-menu></template>
          </el-dropdown>
        </template>
      </template>
      <span class="total">{{ range }}</span>
      <button class="mail-icon" aria-label="Previous" data-tip="Previous" :disabled="busy || (messageId?position<=0:offset===0)" @click="step(-1)"><Icon icon="material-symbols:chevron-left" width="20"/></button>
      <button class="mail-icon" aria-label="Next" data-tip="Next" :disabled="busy || (messageId?position<0 || position>=ordered.length-1:offset+50>=ordered.length)" @click="step(1)"><Icon icon="material-symbols:chevron-right" width="20"/></button>
    </div>
    <p v-if="listError || error" class="list-status" role="alert">{{ listError || error }} <button v-if="listError || detailError" @click="retry">Retry</button></p>
    <div v-if="messageId" class="scroll">
      <ScheduledMessage v-if="item" :key="item.draftId" :row="item" :detail="detail" :status="status(item)" :short-recipients="who(item)"
        :can-cancel="canCancel(item)" :busy="busy" @cancel="cancel([item])" @error="error=$event"/>
      <p v-else-if="!listError" class="empty" role="status">{{ loading?'Loading…':'This message is no longer in Scheduled.' }}</p>
    </div>
    <div v-else ref="scroll" class="scroll">
      <p class="notice">Messages in Scheduled will be sent at their scheduled time.</p>
      <MailRow v-for="row in page" :key="row.draftId" :data-scheduled-id="row.draftId" hide-star :participants="'To: '+who(row)" :subject="row.subject" :preview="row.preview"
        :date="row.state==='scheduled'?mailboxDate(row.sendAt*1000):status(row)" :date-title="status(row)" :selected="selected.includes(row.draftId)"
        :attachments="row.attachments" :attachment-count="row.attachmentCount" :open-label="'Open scheduled message: '+(row.subject||'(no subject)')"
        @select="toggle(row.draftId)" @open="open(row)">
        <template v-if="canCancel(row)" #actions>
          <button class="mail-icon" :aria-label="'Cancel send for '+row.subject" data-tip="Cancel send" :disabled="busy" @click="cancel([row])"><Icon icon="material-symbols:undo" width="20"/></button>
        </template>
      </MailRow>
      <p v-if="!page.length && !listError" class="empty" role="status">{{ loading?'Loading…':filtered?'No messages match your search.':'No scheduled messages.' }}</p>
    </div>
  </section>
</template>
<script setup>
import {ref,computed,watch,nextTick,onMounted,onBeforeUnmount} from 'vue';
import {Icon} from '@iconify/vue';
import {useRouter,useRoute} from 'vue-router';
import http from '@/axios';
import db from '@/db/db';
import {useAccountStore} from '@/store/account';
import {useUserStore} from '@/store/user';
import {userDraftStore} from '@/store/draft';
import {useMailFeedback} from '@/store/mail-feedback';
import {useMailSearchStore} from '@/store/mail-search';
import {syncCloudDrafts} from '@/services/cloud-drafts';
import {openSavedDraft} from '@/services/draft-list';
import {mailboxDate,formatDetailDate} from '@/utils/day';
import MailRow from '@/components/mail-row/index.vue';
import SearchOptions from '@/components/mail-search-options.vue';
import ScheduledMessage from './message.vue';

const router=useRouter(),route=useRoute(),account=useAccountStore(),user=useUserStore(),drafts=userDraftStore(),feedback=useMailFeedback(),search=useMailSearchStore();
const scope=computed(()=>account.currentAccount.allReceive?undefined:account.currentAccountId);
const identity=computed(()=>JSON.stringify([user.user.email,scope.value]));
const messageId=computed(()=>Number(route.query.message)||0);
const rows=ref([]),selected=ref([]),detail=ref(null),offset=ref(0),latestFirst=ref(false),scroll=ref();
const loading=ref(true),busy=ref(false),listError=ref(''),detailError=ref(false),error=ref('');
const ordered=computed(()=>latestFirst.value?[...rows.value].reverse():rows.value);
const page=computed(()=>ordered.value.slice(offset.value,offset.value+50));
const position=computed(()=>ordered.value.findIndex(row=>row.draftId===messageId.value));
const item=computed(()=>ordered.value[position.value]);
const targets=computed(()=>page.value.filter(row=>selected.value.includes(row.draftId)));
const filtered=computed(()=>Boolean(search.query || Object.keys(search.filters).length));
const range=computed(()=>{
  if(messageId.value)return position.value<0?'':(position.value+1)+' of '+ordered.value.length;
  return page.value.length?(offset.value+1)+'–'+(offset.value+page.value.length)+' of '+ordered.value.length:'';
});
const canCancel=row=>['scheduled','schedule_failed'].includes(row.state);
function status(row){
  if(row.state==='scheduled')return 'Send scheduled for '+formatDetailDate(row.sendAt*1000);
  if(row.state==='schedule_failed')return 'Could not send';
  return row.state==='uncertain'?'Delivery uncertain — check Sent':'Sending…';
}
function who(row){
  const recipients=row.recipients?.length?row.recipients:[...(row.cc||[]),...(row.bcc||[])];
  return recipients.map(address=>account.ownAddresses.some(own=>own.toLowerCase()===address.toLowerCase())?'me':address.split('@')[0]).join(', ');
}
let generation=0,detailRequest=0,disposed=false;
async function load(){
  const request=++generation;
  const identityAtStart=identity.value;
  if(!user.user.email || !account.currentAccountId)return;
  loading.value=true;listError.value='';
  try{
    const data=await http.get('/v1/scheduled',{params:{accountId:scope.value,q:search.query,...search.filters},noMsg:true});
    if(disposed || request!==generation || identityAtStart!==identity.value)return;
    rows.value=data;
    offset.value=Math.min(offset.value,Math.floor(Math.max(0,data.length-1)/50)*50);
    selected.value=selected.value.filter(id=>page.value.some(row=>row.draftId===id));
  }catch(e){if(request===generation)listError.value=e.message || 'Could not load Scheduled.';}
  finally{if(request===generation)loading.value=false;}
}
async function loadDetail(){
  const request=++detailRequest;
  detail.value=null;error.value='';detailError.value=false;
  if(!item.value)return;
  try{
    const data=await http.get('/v1/scheduled/'+messageId.value,{noMsg:true});
    if(request===detailRequest && data.draftId===messageId.value && (scope.value==null || data.accountId===scope.value))detail.value=data;
  }catch(e){if(request===detailRequest){detailError.value=true;error.value=e.message || 'Could not open the scheduled message.';}}
}
function retry(){if(listError.value)load();else loadDetail();}
function open(row,replace=false){
  const location={name:'scheduled',query:{message:row.draftId}};
  return replace?router.replace(location):router.push(location);
}
function back(){
  if(window.history.state?.back==='/scheduled')router.back();
  else router.replace({name:'scheduled'});
}
function step(direction){
  if(item.value)return open(ordered.value[position.value+direction],true);
  offset.value+=50*direction;selected.value=[];scroll.value?.scrollTo(0,0);
}
function select(all){if(!busy.value)selected.value=all?page.value.map(row=>row.draftId):[];}
function toggle(id){if(!busy.value)selected.value=selected.value.includes(id)?selected.value.filter(key=>key!==id):[...selected.value,id];}
function toggleFiles(){const filters={...search.filters};if(filters.hasAttachment)delete filters.hasAttachment;else filters.hasAttachment=1;search.filters=filters;}
async function cancel(batch){
  if(busy.value || !batch.length || batch.some(row=>!canCancel(row)))return;
  const database=db.value,owner=identity.value;
  const session=localStorage.getItem('token'),sameMailbox=()=>!disposed && db.value===database && identity.value===owner && localStorage.getItem('token')===session;
  busy.value=true;error.value='';
  const canceled=[];
  try{
    for(const row of batch){
      if(!sameMailbox())break;
      await http.post('/v1/scheduled/'+row.draftId+'/cancel',{version:row.version},{noMsg:true});
      canceled.push(row.draftId);
    }
  }catch(e){if(sameMailbox())error.value=e.message || 'Could not cancel scheduled delivery.';}
  try{
    if(!sameMailbox())return;
    if(canceled.length){
      const notice=canceled.length===1?'Message returned to Drafts.':canceled.length+' messages returned to Drafts.';
      feedback.show(notice);
      if(canceled.includes(messageId.value))await router.replace({name:'scheduled'});
      drafts.scheduledRevision++;
      await syncCloudDrafts();
      if(batch.length===1 && sameMailbox()){
        const draft=await database.draft.where('cloudDraftId').equals(canceled[0]).first();
        if(draft && sameMailbox())await openSavedDraft(draft.draftId,router,'draft');
      }
    }else await load();
  }catch(e){if(sameMailbox())error.value=e.message || 'Could not reopen this draft.';}
  finally{busy.value=false;}
}
watch([()=>user.user.email,scope,()=>account.currentAccountId],(_,old)=>{
  rows.value=[];selected.value=[];offset.value=0;detail.value=null;error.value='';
  if(old?.[0] && old[2] && messageId.value)router.replace({name:'scheduled'});
  load();
},{immediate:true,flush:'sync'});
watch([()=>search.query,()=>search.filters],()=>{offset.value=0;selected.value=[];load();});
watch(()=>drafts.scheduledRevision,load);
watch(latestFirst,()=>{offset.value=0;selected.value=[];scroll.value?.scrollTo(0,0);});
watch([messageId,()=>item.value?.draftId,()=>item.value?.version],()=>{
  if(position.value>=0)offset.value=Math.floor(position.value/50)*50;
  loadDetail();
},{immediate:true});
watch(messageId,(id,old)=>{if(!id && old)nextTick(()=>scroll.value?.querySelector('[data-scheduled-id="'+old+'"] .conversation-open')?.focus());});
function keydown(event){if(event.key==='Escape' && !event.defaultPrevented && !event.target.closest('input,textarea,[contenteditable],dialog,.el-popper,.send') && item.value && ![...document.querySelectorAll('.el-popper,.el-dialog,.send,dialog[open]')].some(el=>el.getClientRects().length))back();}
const timer=setInterval(()=>{if(!document.hidden && !busy.value)load();},30000);
onMounted(()=>window.addEventListener('keydown',keydown));
onBeforeUnmount(()=>{disposed=true;generation++;detailRequest++;clearInterval(timer);window.removeEventListener('keydown',keydown);});
</script>
<style scoped>
.scheduled-view {display:flex;flex-direction:column;height:100%;min-height:0;color:var(--el-text-color-primary)}
.scroll {min-height:0;flex:1;overflow:auto}
.select-options {width:18px;height:28px;border-radius:4px;margin-left:-8px;margin-right:8px}
.notice,.empty,.list-status {text-align:center;padding:14px 16px;margin:0;font:14px/20px Arial,sans-serif;color:var(--regular-text-color)}
.notice {box-shadow:inset 0 -1px var(--light-border-color)}
.cancel-action {padding:8px 12px;border-radius:20px;color:var(--regular-text-color);font-size:14px;cursor:pointer}
.cancel-action:hover {background:var(--mail-hover)}
.cancel-action:disabled {opacity:.5;cursor:default}
.list-status button {color:var(--el-color-primary);cursor:pointer}
</style>
