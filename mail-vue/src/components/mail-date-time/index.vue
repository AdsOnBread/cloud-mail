<template>
  <form class="date-form" novalidate @submit.prevent="submit">
    <div class="picker-body">
      <div class="calendar">
        <div class="month-nav">
          <strong :id="monthId" aria-live="polite">{{ monthLabel }}</strong>
          <button type="button" class="nav" :disabled="atFirstMonth" aria-label="Previous month" data-tip="Previous month" @click="browse(-1)"><Icon icon="material-symbols:chevron-left" width="20"/></button>
          <button type="button" class="nav" :disabled="atLastMonth" aria-label="Next month" data-tip="Next month" @click="browse(1)"><Icon icon="material-symbols:chevron-right" width="20"/></button>
        </div>
        <table role="grid" :aria-labelledby="monthId" @keydown="keyDay">
          <thead><tr><th v-for="day in weekdays" :key="day" scope="col" :abbr="day">{{ day[0] }}</th></tr></thead>
          <tbody>
            <tr v-for="week in weeks" :key="week[0].getTime()">
              <td v-for="date in week" :key="date.getTime()" :aria-selected="sameDate(date,selectedDay)">
                <button type="button" :data-day="date.getTime()" :tabindex="sameDate(date,cursor)?0:-1" :aria-label="date.toLocaleDateString('en-US',longDate)"
                  :aria-current="sameDate(date,today)?'date':undefined" :class="{outside:date.getMonth()!==cursor.getMonth(), chosen:sameDate(date,selectedDay)}"
                  :disabled="date<today || date.getFullYear()>9999" @click="pick(date)" @focus="focusedDay=date">{{ date.getDate() }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="fields">
        <input ref="dateInput" v-model="dateText" aria-label="Date" :aria-invalid="invalid==='date'" :aria-describedby="invalid==='date'?errorId:undefined" placeholder="Nov 20, 2026" autocomplete="off" spellcheck="false" @input="clearError">
        <input ref="timeInput" v-model="timeText" aria-label="Time" :aria-invalid="invalid==='time'" :aria-describedby="invalid==='time'?errorId:undefined" placeholder="8:00 AM" autocomplete="off" spellcheck="false" @input="clearError">
        <span class="zone" :title="zoneId">{{ zone }}</span>
      </div>
    </div>
    <p v-if="error" :id="errorId" role="alert">{{ error }}</p>
    <div class="dialog-actions"><button type="button" @click="$emit('cancel')">Cancel</button><button class="primary" type="submit">{{ action }}</button></div>
  </form>
</template>
<script setup>
import {computed,nextTick,ref,useId,watch} from 'vue';
import {Icon} from '@iconify/vue';
import {calendarDate,formatDay,parseDay,parseTime,localTime,moveMonth} from './dates';
const props=defineProps({initial:{type:Date,required:true},action:{type:String,required:true}});
const emit=defineEmits(['choose','cancel']);
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const longDate={weekday:'long',month:'long',year:'numeric',day:'numeric'};
const monthId=useId(),errorId=useId(),dateInput=ref(),timeInput=ref();
const now=new Date(),today=calendarDate(now.getFullYear(),now.getMonth(),now.getDate());
const dateText=ref(formatDay(props.initial)),timeText=ref(props.initial.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}));
const selectedDay=computed(()=>parseDay(dateText.value));
const cursor=ref(selectedDay.value && selectedDay.value>=today?selectedDay.value:today);
const focusedDay=ref(cursor.value);
const monthLabel=computed(()=>cursor.value.toLocaleDateString('en-US',{month:'long',year:'numeric'}));
const zoneId=Intl.DateTimeFormat().resolvedOptions().timeZone;
const zone=computed(()=>{
  const day=selectedDay.value || cursor.value;
  const instant=localTime(day,parseTime(timeText.value)||{hour:12,minute:0})||day;
  return new Intl.DateTimeFormat('en-US',{timeZoneName:'long'}).formatToParts(instant).find(part=>part.type==='timeZoneName')?.value || zoneId;
});
const atFirstMonth=computed(()=>cursor.value.getFullYear()===today.getFullYear() && cursor.value.getMonth()===today.getMonth());
const atLastMonth=computed(()=>cursor.value.getFullYear()===9999 && cursor.value.getMonth()===11);
const weeks=computed(()=>{
  const year=cursor.value.getFullYear(),month=cursor.value.getMonth(),offset=calendarDate(year,month,1).getDay();
  return Array.from({length:6},(_,week)=>Array.from({length:7},(_,day)=>calendarDate(year,month,1-offset+week*7+day)));
});
const error=ref(''),invalid=ref('');
const sameDate=(a,b)=>b && a.getTime()===b.getTime();
function clearError(){error.value='';invalid.value='';}
watch(selectedDay,date=>{if(date && date>=today)cursor.value=date;});
function focusCursor(){nextTick(()=>dateInput.value?.closest('form')?.querySelector('[data-day="'+cursor.value.getTime()+'"]')?.focus());}
function pick(date){
  cursor.value=date;
  dateText.value=formatDay(date);
  clearError();
  focusCursor();
}
function browse(step){
  const next=moveMonth(cursor.value,step);
  cursor.value=next<today?today:next;
}
function keyDay(event){
  if(!event.target.matches('[data-day]'))return;
  const date=focusedDay.value;
  const deltas={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-date.getDay(),End:6-date.getDay()};
  let next;
  if(event.key in deltas)next=calendarDate(date.getFullYear(),date.getMonth(),date.getDate()+deltas[event.key]);
  else if(event.key==='PageUp'||event.key==='PageDown')next=moveMonth(date,(event.key==='PageUp'?-1:1)*(event.shiftKey?12:1));
  else return;
  event.preventDefault();
  cursor.value=next<today?today:next.getFullYear()>9999?calendarDate(9999,11,31):next;
  focusCursor();
}
function fail(field,message){
  invalid.value=field;error.value=message;
  (field==='date'?dateInput:timeInput).value?.focus();
}
function submit(){
  const day=selectedDay.value,time=parseTime(timeText.value);
  if(!day)return fail('date','Enter a valid date, such as Nov 20, 2026.');
  if(!time)return fail('time','Enter a valid time, such as 8:00 AM.');
  const instant=localTime(day,time);
  if(!instant)return fail('time','That time does not exist in your time zone. Choose another time.');
  const current=new Date();
  if(instant<=current)return fail(day.toDateString()===current.toDateString()?'time':'date','Choose a future date and time.');
  emit('choose',instant);
}
defineExpose({focus:focusCursor});
</script>
<style scoped>
.picker-body{display:flex;align-items:flex-start;gap:24px}
.calendar{width:224px;flex:none}
.month-nav{display:flex;align-items:center;height:36px;margin-bottom:6px}
.month-nav strong{flex:1;font:500 14px/20px Arial,sans-serif}
.nav{height:30px;width:30px;border-radius:50%;display:grid;place-items:center;color:var(--regular-text-color);cursor:pointer}
.nav:hover,.calendar td button:hover{background:var(--mail-hover)}
.nav:disabled,.calendar td button:disabled{color:var(--secondary-text-color);opacity:.45;cursor:default;background:transparent}
table{width:100%;border-collapse:collapse;table-layout:fixed;text-align:center}
th{height:26px;color:var(--regular-text-color);font:500 11px/20px Arial,sans-serif}
td{height:30px;padding:0}
.calendar td button{display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border-radius:50%;color:inherit;font:400 12px/1 Arial,sans-serif;cursor:pointer}
.calendar td .outside{color:var(--secondary-text-color)}
.calendar td [aria-current=date]{color:var(--el-color-primary);font-weight:700}
.calendar td .chosen,.calendar td .chosen:hover{color:var(--mail-surface);background:var(--el-color-primary)}
.fields{flex:1;min-width:0;display:grid;gap:10px;padding-top:5px}
.fields input{box-sizing:border-box;width:100%;height:36px;padding:0 10px;border:1px solid var(--secondary-text-color);border-radius:4px;background:var(--mail-surface);color:inherit;font:14px Arial,sans-serif;user-select:text}
.fields input:focus{outline:2px solid var(--el-color-primary);outline-offset:-2px}
.zone{color:var(--regular-text-color);font:12px/17px Arial,sans-serif}
[role=alert]{margin:12px 0 0;color:var(--mail-draft);font:13px/18px Arial,sans-serif}
@media(max-width:480px){.picker-body{flex-direction:column;align-items:center;gap:12px}.fields{width:100%;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}.fields .zone{grid-column:1/-1}.dialog-actions{padding-top:16px}}
</style>
