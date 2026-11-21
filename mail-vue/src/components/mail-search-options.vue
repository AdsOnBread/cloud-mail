<template>
      <button
        ref="trigger"
        v-if="!chips"
        type="button"
        class="mail-icon"
        aria-label="Show search options"
        data-tip="Show search options"
        aria-haspopup="dialog" :aria-expanded="open" @click="toggle"
      >
        <Icon icon="material-symbols:tune" width="22" />
      </button>
      <button
        ref="trigger"
        v-else
        type="button"
        class="filter-chip advanced"
        aria-haspopup="dialog" :aria-expanded="open" @click="toggle"
      >Advanced search</button>
  <Teleport to="body">
    <form v-if="open" role="dialog" aria-label="Advanced search" :style="position"
      ref="panel"
      class="options-form"
      @submit.prevent="apply"
      @keydown.esc.stop.prevent="dismiss" @keydown.tab="tabOut" @focusout="focusOut"
    >
      <div class="criteria">
      <label v-for="key in fields" :key="key"
        >{{ names[key] }}
        <select v-if="key === 'days'" v-model="form.days">
          <option v-if="customRange" value="custom">{{ timeCaption(store.filters) }}</option>
          <option v-for="[value, text] in times" :value="value" :key="value">
            {{ text }}
          </option>
        </select>
        <span v-else-if="key==='from' || key==='to'" class="people-terms">
          <input v-for="(_,i) in form[key]" :key="i" v-model="form[key][i]"
            :aria-label="i ? names[key]+' '+(i+1) : names[key]" maxlength="200" type="text"/>
        </span>
        <input
          v-else
          v-model="form[key]"
          :aria-label="names[key]"
          maxlength="200"
          type="text"
        />
      </label>
        <label class="check"
          ><input v-model="form.hasAttachment" type="checkbox" /> Has
          attachment</label
        >
        <label v-if="store.folder!=='scheduled'" class="check"
          ><input v-model="form.isUnread" type="checkbox" /> Is unread</label
        >
      </div>
      <div class="option-actions">
        <button type="button" @click="clear">Clear</button
        ><button type="submit">Search</button>
      </div>
    </form>
  </Teleport>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {positionMailboxPopup} from "./mail-popup-position";
import { Icon } from "@iconify/vue";
import {peopleTerms,setPeopleTerms} from '../../../shared/mail-search-people';
import {olderChoices,recentChoices,timeCaption,withoutTime} from "./mail-date-time/search-range";
import { useMailSearchStore } from "@/store/mail-search";
const props = defineProps({ chips: Boolean, queryText: String });
const trigger = ref(),
  panel = ref();
const position=ref({});
function place() {
  if (open.value && panel.value && trigger.value) position.value=positionMailboxPopup(panel.value,trigger.value,440,trigger.value,!props.chips);
}
function toggle() {
  if (open.value) return dismiss();
  reset();
  open.value=true;
  nextTick(()=>{place();panel.value?.querySelector('input,select')?.focus({preventScroll:true});});
}
function dismiss() {
  open.value = false;
  trigger.value?.focus({preventScroll:true});
}
function tabOut(event) {
  const controls=panel.value.querySelectorAll('input,select,button');
  if (event.shiftKey ? event.target===controls[0] : event.target===controls[controls.length-1]) dismiss();
}
function focusOut(event) {
  if (event.relatedTarget && !panel.value?.contains(event.relatedTarget) && event.relatedTarget!==trigger.value) open.value=false;
}
function outside(event) {
  if (!panel.value?.contains(event.target) && !trigger.value?.contains(event.target)) open.value=false;
}
function listen(visible) {
  const method=visible ? 'addEventListener' : 'removeEventListener';
  document[method]('pointerdown',outside,true);
  window[method]('resize',place);window[method]('scroll',place,true);
  window.visualViewport?.[method]('resize',place);window.visualViewport?.[method]('scroll',place);
}
const emit = defineEmits(["applied"]);
const store = useMailSearchStore(),
  open = ref(false),
  form = ref({});
watch(open,listen);
watch(()=>store.folder,()=>{open.value=false});
onBeforeUnmount(()=>listen(false));
const names = {
  from: "From",
  to: "To",
  subject: "Subject",
  q: "Has the words",
  days: "Any time",
};
const times = [["","Any time"],...recentChoices,...olderChoices];
const customRange = computed(() => store.filters.dateAfter!=null || store.filters.dateBefore!=null);
const fields = ["from", "to", "subject", "q", "days"];
function reset() {
  form.value = {
    ...store.filters,
    from:store.filters.from ? peopleTerms(store.filters,'from') : [''],
    to:store.filters.to ? peopleTerms(store.filters,'to') : [''],
    q: props.queryText ?? store.query,
    days: store.filters.olderThan || (customRange.value ? "custom" : store.filters.days || ""),
    hasAttachment: Boolean(store.filters.hasAttachment),
    isUnread: Boolean(store.filters.isUnread),
  };
}
function apply() {
  let next = { ...store.filters };
  for (const key of fields) {
    if (key==='from' || key==='to') {
      setPeopleTerms(next,key,form.value[key] || []);
      continue;
    }
    const value = String(form.value[key] || "").trim();
    if (key === "days") {
      if (value === "custom") continue;
      next = withoutTime(next);
      if (olderChoices.some(([id])=>id===value)) next.olderThan = value;
      else if (value) next.days = value;
    } else if (key === "q") store.query = value;
    else if (value) next[key] = value;
    else delete next[key];
  }
  for (const key of ["hasAttachment", "isUnread"]) {
      if (form.value[key]) next[key] = 1;
      else delete next[key];
    }
  store.filters = next;
  dismiss();
  emit("applied", store.query);
}
function clear() {
  form.value = {};
  apply();
}
</script>
<style scoped>
.options-form {
  position:fixed;
  z-index:2400;
  width:440px;
  max-width:calc(100vw - 16px);
  padding: 18px;
  border-radius:10px;
  background:var(--mail-surface);
  color:var(--el-text-color-primary);
  box-shadow:0 2px 6px 2px #3c404326,0 1px 2px #3c40434d;
  display:flex;
  flex-direction:column;
  box-sizing:border-box;
  max-height:min(70dvh,575px);
}
.criteria {
  display:grid;
  gap:14px;
  min-height:0;
  overflow-y:auto;
  overscroll-behavior:contain;
}
.options-form label {
  display: grid;
  grid-template-columns: 96px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--regular-text-color);
}
.options-form input[type="text"],
.options-form select {
  width: 100%;
  min-width: 0;
  border: 0;
  border-bottom: 1px solid var(--light-border-color);
  padding: 4px;
  color: var(--el-text-color-primary);
  background: var(--mail-surface);
  font: inherit;
}
.options-form input[type="text"]:focus {
  outline: none;
  border-bottom: 2px solid var(--el-color-primary);
}
.people-terms {display:grid;gap:4px;min-width:0;}
.options-form label.check {
  display: flex;
}
.option-actions {
  flex-shrink:0;
  padding-top:12px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}
.option-actions button {
  cursor: pointer;
  padding: 8px 16px;
  border-radius: 20px;
  color: var(--el-color-primary);
  font-weight: 500;
}
.option-actions button:last-child {
  background: var(--el-color-primary);
  color: var(--mail-surface);
}
</style>
