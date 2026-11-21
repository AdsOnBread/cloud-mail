<template>
  <button ref="trigger" type="button" class="filter-chip date-chip" :aria-label="applied ? 'Any time, '+caption : caption"
    :aria-pressed="applied" :aria-expanded="open" aria-haspopup="menu" :aria-controls="open ? id : undefined"
    @click="open ? close() : show()" @keydown.down.prevent="show">
    <Icon v-if="applied" icon="material-symbols:check" width="16"/><span>{{ caption }}</span>
    <Icon icon="material-symbols:arrow-drop-down" width="16"/>
  </button>
  <Teleport to="body">
    <div v-if="open" ref="panel" :id="id" tabindex="-1" class="search-date-popup" :class="{custom}"
      :role="custom ? 'dialog' : 'menu'" :aria-label="custom ? 'Custom date range' : 'Any time'" :style="panelStyle"
      @keydown.esc.stop.prevent="escape" @keydown.tab="tabOut" @focusout="focusOut">
      <template v-if="!custom">
        <button v-for="[key,label] in choices" :key="key" role="menuitemradio" tabindex="-1" :aria-checked="checked(key)"
          @click="choose(key)" @keydown="menuKeys"><Icon v-if="checked(key)" icon="material-symbols:check" width="18"/>{{ label }}</button>
      </template>
      <form v-else novalidate @submit.prevent="applyRange">
        <div class="range-fields">
          <label v-for="(name,i) in ['Start date','End date']" :key="name" :class="{raised:texts[i] || active===i}">
            <span>{{ name }}</span>
            <input :ref="el=>fields[i]=el" v-model="texts[i]" :aria-label="name" autocomplete="off" maxlength="32"
              :aria-invalid="Boolean(texts[i].trim() && !dates[i])" aria-haspopup="grid" :aria-expanded="active===i"
              @focus="openCalendar(i)" @click="openCalendar(i)" @input="typed(i)" @keydown.down.prevent="enterGrid(i)"/>
          </label>
        </div>
        <div v-if="invalidRange" class="range-error">End date must be on or after start date.</div>
        <div class="range-actions"><button type="submit" :disabled="!valid">Apply</button></div>
        <div v-if="active!==null" ref="calendar" class="range-calendar" :style="calendarStyle" aria-label="Choose a date">
          <div class="month-heading">
            <button type="button" aria-label="Previous month" :disabled="cursor.getFullYear()===1000 && cursor.getMonth()===0" @click="browse(-1)">«</button>
            <strong aria-live="polite">{{ monthLabel }}</strong>
            <button type="button" aria-label="Next month" :disabled="cursor.getFullYear()===9999 && cursor.getMonth()===11" @click="browse(1)">»</button>
          </div>
          <table role="grid" :aria-label="monthLabel" @keydown="gridKeys">
            <thead><tr><th v-for="day in weekdays" :key="day" scope="col" :abbr="day">{{ day[0] }}</th></tr></thead>
            <tbody><tr v-for="week in weeks" :key="week[0].getTime()"><td v-for="date in week" :key="date.getTime()"
              :aria-selected="same(date,dates[active])">
              <button type="button" :data-date="rangeInput(date)" :aria-label="date.toLocaleDateString('en-US',{dateStyle:'full'})"
                :tabindex="same(date,cursor) ? 0 : -1" :aria-current="same(date,today) ? 'date' : undefined"
                :disabled="date.getFullYear()<1000 || date.getFullYear()>9999"
                :class="{muted:date.getMonth()!==cursor.getMonth(),chosen:same(date,dates[active])}"
                @click="pick(date)">{{ date.getDate() }}</button>
            </td></tr></tbody>
          </table>
        </div>
      </form>
    </div>
  </Teleport>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,ref,useId,watch} from 'vue';
import {Icon} from '@iconify/vue';
import {useMailSearchStore} from '@/store/mail-search';
import {calendarDate,calendarWeeks,moveMonth} from './dates';
import {midnight,olderChoices,parseRangeInput,rangeDates,rangeInput,timeCaption,withoutTime} from './search-range';

