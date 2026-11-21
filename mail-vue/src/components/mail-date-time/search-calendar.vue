<template>
        <div ref="root" class="range-calendar" aria-label="Choose a date">
          <div class="month-heading">
            <button type="button" aria-label="Previous month" :disabled="cursor.getFullYear()===1000 && cursor.getMonth()===0" @click="browse(-1)">«</button>
            <strong aria-live="polite">{{ monthLabel }}</strong>
            <button type="button" aria-label="Next month" :disabled="cursor.getFullYear()===9999 && cursor.getMonth()===11" @click="browse(1)">»</button>
          </div>
          <table role="grid" :aria-label="monthLabel" @keydown="gridKeys">
            <thead><tr><th v-for="day in weekdays" :key="day" scope="col" :abbr="day">{{ day[0] }}</th></tr></thead>
            <tbody><tr v-for="week in weeks" :key="week[0].getTime()"><td v-for="date in week" :key="date.getTime()"
              :aria-selected="same(date,selected)">
              <button type="button" :data-date="rangeInput(date)" :aria-label="date.toLocaleDateString('en-US',{dateStyle:'full'})"
                :tabindex="same(date,cursor) ? 0 : -1" :aria-current="same(date,today) ? 'date' : undefined"
                :disabled="date.getFullYear()<1000 || date.getFullYear()>9999"
                :class="{muted:date.getMonth()!==cursor.getMonth(),chosen:same(date,selected)}"
                @click="emit('pick',date)">{{ date.getDate() }}</button>
            </td></tr></tbody>
          </table>
        </div>
</template>
<script setup>
import {computed,nextTick,ref} from 'vue';
import {calendarDate,calendarWeeks,moveMonth} from './dates';
import {parseRangeInput,rangeInput} from './search-range';

defineProps({selected:Date,today:{type:Date,required:true}});
const cursor=defineModel('cursor',{type:Date,required:true});
const emit=defineEmits(['pick']);
const root=ref();
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const weeks=computed(()=>calendarWeeks(cursor.value));
const monthLabel=computed(()=>cursor.value.toLocaleDateString('en-US',{month:'long',year:'numeric'}));
const same=(a,b)=>b && a.toDateString()===b.toDateString();
function browse(step) {
  cursor.value=moveMonth(cursor.value,step);
}
function focusDay() {
  nextTick(()=>root.value?.querySelector('[data-date="'+rangeInput(cursor.value)+'"]')?.focus({preventScroll:true}));
}
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
defineExpose({root,focusDay});
</script>
<style scoped>
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
.range-calendar button {border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;}
.range-calendar button:hover,.range-calendar button:focus-visible {background:var(--mail-hover);}
.month-heading button {font-size:18px;}
.range-calendar td button.chosen {background:var(--mail-selected);}
</style>
