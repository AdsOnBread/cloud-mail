<template>
  <button ref="trigger" type="button" class="mail-icon" data-search-options aria-label="Show search options"
    @pointerdown.left.prevent data-tip="Show search options" aria-haspopup="dialog" :aria-expanded="Boolean(opener)"
    @click="opener=opener ? null : trigger">
    <Icon icon="material-symbols:tune" width="22"/>
  </button>
  <Teleport to="body">
    <form v-if="opener" ref="panel" role="dialog" aria-label="Advanced search" :style="position" class="options-form"
      @submit.prevent="apply" @keydown.esc.stop.prevent="escape" @keydown.tab="tabOut" @focusout="focusOut" @focusin="focusIn">
      <div class="criteria">
        <div v-for="key in ['from','to']" :key="key" class="criterion">
          <label :for="id+'-'+key">{{ names[key] }}</label>
          <div class="people-terms"><input v-for="(_,i) in form[key]" :id="id+'-'+key+(i || '')" :key="i"
            v-model="form[key][i]" :aria-label="i ? names[key]+' '+(i+1) : names[key]" :maxlength="maxPersonTerm" type="text"/></div>
        </div>
        <label v-for="key in ['subject','q','excluded']" :key="key" class="criterion">{{ names[key] }}
          <input v-model="form[key]" :aria-label="names[key]" maxlength="200" type="text"/>
        </label>
        <div class="criterion">
          <label :for="id+'-size'">Size</label>
          <div class="size-fields">
            <select v-model="form.sizeOperator" aria-label="Size operator">
              <option value="larger">greater than</option><option value="smaller">less than</option>
            </select>
            <input :id="id+'-size'" ref="sizeInput" v-model="form.sizeValue" aria-label="Size value" type="text"
              inputmode="numeric" maxlength="20" autocomplete="off" :aria-invalid="Boolean(sizeError)" @input="sizeError=''"/>
            <select v-model="form.sizeUnit" aria-label="Size unit" @change="sizeError=''">
              <option v-for="(_,unit) in sizeUnits" :key="unit" :value="unit">{{ unit }}</option>
            </select>
          </div>
        </div>
        <span v-if="sizeError" role="alert" class="date-error">{{ sizeError }}</span>
        <div class="criterion">
          <label :for="id+'-within'">Date within</label>
          <div class="date-fields">
            <select :id="id+'-within'" v-model="form.time" aria-label="Date within">
              <option v-for="[key,text] in withinChoices" :key="key" :value="'center:'+key">{{ text }}</option>
              <optgroup label="Other date filters">
                <option value="">Any time</option>
                <option v-if="customRange" value="custom">{{ timeCaption(store.filters) }}</option>
                <option v-for="[key,text] in relativeChoices" :value="'relative:'+key" :key="key">{{ text }}</option>
              </optgroup>
            </select>
            <div v-if="form.time.startsWith('center:')" class="date-entry" ref="dateEntry">
              <input v-model="form.date" ref="dateInput" type="text" aria-label="Date" autocomplete="off" maxlength="32"
                :aria-invalid="Boolean(dateError)" aria-haspopup="grid" :aria-expanded="calendarOpen"
                @focus="showCalendar" @click="showCalendar" @input="typeDate" @keydown.down.prevent="enterCalendar"/>
              <Icon icon="material-symbols:calendar-today-outline" width="14" aria-hidden="true"/>
            </div>
          </div>
        </div>
        <span v-if="dateError" role="alert" class="date-error">{{ dateError }}</span>
        <label class="criterion">Search
          <select v-model="form.scope" aria-label="Search within">
            <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{folder.name}}</option>
            <optgroup v-if="labels.items.length" label="Labels">
              <option v-for="label in labels.items" :key="label.id" :value="'label:'+label.id">{{label.name}}</option>
            </optgroup>
          </select>
        </label>
        <div class="checks">
          <label><input v-model="form.hasAttachment" type="checkbox"/> Has attachment</label>
          <label v-if="supportsUnread"><input v-model="form.isUnread" type="checkbox"/> Is unread</label>
        </div>
      </div>
      <SearchCalendar v-if="calendarOpen" ref="calendar" v-model:cursor="cursor" :today="today" :selected="parsedDate" :style="calendarStyle" @pick="pickDate"/>
      <div class="option-actions">
        <button type="button" @click="clear">Clear</button>
        <button type="button" :disabled="!ruleCriteria" :title="form.scope!=='all' ? 'Choose All Mail to create an incoming filter.' : undefined" @click="createFilter">Create filter</button>
        <button type="submit">Search</button>
      </div>
    </form>
  </Teleport>
