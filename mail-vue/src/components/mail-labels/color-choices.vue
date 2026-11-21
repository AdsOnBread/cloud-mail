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
    <div class="recent" role="group" aria-label="Recent custom colors">
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
      <span v-for="n in 6 - recent.length" :key="n" aria-hidden="true"></span>
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
.label-palette {
  padding: 4px 10px;
}
strong {
  display: block;
  font-weight: 500;
  font-size: 13px;
  margin: 0 0 8px;
}
.color-grid {
  margin-bottom: 5px;
}
.recent {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 2px;
  margin: 0 0 6px;
  padding-top: 5px;
  border-top: 1px solid var(--light-border-color);
}
.recent > * {
  aspect-ratio: 1;
  border-radius: 2px;
  border: 1px solid var(--light-border-color);
}
.recent button:is(:focus-visible, [aria-pressed="true"]) {
  outline: 2px solid var(--el-text-color-primary);
}
.recent button {
  cursor: pointer;
  font:
    600 13px Arial,
    sans-serif;
}
.label-palette > button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 4px;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}
.label-palette > button:is(:hover, :focus-visible) {
  background: var(--mail-hover);
}
[role="alert"] {
  color: var(--mail-draft);
}
</style>
