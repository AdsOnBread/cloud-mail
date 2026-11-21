<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    :placement="chips ? 'bottom-start' : 'bottom-end'"
    :width="440"
    :show-arrow="false"
    popper-class="mail-search-options"
    @before-enter="reset"
    @after-enter="focusForm"
  >
    <template #reference>
      <button
        ref="trigger"
        v-if="!chips"
        type="button"
        class="mail-icon"
        aria-label="Show search options"
        data-tip="Show search options"
      >
        <Icon icon="material-symbols:tune" width="22" />
      </button>
      <button
        ref="trigger"
        v-else
        type="button"
        class="filter-chip advanced"
        :aria-expanded="open"
      >Advanced search</button>
    </template>
    <form
      ref="panel"
      class="options-form"
      @submit.prevent="apply"
      @keydown.esc.stop.prevent="dismiss"
    >
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
      <div class="option-actions">
        <button type="button" @click="clear">Clear</button
        ><button type="submit">Search</button>
      </div>
    </form>
  </el-popover>
</template>
<script setup>
import { computed, ref } from "vue";
import { Icon } from "@iconify/vue";
import {peopleTerms,setPeopleTerms} from '../../../shared/mail-search-people';
import {olderChoices,recentChoices,timeCaption,withoutTime} from "./mail-date-time/search-range";
import { useMailSearchStore } from "@/store/mail-search";
const props = defineProps({ chips: Boolean, queryText: String });
const trigger = ref(),
  panel = ref();
function focusForm() {
  if (open.value) panel.value?.querySelector("input,select")?.focus();
}
function dismiss() {
  open.value = false;
  trigger.value?.focus();
}
const emit = defineEmits(["applied"]);
const store = useMailSearchStore(),
  open = ref(false),
  form = ref({});
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
  padding: 10px;
  display: grid;
  gap: 14px;
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