</template>

<script setup>
import {computed,inject,nextTick,onBeforeUnmount,ref,useId,watch} from 'vue';
import {Icon} from '@iconify/vue';
import {advancedSearchOpenerKey,useMailSearchStore} from '@/store/mail-search';
import {useMessageFilters} from '@/store/message-filters';
import {useMailLabels} from '@/store/mail-labels';
import {useUserStore} from '@/store/user';
import {useAccountStore} from '@/store/account';
import SearchCalendar from './mail-date-time/search-calendar.vue';
import {hasPerm} from '@/perm/perm';
import {categoryFolders} from '@/utils/inbox-categories';
import {systemFolders} from './mail-labels/system-folders';
import {positionMailboxPopup} from './mail-popup-position';
import {readSearchBar} from '../../../shared/mail-search-words';
import {sizeCriterion,sizeUnits} from '../../../shared/mail-search-size';
import {maxPersonTerm,peopleTerms,setPeopleTerms} from '../../../shared/mail-search-people';
import {centeredRange,olderChoices,parseRangeInput,rangeInput,recentChoices,timeCaption,withinChoices,withoutTime} from './mail-date-time/search-range';

const props=defineProps({queryText:String});
const emit=defineEmits(['applied']);
const opener=inject(advancedSearchOpenerKey), trigger=ref(), panel=ref(), position=ref({}), form=ref({});
const store=useMailSearchStore(), labels=useMailLabels(), id=useId();
const user=useUserStore(),account=useAccountStore();
const identity=computed(()=>[user.user.email,user.authenticatedToken,account.currentAccountId,Boolean(account.currentAccount.allReceive)]);
let stillCurrent=()=>false;
const dateInput=ref(),dateEntry=ref(),calendar=ref(),calendarOpen=ref(false),calendarStyle=ref({}),today=ref(new Date()),cursor=ref(new Date()),dateError=ref('');
const parsedDate=computed(()=>parseRangeInput(form.value.date || ''));
let returning=false;
const sizeInput=ref(), sizeError=ref('');
const names={from:'From',to:'To',subject:'Subject',q:'Has the words',excluded:"Doesn't have"};
const relativeChoices=[...recentChoices,...olderChoices];
const folders=computed(()=>[{id:'all',name:'All Mail'},{id:'email',name:'Inbox'},
  ...systemFolders.filter(item=>item.id!=='all' && (!item.permission || hasPerm(item.permission))),...categoryFolders]);
