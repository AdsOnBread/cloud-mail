<template>
  <div v-if="drafts.length" class="thread-drafts" role="group" aria-label="Saved replies">
    <button v-for="draft in drafts" :key="draft.draftId" type="button" @click="$emit('open',draft)">
      <span class="draft-avatar" aria-hidden="true"><Icon icon="material-symbols:edit-outline" width="20"/></span>
      <span class="draft-label">Draft</span>
      <span class="draft-snippet" dir="auto">{{draft.preview || draft.recipients || '(empty draft)'}}</span>
      <time v-if="draft.lastDate" :data-tip="formatDetailDate(draft.lastDate)">{{mailboxDate(draft.lastDate)}}</time>
    </button>
  </div>
</template>
<script setup>
import {Icon} from '@iconify/vue';
import {formatDetailDate,mailboxDate} from '@/utils/day';
defineProps({drafts:{type:Array,required:true}});
defineEmits(['open']);
</script>
<style scoped>
.thread-drafts button { display:grid; grid-template-columns:40px minmax(0,1fr) auto; grid-template-rows:20px 20px; column-gap:16px; align-items:center; width:100%; padding:16px 0; border-bottom:1px solid var(--light-border-color); color:var(--regular-text-color); text-align:start; cursor:pointer; font:14px/20px Arial,sans-serif; }
.thread-drafts button:hover { background:var(--mail-hover); }
.thread-drafts button:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:-2px; border-radius:4px; }
.draft-avatar { grid-column:1; grid-row:1 / 3; display:grid; place-items:center; width:40px; height:40px; border-radius:50%; color:var(--regular-text-color); background:var(--mail-search); }
.draft-label { grid-row:1;grid-column:2;color:var(--mail-draft); }
.draft-snippet { grid-row:2;grid-column:2 / -1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px; }
time { grid-row:1;grid-column:3;font-size:12px;white-space:nowrap;margin-inline-end:10px; }
@media(max-width:767px) { .thread-drafts button {grid-template-columns:32px minmax(0,1fr) auto;column-gap:8px} .draft-avatar{width:32px;height:32px} }
</style>
