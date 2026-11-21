<template>
  <div
    :id="id"
    class="label-palette"
    role="group"
    aria-label="Label color"
    @keydown.esc.stop.prevent="$emit('back')"
    @keydown.left="leave"
  >
    <strong>Label color</strong>
    <ColorGrid
      title="Label color"
      :colors="presetColors"
      :columns="6"
      :selected="selectedPreset"
      :disabled="saving"
      samples
      @choose="(color, i) => $emit('choose', color, presetText(i))"
    />
    <div v-if="recent.length" class="recent" role="group" aria-label="Recent custom colors">
      <button
        v-for="pair in recent"
        :key="pair.background + pair.foreground"
        type="button"
        :aria-label="
          'Custom label color ' +
          pair.background +
          ' with text ' +
          pair.foreground
        "
        :disabled="saving"
        :aria-pressed="
          pair.background === label.background &&
          pair.foreground === label.foreground
        "
        :style="{ backgroundColor: pair.background, color: pair.foreground }"
        @click="$emit('choose', pair.background, pair.foreground, true)"
      >
        a
      </button>
    </div>
    <button type="button" :disabled="saving" @click="$emit('custom')">
      Add custom color
    </button>
    <button
      type="button"
      :disabled="saving"
      @click="$emit('choose', null, null)"
    >
      Remove color
    </button>
    <span v-if="error" role="alert">{{ error }}</span>
  </div>
</template>
<script setup>
import { computed } from "vue";
import ColorGrid from "./color-grid.vue";
import { presetColors, presetText } from "./colors";
const props = defineProps({
  id: String,
  label: Object,
  recent: Array,
  saving: Boolean,
  error: String,
});
const selectedPreset = computed(() => {
  const i = presetColors.indexOf(props.label.background);
  return i >= 0 && presetText(i) === props.label.foreground
    ? props.label.background
    : null;
});
const emit = defineEmits(["choose", "custom", "back"]);
function leave(event) {
  if (!event.defaultPrevented) {
    event.preventDefault();
    event.stopPropagation();
    emit("back");
  }
}
</script>
<style scoped>
.label-palette {padding:0;}
strong {display:block; padding:6px 16px; font:500 14px/20px Arial,sans-serif; color:var(--secondary-text-color);}
.color-grid, .recent {width:144px; margin:0 auto; gap:0;}
.color-grid :deep(button), .recent button {
  width:24px; height:24px; box-sizing:border-box; padding:0; border:2px solid transparent;
  border-radius:4px; background-clip:padding-box; font:500 13px Arial,sans-serif;
}
.color-grid :deep(button:is(:hover,:focus-visible,[aria-pressed=true])), .recent button:is(:hover,:focus-visible,[aria-pressed=true]) {
  outline:1px solid currentColor; outline-offset:-2px;
}
.recent {display:grid;grid-template-columns:repeat(6,24px);}
.recent button {cursor:pointer;}
.label-palette > button {
  display:block; width:100%; text-align:left; padding:6px 12px 6px 48px;
  height:32px; color:inherit; font:14px/20px Arial,sans-serif; cursor:pointer;
}
.label-palette > button:first-of-type {margin-top:4px;}
@media (forced-colors:active) {
  .recent button {forced-color-adjust:none;}
  .label-palette button:focus-visible, .color-grid :deep(button:focus-visible) {outline:2px solid Highlight; outline-offset:-2px;}
}
.label-palette > button:is(:hover, :focus-visible) {
  background: var(--mail-hover);
}
[role="alert"] {
  color: var(--mail-draft);
}
</style>