const scope=computed(()=>store.folder==='label' ? 'label:'+store.labelId : store.folder);
const supportsUnread=computed(()=>form.value.scope!=='draft');
const customRange=computed(()=>store.filters.dateAfter!=null || store.filters.dateBefore!=null);
const filtersEditor=useMessageFilters();
const ruleCriteria=computed(()=>{
  const f=form.value;
  if(f.scope!=='all' || !f.time || f.sizeValue || f.isUnread || f.time==='custom' || f.time.startsWith('relative:') || f.date ||
    f.from.filter(v=>v.trim()).length>1 || f.to.filter(v=>v.trim()).length>1)return null;
  const result={from:f.from.find(v=>v.trim()) || '',to:f.to.find(v=>v.trim()) || '',subject:f.subject,words:f.q,excluded:f.excluded,hasAttachment:f.hasAttachment};
  return Object.values(result).some(v=>typeof v==='string' ? v.trim() : v) ? result : null;
});
function createFilter(){
  if(!stillCurrent() || !ruleCriteria.value)return;
  const criteria={...ruleCriteria.value};dismiss();filtersEditor.open(criteria,null,'actions');
}
function reset() {
  const f=store.filters, preset=f.olderThan || f.days;
  const search=props.queryText == null ? {query:store.query,excluded:f.excluded} : readSearchBar(props.queryText);
  form.value={from:f.from ? peopleTerms(f,'from') : [''],to:f.to ? peopleTerms(f,'to') : [''],
    subject:f.subject || '',q:search.query,excluded:search.excluded || '',
    scope:scope.value,hasAttachment:Boolean(f.hasAttachment),isUnread:Boolean(f.isUnread),
    sizeValue:String(f.sizeValue ?? ''),sizeUnit:f.sizeUnit || 'MB',sizeOperator:f.sizeOperator || 'larger',
    date:f.dateCenter || '',
    time:f.dateWindow ? 'center:'+f.dateWindow : preset ? 'relative:'+preset : customRange.value ? 'custom' : 'center:1d'};
}
function place() {
  if (!opener.value || !panel.value) return;
  const search=trigger.value.closest('[role=search]');
  if (search) position.value=positionMailboxPopup(panel.value,search,722,search);
  if (calendarOpen.value) nextTick(placeCalendar);
}
function placeCalendar() {
  if (!calendar.value?.root || !dateInput.value || !panel.value) return;
  const popup=positionMailboxPopup(calendar.value.root,dateInput.value,258);
  const submit=panel.value.querySelector('button[type=submit]').getBoundingClientRect();
  const x=parseFloat(popup.left),y=parseFloat(popup.top),w=parseFloat(popup.width),h=Math.min(calendar.value.root.scrollHeight,parseFloat(popup.maxHeight));
  if (x+w>submit.left && x<submit.right && y+h>submit.top && y<submit.bottom) {
    const left=submit.left-w-8;
    if (left>=(window.visualViewport?.offsetLeft || 0)+8) popup.left=left+'px';
    else { calendarStyle.value=positionMailboxPopup(calendar.value.root,dateInput.value,258,panel.value);return; }
  }
  calendarStyle.value=popup;
}
function showCalendar() {
  if (returning || calendarOpen.value) return;
  today.value=new Date();cursor.value=parsedDate.value || today.value;calendarOpen.value=true;
  nextTick(placeCalendar);
}
function typeDate() {
  dateError.value='';
  if (parsedDate.value) cursor.value=parsedDate.value;
}
function enterCalendar() { showCalendar();nextTick(()=>calendar.value?.focusDay()); }
function closeCalendar(focus=false) {
  calendarOpen.value=false;
  if (focus) {
    returning=true;dateInput.value?.focus({preventScroll:true});returning=false;
  }
}
function pickDate(date) { form.value.date=rangeInput(date);dateError.value='';closeCalendar(true); }
function escape() { if (calendarOpen.value) closeCalendar(true);else dismiss(); }
function focusIn(event) {
  if (!dateEntry.value?.contains(event.target) && !calendar.value?.root?.contains(event.target)) closeCalendar();
}
function dismiss() {
  const origin=opener.value;
  opener.value=null;
  (origin?.isConnected ? origin : trigger.value)?.focus({preventScroll:true});
}
function apply() {
  if (!stillCurrent()) {dismiss();return;}
  const origin=opener.value;
  const f=form.value, next=f.time==='custom' ? {...store.filters} : withoutTime(store.filters);
  const sizeValue=f.sizeValue.trim();
  if (sizeValue) {
    if (!sizeCriterion({...f,sizeValue})) {
      sizeError.value='Enter a whole number within the supported range.';
      sizeInput.value?.focus();return;
    }
    Object.assign(next,{sizeOperator:f.sizeOperator,sizeUnit:f.sizeUnit,sizeValue});
  } else {
    delete next.sizeOperator;delete next.sizeUnit;delete next.sizeValue;
  }
  if (f.time.startsWith('center:') && f.date) {
    const bounds=centeredRange(parseRangeInput(f.date),f.time.slice(7));
    if (!bounds) {dateError.value='Enter a valid date, such as 2026/11/21.';dateInput.value?.focus();return;}
    Object.assign(next,bounds);
  } else if (f.time.startsWith('relative:')) {
    const key=f.time.slice(9);
    next[olderChoices.some(([id])=>id===key) ? 'olderThan' : 'days']=key;
  }
  setPeopleTerms(next,'from',f.from);setPeopleTerms(next,'to',f.to);
  if (f.subject.trim()) next.subject=f.subject.trim(); else delete next.subject;
  if (f.excluded.trim()) next.excluded=f.excluded.trim(); else delete next.excluded;
  if (f.hasAttachment) next.hasAttachment=1; else delete next.hasAttachment;
  if (supportsUnread.value && f.isUnread) next.isUnread=1; else delete next.isUnread;
  dismiss();
  emit('applied',{scope:f.scope,query:f.q.trim(),filters:next,stillCurrent,origin});
}
function clear() {
  const origin=opener.value;dismiss();emit('applied',{scope:scope.value,query:'',filters:{},stillCurrent,origin});
}
function tabOut(event) {
  const controls=panel.value.querySelectorAll('input,select,button');
  if (event.shiftKey ? event.target===controls[0] : event.target===controls[controls.length-1]) dismiss();
}
function focusOut(event) {
  if (event.relatedTarget && !panel.value?.contains(event.relatedTarget) && !event.relatedTarget.closest?.('[data-search-options]')) opener.value=null;
}
function outside(event) {
  if (!panel.value?.contains(event.target) && !event.target.closest?.('[data-search-options]')) opener.value=null;
}
function listen(visible) {
  const method=visible ? 'addEventListener' : 'removeEventListener';
  document[method]('pointerdown',outside,true);
  window[method]('resize',place);window[method]('scroll',place,true);
  window.visualViewport?.[method]('resize',place);window.visualViewport?.[method]('scroll',place);
}
watch(()=>filtersEditor.senderRequest,async request=>{
  if(!request)return;
  const identityAtOpen=identity.value;
  opener.value=trigger.value;
  await nextTick();
  if (request!==filtersEditor.senderRequest || identityAtOpen!==identity.value || !stillCurrent())return;
  filtersEditor.senderRequest=null;
  form.value={from:[request.sender],to:[''],q:'',excluded:'',subject:'',scope:'all',hasAttachment:false,isUnread:false,
    sizeValue:'',sizeUnit:'MB',sizeOperator:'larger',time:'center:1d',date:''};
  panel.value?.querySelector('input')?.focus({preventScroll:true});place();
});
watch(opener,origin=>{
  listen(Boolean(origin));
  closeCalendar();dateError.value='';sizeError.value='';
  if (!origin) return;
  const session=identity.value, token=localStorage.getItem('token');
  stillCurrent=()=>identity.value===session && token===localStorage.getItem('token');
  reset();
  nextTick(()=>{panel.value?.querySelector('input')?.focus({preventScroll:true});place()});
});
watch([scope,identity],()=>{opener.value=null},{flush:'sync'});
watch(()=>form.value.time,()=>{closeCalendar();dateError.value=''});
onBeforeUnmount(()=>{listen(false);opener.value=null});
</script>

