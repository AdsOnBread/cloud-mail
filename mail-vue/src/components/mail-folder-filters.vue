<template>
  <div ref="row" class="filter-row" role="group" :aria-label="folder === 'trash' ? 'Filter Trash' : 'Filter Scheduled'">
    <template v-for="key in ordered" :key="key">
      <button v-if="flags[key]" type="button" class="filter-chip" :aria-pressed="active(key)" @click="toggle(key)">
        <Icon v-if="active(key)" icon="material-symbols:check" width="16" />{{ flags[key] }}
      </button>
      <PeopleFilter v-else-if="key==='from' || key==='to'" :field="key" :folder="folder" :account-id="accountId" />
      <SearchDateChip v-else />
    </template>
    <button type="button" class="filter-chip advanced" aria-haspopup="dialog" data-search-options
      :aria-expanded="Boolean(opener)" @click="opener=opener ? null : $event.currentTarget">Advanced search</button>
  </div>
</template>

<script setup>
import {computed,inject,onBeforeUpdate,onUpdated,ref} from 'vue';
import {Icon} from '@iconify/vue';
import {advancedSearchOpenerKey,useMailSearchStore} from '@/store/mail-search';
import PeopleFilter from './mail-people-filter.vue';
import SearchDateChip from './mail-date-time/search-chip.vue';
import {timeCaption} from './mail-date-time/search-range';

const props=defineProps({folder:{type:String,required:true},accountId:Number});
const store=useMailSearchStore();
const row=ref(), opener=inject(advancedSearchOpenerKey);
const flags={hasAttachment:'Has attachment',isUnread:'Is unread'};
const ordered=computed(()=>{
  const keys=['from','days','hasAttachment','to'];
  if (props.folder==='trash') keys.push('isUnread');
  return keys.sort((a,b)=>Number(active(b))-Number(active(a)));
});
function active(key) {
  return key==='days' ? timeCaption(store.filters)!=='Any time' : Boolean(store.filters[key]);
}
function toggle(key) {
  const filters={...store.filters};
  if (filters[key]) delete filters[key];
  else filters[key]=1;
  store.filters=filters;
}

// A DOM move can send focus to the page body when an applied chip moves to the front.
let focused;
onBeforeUpdate(()=>{focused=row.value?.contains(document.activeElement) ? document.activeElement : null});
onUpdated(()=>{
  if (focused?.isConnected && document.activeElement===document.body) focused.focus({preventScroll:true});
  focused=null;
});
</script>
