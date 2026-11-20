<template>
  <div
    class="conversation-row"
    :class="{ unread, selected, 'draft-row': draftOnly }"
  >
    <label class="check-target">
      <input
        type="checkbox"
        :aria-label="`Select ${subject || '(no subject)'}`"
        :checked="selected"
        @change="$emit('select')"
      />
    </label>
    <button
      v-if="!draftOnly"
      class="row-star mail-icon"
      :class="{ starred }"
      :aria-pressed="Boolean(starred)"
      :aria-label="starred ? 'Unstar conversation' : 'Star conversation'"
      :data-tip="starred ? 'Unstar' : 'Star'"
      :disabled="busy"
      @click="$emit('star')"
    >
      <Icon
        :icon="
          starred ? 'material-symbols:star' : 'material-symbols:star-outline'
        "
        width="20"
      />
    </button>
    <span v-else class="star-space"></span>
    <button
      class="conversation-open"
      :aria-label="openLabel"
      @click="$emit('open')"
    >
      <span class="participants">
        <span v-if="participants" class="names">{{ participants }}</span>
        <span v-if="draftCount" class="draft-marker"
          ><span v-if="participants">, </span
          >{{ draftCount > 1 ? "Drafts (" + draftCount + ")" : "Draft" }}</span
        >
        <span v-if="count > 1" class="thread-count">{{ count }}</span>
      </span>
      <span class="summary"
        ><span class="subject">{{ subject || "(no subject)" }}</span
        ><span v-if="preview" class="preview"
          ><span class="separator"> - </span>{{ preview }}</span
        ></span
      >
      <span class="row-date" :title="dateTitle"
        ><slot name="status" /><time>{{ date }}</time></span
      >
    </button>
    <div class="row-actions"><slot name="actions" /></div>
    <slot />
  </div>
</template>
<script setup>
import { Icon } from "@iconify/vue";
defineProps({
  participants: String,
  subject: String,
  preview: String,
  date: String,
  dateTitle: String,
  count: Number,
  openLabel: String,
  draftCount: Number,
  busy: Boolean,
  unread: Boolean,
  selected: Boolean,
  starred: Boolean,
  draftOnly: Boolean,
});
defineEmits(["select", "star", "open"]);
</script>
<style scoped>
.conversation-row {
  --row-fill: var(--mail-read);
  position: relative;
  height: 40px;
  display: flex;
  align-items: center;
  padding: 0 12px 0 8px;
  background: var(--row-fill);
  box-shadow: inset 0 -1px var(--light-border-color);
  color: var(--el-text-color-primary);
  font-size: 14px;
  line-height: 20px;
}
.unread {
  --row-fill: var(--mail-surface);
  font-weight: 600;
}
.selected {
  --row-fill: var(--mail-selected);
}
.check-target,
.row-star,
.star-space {
  flex: 0 0 32px;
}
.row-star {
  color: var(--secondary-text-color);
  opacity: 0.65;
}
.row-star.starred {
  color: #e5ab00;
  opacity: 1;
}
.conversation-open {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  height: 100%;
  min-width: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0 4px 0 8px;
}
.conversation-open:focus-visible {
  outline-offset: -2px;
}
.participants {
  flex: 0 0 clamp(140px, 16vw, 200px);
  min-width: 0;
  display: flex;
  align-items: baseline;
  white-space: nowrap;
}
.names,
.summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thread-count {
  font-size: 12px;
  font-weight: 400;
  margin-left: 4px;
}
.draft-marker {
  color: var(--mail-draft);
  font-weight: 400;
  flex-shrink: 0;
  white-space: pre;
}
.summary {
  flex: 1;
  min-width: 0;
}
.preview,
.row-date {
  color: var(--regular-text-color);
}
.preview {
  font-weight: 400;
}
.row-date {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  white-space: nowrap;
}
.unread .row-date {
  color: inherit;
}
.row-actions {
  display: none;
  align-items: center;
}
@media (min-width: 768px) {
  .conversation-row:focus-within,
  .conversation-row:has([aria-expanded="true"]) {
    z-index: 1;
    box-shadow: var(--mail-row-shadow);
  }
  .conversation-row:focus-within .row-actions,
  .conversation-row:has([aria-expanded="true"]) .row-actions {
    display: flex;
  }
  .conversation-row:focus-within .row-date,
  .conversation-row:has([aria-expanded="true"]) .row-date {
    display: none;
  }
}
@media (min-width: 768px) and (hover: hover) {
  .conversation-row:hover {
    z-index: 1;
    box-shadow: var(--mail-row-shadow);
  }
  .conversation-row:hover .row-actions {
    display: flex;
  }
  .conversation-row:hover .row-date {
    display: none;
  }
  .conversation-row:hover .row-star {
    opacity: 1;
  }
}
@media (max-width: 767px) {
  .conversation-row {
    height: 84px;
    padding-right: 12px;
  }
  .conversation-open {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: 20px auto;
    gap: 2px 8px;
    align-content: center;
  }
  .participants {
    grid-area: 1/1;
  }
  .row-date {
    grid-area: 1/2;
    font-size: 11px;
  }
  .summary {
    grid-area: 2/1/3/3;
    padding-right: 24px;
  }
  .subject,
  .preview {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .separator,
  .star-space {
    display: none;
  }
  .row-star {
    position: absolute;
    bottom: 6px;
    right: 8px;
    z-index: 1;
  }
}
</style>