<style scoped>
.options-form {position:fixed;z-index:2400;box-sizing:border-box;container-type:inline-size;display:flex;flex-direction:column;width:722px;max-width:calc(100vw - 16px);
  padding:24px;border:1px solid var(--light-border-color);background:var(--mail-surface);color:var(--el-text-color-primary);
  box-shadow:0 2px 6px #0003;font:14px/20px Arial,sans-serif;}
.criteria {display:grid;gap:20px;overflow-y:auto;overscroll-behavior:contain;min-height:0;}
.criterion {display:grid;grid-template-columns:96px minmax(0,1fr);column-gap:24px;align-items:start;color:var(--regular-text-color);}
.options-form :is(input[type=text],input[type=date],select) {box-sizing:border-box;width:100%;height:20px;min-width:0;border:0;
  border-bottom:1px solid var(--light-border-color);border-radius:0;background:var(--mail-surface);color:var(--el-text-color-primary);font:inherit;padding:0;}
.options-form :is(input[type=text],input[type=date],select):focus {outline:0;box-shadow:inset 0 -2px var(--el-color-primary);}
.people-terms {display:grid;gap:4px;}
.size-fields {display:grid;grid-template-columns:minmax(0,252fr) minmax(0,138fr) minmax(0,114fr);gap:24px;}
.date-fields {display:grid;grid-template-columns:1fr 1.1fr;gap:24px;min-width:0;}
.date-entry {position:relative;min-width:0;}
.date-entry input {padding-right:22px !important;}
.date-entry svg {position:absolute;top:3px;right:2px;pointer-events:none;}
.date-error {color:var(--el-color-danger);padding-left:120px;}
.checks {display:flex;align-items:center;flex-wrap:wrap;gap:8px 24px;}
.checks label {display:flex;align-items:center;gap:8px;}
.checks input {width:16px;height:16px;margin:0;accent-color:var(--el-color-primary);}
.option-actions {display:flex;align-items:center;justify-content:flex-end;gap:12px;padding-top:18px;flex-shrink:0;}
.option-actions button {cursor:pointer;height:36px;border-radius:18px;padding:0 18px;color:var(--el-color-primary);font-weight:500;}
.option-actions button:disabled {opacity:.45;cursor:default;}
.option-actions button[type=submit] {background:var(--el-color-primary);color:var(--mail-surface);}
@media(max-width:620px) {.options-form{padding:16px;}.criterion{grid-template-columns:minmax(60px,22%) minmax(0,1fr);gap:10px;}.date-fields,.size-fields{gap:8px;}}
@container (max-width:300px) {
  .criterion {grid-template-columns:minmax(0,1fr);gap:4px;}
  .size-fields {grid-template-columns:minmax(0,1fr) minmax(52px,.65fr);gap:8px;}
  .size-fields select:first-child {grid-column:1/-1;}
  .date-fields {grid-template-columns:minmax(0,1fr);}
  .date-error {padding-left:0;}
  .option-actions {flex-wrap:wrap;gap:4px;}
}
</style>
