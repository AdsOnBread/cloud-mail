<template>
  <el-popover :visible="open" :persistent="false" placement="bottom-start" :offset="4"
    :show-arrow="false" :width="300" popper-class="mail-people-popper" @after-enter="focusInput">
    <template #reference>
      <button ref="trigger" type="button" class="filter-chip people-chip" aria-haspopup="dialog"
        :aria-expanded="open" :aria-pressed="Boolean(selected.length)" :aria-label="caption"
        @click="open ? close(true) : show()" @keydown.down.prevent="show">
        <Icon v-if="selected.length" icon="material-symbols:check" width="16"/>
        <span>{{ caption }}</span><Icon icon="material-symbols:arrow-drop-down" width="16"/>
      </button>
    </template>
    <div ref="panel" role="dialog" :aria-label="label+' filter'" class="people-panel"
      @keydown.esc.stop.prevent="close(true)" @keydown.tab="tabOut" @focusout="focusOut">
      <div class="people-entry">
        <button v-for="person in selected" :key="person" class="person-token" type="button"
          :aria-label="'Remove '+person" @click="remove(person)">
          <span>{{ person }}</span><Icon icon="material-symbols:close" width="14"/>
        </button>
        <input ref="input" v-model="query" role="combobox" aria-label="Name or email" placeholder="Name or email"
          :aria-controls="id" aria-autocomplete="list" :aria-expanded="true"
          :aria-activedescendant="index>=0 && options[index] ? id+'-'+index : undefined"
          maxlength="200" autocomplete="off" spellcheck="false" @keydown="keys"/>
      </div>
      <div :id="id" role="listbox" :aria-label="label+' suggestions'" class="people-list">
        <div v-for="(person,i) in options" :id="id+'-'+i" :key="person.email" role="option"
          :aria-selected="index===i" class="person-option" @pointermove="index=i" @mousedown.prevent @click="add(person.email)">
          <span class="person-avatar" aria-hidden="true">{{ person.name.slice(0,1).toUpperCase() }}</span>
          <span class="person-lines"><strong>{{ person.name }}</strong><small v-if="!person.typed">{{ person.email }}</small></span>
        </div>
      </div>
      <small v-if="selected.length>=maxPeople" role="status" class="people-limit">Remove a person to add another.</small>
    </div>
  </el-popover>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,ref,useId,watch} from 'vue';
import {Icon} from '@iconify/vue';
import http from '@/axios';
import {useMailSearchStore} from '@/store/mail-search';
import {useUserStore} from '@/store/user';
import {useAccountStore} from '@/store/account';
import {maxPeople,peopleTerms,setPeopleTerms} from '../../../shared/mail-search-people';

