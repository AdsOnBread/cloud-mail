<template>
  <FormatPopup
    v-model="visible"
    :label="label"
    :tooltip="tooltip"
    centered
    :panel-class="
      iconsOnly ? (actions ? 'format-icon-menu format-command-menu' : 'format-icon-menu') : actions ? 'format-more-menu' :
        sizePreview ? 'format-type-menu format-size-menu' : 'format-type-menu'
    "
    @open="emit('open')"
    @ready="onShow"
  >
    <template #trigger
      ><slot /><Icon
        v-if="!actions"
        icon="material-symbols:arrow-drop-down"
        width="14"
    /></template>
    <div ref="menu" class="choices" @keydown="navigate">
      <button
        v-for="(item, i) in choices"
        :key="item.value"
        type="button"
        :role="actions ? commandRole(item) : 'menuitemradio'"
        :disabled="item.disabled"
        :aria-label="item.name"
        :aria-checked="actions ? item.checked : item.value === value"
        :tabindex="i === position ? 0 : -1"
        :title="iconsOnly ? undefined : item.tooltip"
        :data-tip="iconsOnly ? item.tooltip : undefined"
        @focus="position = i"
        @mousedown.prevent
        @click="choose(item.value)"
      >
        <Icon v-if="iconsOnly" :icon="item.icon" width="20" />
        <template v-else
          ><span class="check-slot"
            ><Icon
              v-if="!actions && item.value === value"
              icon="material-symbols:check"
              width="18"
          /></span>
          <span :style="item.style">{{ item.name }}</span></template
        >
      </button>
    </div>
  </FormatPopup>
</template>
<script setup>
import { nextTick, ref, watch } from "vue";
import FormatPopup from "./format-popup.vue";
import { Icon } from "@iconify/vue";
const props = defineProps({
  actions: Boolean,
  label: String,
  tooltip: String,
  choices: Array,
  value: String,
  iconsOnly: Boolean,
  sizePreview: Boolean,
});
const emit = defineEmits(["open", "choose"]);
const visible = ref(false),
  position = ref(0),
  menu = ref(null);
function commandRole(item) {
  if (item.checked===undefined) return 'menuitem';
  return item.radio ? 'menuitemradio' : 'menuitemcheckbox';
}
function focusAt(index) {
  position.value = index;
  menu.value?.children[index]?.focus({ preventScroll: true });
  menu.value?.children[index]?.scrollIntoView({ block: "nearest" });
}
async function onShow() {
  await nextTick();
  if (visible.value)
    focusAt(
      Math.max(
        0,
        props.choices.findIndex((item) =>
          props.actions ? !item.disabled : item.value === props.value,
        ),
      ),
    );
}
// A resize can move commands between this open menu and the toolbar.
watch(
  () => props.choices,
  async (choices, previous) => {
    if (!visible.value || !menu.value?.contains(document.activeElement)) return;
    const oldIndex = Array.from(menu.value.children).indexOf(
      document.activeElement,
    );
    const current = choices.findIndex(
      (item) => item.value === previous[oldIndex]?.value && !item.disabled,
    );
    const index =
      current >= 0 ? current : choices.findIndex((item) => !item.disabled);
    await nextTick();
    if (
      visible.value &&
      index >= 0 &&
      (document.activeElement === document.body ||
        menu.value?.contains(document.activeElement))
    )
      focusAt(index);
  },
);
function choose(value) {
  visible.value = false;
  emit("choose", value);
}
function navigate(event) {
  const enabled = props.choices.flatMap((item, i) =>
    item.disabled ? [] : [i],
  );
  const n = enabled.length,
    current = enabled.indexOf(position.value);
  const index = {
    ArrowDown: enabled[(current + 1) % n],
    ArrowUp: enabled[(current + n - 1) % n],
    Home: enabled[0],
    End: enabled[n - 1],
  }[event.key];
  if (index === undefined) return;
  event.stopPropagation();
  event.preventDefault();
  focusAt(index);
}
</script>
<style scoped>
.choices {
  padding: 6px 0;
}
.choices button {
  display: flex;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  color: var(--el-text-color-primary);
  text-align: left;
  font:
    14px/1 Arial,
    sans-serif;
  cursor: pointer;
}
.choices button:hover,
.choices button:focus-visible {
  outline: 0;
  background: var(--mail-hover);
}
.choices button span {
  white-space: nowrap;
}
.check-slot {
  width: 18px;
  display: inline-flex;
  justify-content: center;
  margin-right: 12px;
}
:global(.format-type-menu) {
  width: 195px;
}
:global(.format-popup.format-size-menu) { width: 173px; }
.format-type-menu .choices button {
  padding: 6px 12px 6px 16px;
  line-height: 20px;
}
.format-type-menu .check-slot { width: 16px; margin-right: 16px; }
.format-icon-menu .choices { padding: 4px 0; }
.format-icon-menu .choices button { height: 28px; padding: 4px 8px; }
:global(.format-icon-menu) {
  width: 36px;
}
:global(.format-more-menu) {
  min-width: 44px;
}
.choices button:disabled {
  color: var(--secondary-text-color);
  opacity: 0.45;
  cursor: default;
}
:global(.format-icon-menu [aria-checked="true"]) {
  color: var(--el-color-primary);
  background: var(--mail-selected);
}
.format-command-menu .choices button {
  position:relative; isolation:isolate; color:var(--regular-text-color); background:transparent;
}
.format-command-menu .choices button::before {
  content:""; position:absolute; z-index:-1; inset:0 4px; border-radius:4px;
}
.format-command-menu .choices button:is(:hover,:focus-visible)::before { background:var(--format-hover); }
.format-command-menu .choices button[aria-checked="true"]::before { background:var(--format-active); }
.format-command-menu .choices button:focus-visible::before { outline:2px solid var(--send-blue); outline-offset:-2px; }
@media (forced-colors:active) {
  .format-command-menu .choices button[aria-checked="true"]::before {border:2px solid ButtonText;}
  .format-command-menu .choices button:focus-visible::before {outline-color:Highlight;}
}
</style>