const store=useMailSearchStore(), id=useId(), trigger=ref(), panel=ref(), calendar=ref(), fields=[];
const choices=[['','Any time'],...olderChoices,['custom','Custom range…']];
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const open=ref(false), custom=ref(false), active=ref(null), texts=ref(['','']), today=ref(new Date()), cursor=ref(new Date());
const panelStyle=ref({}), calendarStyle=ref({});
const caption=computed(()=>timeCaption(store.filters)), applied=computed(()=>caption.value!=='Any time');
const dates=computed(()=>texts.value.map(parseRangeInput));
const invalidRange=computed(()=>dates.value[0] && dates.value[1] && dates.value[0]>dates.value[1]);
const valid=computed(()=>dates.value.some(Boolean) && texts.value.every((text,i)=>!text.trim() || dates.value[i]) && !invalidRange.value);
const weeks=computed(()=>calendarWeeks(cursor.value));
const monthLabel=computed(()=>cursor.value.toLocaleDateString('en-US',{month:'long',year:'numeric'}));
const same=(a,b)=>b && a.toDateString()===b.toDateString();
function checked(key) {
  if (!key) return !applied.value;
  if (key==='custom') return store.filters.dateAfter!=null || store.filters.dateBefore!=null;
  return store.filters.olderThan===key;
}
function position(element,anchor,width,avoid) {
  const view=window.visualViewport;
  const x=view?.offsetLeft||0,y=view?.offsetTop||0,w=view?.width||document.documentElement.clientWidth,h=view?.height||document.documentElement.clientHeight;
  const size=Math.min(width,Math.max(0,w-16));
  const bounds=anchor.getBoundingClientRect(), vertical=avoid?.getBoundingClientRect() || bounds;
  const below=y+h-8-vertical.bottom-4, above=vertical.top-y-12;
  const desired=Math.min(element.scrollHeight,h-16);
  const down=below>=desired || below>=above;
  const maxHeight=avoid ? Math.max(0,down ? below : above) : Math.max(0,h-16);
  const top=down ? Math.min(vertical.bottom+4,y+h-8-Math.min(maxHeight,desired)) : Math.max(y+8,vertical.top-4-Math.min(maxHeight,desired));
  return {width:size+'px',maxHeight:maxHeight+'px',left:Math.max(x+8,Math.min(bounds.left,x+w-size-8))+'px',top:top+'px'};
}
function place() {
  if (!open.value || !panel.value) return;
  panelStyle.value=position(panel.value,trigger.value,custom.value ? 302 : 220);
  if (calendar.value && active.value!==null) nextTick(()=>{
    if (calendar.value && fields[active.value]) calendarStyle.value=position(calendar.value,fields[active.value],270,panel.value);
  });
}
async function show() {
  if (open.value) return;
  today.value=new Date();custom.value=false;open.value=true;
  await nextTick();place();
  (panel.value?.querySelector('[aria-checked="true"]')||panel.value?.querySelector('button'))?.focus({preventScroll:true});
}
function close(restore=true) {
  open.value=false;active.value=null;
  if (restore) trigger.value?.focus({preventScroll:true});
}
function choose(key) {
  if (key==='custom') {
    texts.value=rangeDates(store.filters).map(date=>date ? rangeInput(date) : '');
    custom.value=true;active.value=null;
    nextTick(()=>{place();panel.value?.focus({preventScroll:true})});
    return;
  }
  store.filters={...withoutTime(store.filters),...(key ? {olderThan:key} : {})};close();
}
function applyRange() {
  if (!valid.value) return;
  const [start,end]=dates.value, next=withoutTime(store.filters);
  if (start) next.dateAfter=midnight(start);
  if (end) next.dateBefore=midnight(end,true);
  store.filters=next;close();
}
let returning=false;
function returnToField(i) {
  returning=true;
  fields[i]?.focus({preventScroll:true});
  returning=false;
  active.value=null;
}
function escape() {
  if (active.value!==null) returnToField(active.value);
  else close();
}
function openCalendar(i) {
  if (returning || active.value===i) return;
  active.value=i;cursor.value=dates.value[i] || dates.value[1-i] || today.value;
  nextTick(place);
}
function typed(i) {
  if (dates.value[i]) cursor.value=dates.value[i];
}
function pick(date) {
  const i=active.value;
  texts.value[i]=rangeInput(date);
  returnToField(i);
}
function browse(step) {
  cursor.value=moveMonth(cursor.value,step);
}
function focusDay() {
  nextTick(()=>calendar.value?.querySelector('[data-date="'+rangeInput(cursor.value)+'"]')?.focus({preventScroll:true}));
}
function enterGrid(i) { openCalendar(i);focusDay(); }
function gridKeys(event) {
  const date=event.target.dataset.date && parseRangeInput(event.target.dataset.date);
  if (!date) return;
  const steps={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-date.getDay(),End:6-date.getDay()};
  let next;
  if (event.key in steps) next=calendarDate(date.getFullYear(),date.getMonth(),date.getDate()+steps[event.key]);
  else if (['PageUp','PageDown'].includes(event.key)) next=moveMonth(date,(event.key==='PageUp' ? -1 : 1)*(event.shiftKey ? 12 : 1));
  else return;
  event.preventDefault();
  if (next.getFullYear()>=1000 && next.getFullYear()<=9999) {cursor.value=next;focusDay();}
}
function tabOut(event) {
  // Follow the chip's place in the mailbox tab order when leaving the teleported panel.
  if (!custom.value) { close(); return; }
  const stops=Array.from(panel.value.querySelectorAll('input,button')).filter(el=>!el.disabled && el.tabIndex>=0);
  if (event.shiftKey ? event.target===panel.value || event.target===stops[0] : event.target===stops.at(-1)) close();
}
function menuKeys(event) {
  const keys=Array.from(panel.value.querySelectorAll('[role=menuitemradio]')), at=keys.indexOf(event.target);
  const index={ArrowUp:(at+keys.length-1)%keys.length,ArrowDown:(at+1)%keys.length,Home:0,End:keys.length-1}[event.key];
  if (index!==undefined) {event.preventDefault();keys[index].focus();}
}
function outside(event) {
  if (!trigger.value?.contains(event.target) && !panel.value?.contains(event.target)) close(false);
}
function focusOut(event) {
  if (event.relatedTarget && !panel.value?.contains(event.relatedTarget) && event.relatedTarget!==trigger.value) close(false);
}
function listen(add) {
  const method=add ? 'addEventListener' : 'removeEventListener';
  document[method]('pointerdown',outside,true);
  window[method]('scroll',place,true);window[method]('resize',place);
  window.visualViewport?.[method]('resize',place);window.visualViewport?.[method]('scroll',place);
}
watch(open,listen);
watch(()=>store.folder,()=>close(false));
onBeforeUnmount(()=>listen(false));
</script>
<style scoped>
.date-chip span {overflow:hidden;text-overflow:ellipsis;}
.search-date-popup {position:fixed;z-index:2400;box-sizing:border-box;overflow:auto;padding:6px 0;background:var(--mail-surface);color:var(--el-text-color-primary);border-radius:4px;box-shadow:0 8px 10px 1px #00000024,0 3px 14px 2px #0000001f,0 5px 5px -3px #0003;font:14px/20px Arial,sans-serif;}
.search-date-popup button {color:inherit;font:inherit;cursor:pointer;background:transparent;border:0;}
.search-date-popup [role=menuitemradio] {text-align:left;position:relative;display:block;width:100%;height:32px;padding:0 16px 0 48px;}
.search-date-popup [role=menuitemradio] svg {position:absolute;left:16px;top:7px;}
.search-date-popup button:hover,.search-date-popup [role=menuitemradio]:focus-visible {background:var(--mail-hover);}
.search-date-popup.custom {padding:0;box-shadow:0 2px 1px -1px #0003,0 1px 1px #00000024,0 1px 3px #0000001f;}
.range-fields {display:flex;gap:12px;padding:18px 16px 0;}
.range-fields label {position:relative;flex:1;min-width:0;}
.range-fields label span {position:absolute;left:10px;top:8px;color:var(--regular-text-color);pointer-events:none;transition:top .12s,font-size .12s;}
.range-fields label.raised span {top:-9px;padding:0 3px;left:7px;background:var(--mail-surface);font-size:11px;}
.range-fields input {box-sizing:border-box;width:100%;height:36px;background:transparent;color:inherit;font:inherit;padding:6px 10px;border:1px solid var(--secondary-text-color);border-radius:4px;}
.range-fields input:focus {outline:2px solid var(--el-color-primary);outline-offset:-2px;}
.range-actions {display:flex;justify-content:flex-end;padding:14px 16px;}
.range-actions button {border-radius:4px;height:36px;min-width:87px;background:var(--el-color-primary);color:white;font-weight:500;}
.range-actions button:disabled {background:var(--el-fill-color-light);color:var(--el-text-color-disabled);cursor:default;}
.range-error {padding:6px 16px 0;color:var(--el-color-danger);font-size:12px;}
.range-calendar {position:fixed;box-sizing:border-box;z-index:1;overflow:auto;border:1px solid var(--light-border-color);background:var(--mail-surface);box-shadow:0 2px 6px #0003;padding:16px 16px 23px;min-height:0;}
.month-heading {display:flex;justify-content:space-between;align-items:center;height:48px;}
.month-heading button {font-size:18px;width:32px;height:32px;border-radius:50%;}
.range-calendar table {border-collapse:collapse;width:min(224px,100%);margin:auto;font-size:12px;text-align:center;}
.range-calendar th {font-weight:500;height:32px;}
.range-calendar td {padding:0;}
.range-calendar td button {width:100%;height:32px;border-radius:50%;}
.range-calendar .muted {color:var(--secondary-text-color);}
.range-calendar .chosen {background:var(--mail-selected);font-weight:700;}
.range-calendar [aria-current=date] {color:var(--el-color-primary);}
@media(prefers-reduced-motion:reduce){.range-fields label span{transition:none;}}
</style>