const props=defineProps({field:{type:String,required:true},folder:{type:String,required:true},accountId:Number});
const store=useMailSearchStore(), account=useAccountStore(), user=useUserStore();
const trigger=ref(), panel=ref(), input=ref(), id=useId();
const open=ref(false),query=ref(''),index=ref(-1),contacts=ref([]);
const label=computed(()=>props.field==='from' ? 'From' : 'To');
const selected=computed(()=>peopleTerms(store.filters,props.field));
const caption=computed(()=>selected.value.length ? label.value+' '+selected.value.join(', ') : label.value);
const options=computed(()=>{
  if (selected.value.length>=maxPeople) return [];
  const omit=new Set(selected.value.map(s=>s.toLowerCase())), typed=query.value.trim();
  const matches=contacts.value.filter(p=>!omit.has(p.email.toLowerCase()) &&
    [p.name,p.email].some(value=>value.toLowerCase().includes(typed.toLowerCase())));
  if (typed && !omit.has(typed.toLowerCase()) && !matches.some(p=>p.email.toLowerCase()===typed.toLowerCase()))
    matches.push({name:typed,email:typed,typed:true});
  return matches;
});
function focusInput() { if (open.value) input.value?.focus({preventScroll:true}); }
function show() { open.value=true;nextTick(focusInput); }
function close(restore=false) {
  open.value=false;query.value='';index.value=-1;
  if (restore) trigger.value?.focus({preventScroll:true});
}
function update(terms) {
  const next={...store.filters};
  setPeopleTerms(next,props.field,terms);
  store.filters=next;
}
function add(term) {
  if (!term.trim() || selected.value.length>=maxPeople) return;
  update([...selected.value,term]);close(true);
}
function remove(term) {
  update(selected.value.filter(value=>value!==term));
  query.value='';index.value=-1;nextTick(focusInput);
}
function keys(event) {
  if (event.isComposing) return;
  if (event.key==='Enter') {
    event.preventDefault();
    add(options.value[index.value]?.email ?? query.value);
  } else if (event.key==='Backspace' && !query.value && selected.value.length) {
    event.preventDefault(); remove(selected.value.at(-1));
  } else if (['ArrowDown','ArrowUp'].includes(event.key) && options.value.length) {
    event.preventDefault();
    index.value=event.key==='ArrowDown' ? (index.value+1)%options.value.length :
      (index.value<=0 ? options.value.length-1 : index.value-1);
    document.getElementById(id+'-'+index.value)?.scrollIntoView({block:'nearest'});
  }
}
function tabOut(event) {
  const first=panel.value?.querySelector('button,input');
  if (event.shiftKey ? event.target===first : event.target===input.value) close(true);
}
function focusOut(event) {
  if (event.relatedTarget && !panel.value?.contains(event.relatedTarget) && event.relatedTarget!==trigger.value) close();
}
function outside(event) {
  if (!panel.value?.contains(event.target) && !trigger.value?.contains(event.target)) close();
}
watch(open,visible=>{
  document[visible?'addEventListener':'removeEventListener']('pointerdown',outside,true);
});
watch([()=>props.folder,()=>props.accountId,()=>account.currentAccountId,()=>user.user.email],()=>close(),{flush:'sync'});
watch([open,query],([visible,text],_,cleanup)=>{
  index.value=-1;
  if (!visible) { contacts.value=[];return; }
  let current=true;
  const timer=setTimeout(async()=>{
    try {
      const data=await http.get('/v1/search/people',{params:{field:props.field,folder:props.folder,accountId:props.accountId,q:text.trim()},noMsg:true});
      if (current) { contacts.value=data;index.value=-1; }
    } catch { if (current) contacts.value=[]; }
  },text ? 120 : 0);
  cleanup(()=>{current=false;clearTimeout(timer)});
});
onBeforeUnmount(()=>document.removeEventListener('pointerdown',outside,true));
</script>
<style scoped>
.people-chip span,.person-token span,.person-lines strong,.person-lines small {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.people-chip svg,.person-token svg {flex-shrink:0;}
.people-panel {display:flex;flex-direction:column;max-height:min(580px,65dvh);font:14px/20px Arial,sans-serif;color:var(--el-text-color-primary);}
.people-entry {display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:4px 10px;overflow:auto;flex-shrink:0;max-height:26dvh;}
.people-entry input {border:0;background:transparent;color:inherit;font:16px/24px Arial,sans-serif;flex:1 0 min(125px,100%);min-width:0;height:40px;padding:0;outline:none;}
.person-token {display:inline-flex;gap:6px;align-items:center;max-width:100%;padding:3px 8px 3px 10px;border:1px solid var(--light-border-color);border-radius:16px;background:var(--mail-surface);color:inherit;font:inherit;cursor:pointer;}
.people-list {overflow:auto;overscroll-behavior:contain;}
.person-option {height:64px;display:flex;align-items:center;gap:16px;padding:0 16px;cursor:pointer;}
.person-option:hover,.person-option[aria-selected=true],.person-token:hover {background:var(--mail-hover);}
.person-avatar {flex:0 0 40px;height:40px;display:grid;place-items:center;background:var(--mail-selected);color:var(--el-text-color-primary);font-size:18px;border-radius:50%;}
.person-lines {min-width:0;display:grid;}
.person-lines strong {font-size:16px;font-weight:500;line-height:24px;}
.person-lines small,.people-limit {color:var(--regular-text-color);font-size:14px;}
.people-limit {padding:8px 12px;}
</style>
<style>
.mail-people-popper.el-popper {padding:0;max-width:calc(100vw - 16px);border:0;border-radius:4px;background:var(--mail-surface);box-shadow:0 2px 6px 2px #3c404326,0 1px 2px #3c40434d;}
</style>
