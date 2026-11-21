<template>
  <div class="inbox-tabs" role="tablist" aria-label="Inbox categories">
    <button
      v-for="(item, index) in inboxCategories"
      :key="item.id"
      role="tab"
      type="button"
      :id="panelId + '-' + item.id"
      :aria-controls="panelId"
      :aria-selected="value === item.id"
      :tabindex="value === item.id ? 0 : -1"
      :style="{ '--category-color': item.color }"
      @click="$emit('select', item.id)"
      @keydown="navigate($event, index)"
    >
      <Icon :icon="'material-symbols:' + item.icon" width="20" />
      <span>{{ item.name }}</span
      ><small v-if="item.id !== 'primary' && unread[item.id]"
        >{{ unread[item.id] }} unread</small
      >
    </button>
  </div>
</template>
<script setup>
import { Icon } from "@iconify/vue";
import { inboxCategories } from "@/utils/inbox-categories";
defineProps({ value: String, unread: Object, panelId: String });
const emit = defineEmits(["select"]);
function navigate(e, index) {
  const count = inboxCategories.length;
  const next = {
    ArrowLeft: (index + count - 1) % count,
    ArrowRight: (index + 1) % count,
    Home: 0,
    End: count - 1,
  }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  e.currentTarget.parentElement.children[next].focus();
  emit("select", inboxCategories[next].id);
}
</script>
<style scoped>
.inbox-tabs {
  display: flex;
  flex-shrink: 0;
  min-width: 0;
  overflow: auto;
  scrollbar-width: none;
  box-shadow: inset 0 -1px var(--light-border-color);
}
.inbox-tabs button {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 0 0;
  max-width: 240px;
  min-width: 0;
  min-height: 56px;
  padding: 0 16px;
  color: var(--regular-text-color);
  cursor: pointer;
  text-align: left;
  font-weight: 500;
}
.inbox-tabs button:hover {
  background: var(--mail-hover);
}
.inbox-tabs button[aria-selected="true"] {
  color: var(--el-color-primary);
}
.inbox-tabs button[aria-selected="true"]::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: currentColor;
}
.inbox-tabs svg {
  flex-shrink: 0;
}
.inbox-tabs small {
  background: var(--category-color);
  color: #fff;
  border-radius: 12px;
  padding: 1px 6px;
  font-size: 11px;
  white-space: nowrap;
}
.inbox-tabs button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -3px;
}
@container (max-width:920px) {
  .inbox-tabs button {
    min-width: max-content;
    gap: 6px;
    padding-inline: 12px;
  }
}
</style>
