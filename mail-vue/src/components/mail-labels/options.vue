<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    placement="bottom-start"
    :fallback-placements="['top-start','right-start','left-start']"
    :popper-options="{ modifiers: [{name:'preventOverflow',options:{altAxis:true,tether:false,padding:8}}] }"
    :offset="0"
    :width="198"
    :show-arrow="false"
    :persistent="false"
    popper-class="label-options-popover"
    @after-enter="focusMenu"
  >
    <template #reference>
      <button
        ref="trigger"
        class="mail-icon label-options"
        :aria-label="'Options for ' + label.name"
        aria-haspopup="menu"
        :aria-expanded="open"
        data-tip="More options"
        @keydown.down.prevent="open = true"
      >
        <Icon icon="material-symbols:more-vert" width="20" />
      </button>
    </template>
    <div
      ref="main"
      role="menu"
      :aria-label="'Options for ' + label.name"
      @keydown="menuKey"
    >
      <el-popover
        :visible="open && palette && !narrow"
        :teleported="false"
        :persistent="false"
        placement="right-start"
        :offset="0"
        :width="236"
        :show-arrow="false"
        :fallback-placements="['left-start', 'bottom-start']"
        popper-class="label-options-popover"
      >
        <template #reference>
          <button
            ref="colorItem"
            type="button"
            class="option"
            role="menuitem"
            aria-haspopup="true"
            :aria-expanded="palette"
            @pointerenter="hoverPalette"
            @click="showPalette(true)"
            @keydown.right.prevent.stop="showPalette(true)"
          >
            <span>Label color</span><span class="sample" :style="labelStyle(label)">a</span
            ><span class="submenu-arrow" aria-hidden="true">▸</span>
          </button>
        </template>
        <ColorChoices
          v-if="!narrow"
          v-bind="choiceProps"
          @choose="save"
          @custom="customize"
          @back="back"
        />
      </el-popover>
      <ColorChoices
        v-if="narrow && palette"
        v-bind="choiceProps"
        @choose="save"
        @custom="customize"
        @back="back"
      />
      <template v-else>
        <div
          v-for="section in displaySections"
          :key="section.id"
          class="display-section"
          role="group"
          :aria-label="section.title"
          @pointerenter="leavePalette"
        >
          <div class="section-title">{{ section.title }}</div>
          <button
            v-for="choice in section.options"
            :key="choice.mode"
            type="button"
            class="option"
            role="menuitemradio"
            :disabled="saving"
            :aria-checked="(label[section.id] || 'show') === choice.mode"
            @click="setDisplay(section.id, choice.mode)"
          >
            <span class="choice-check" aria-hidden="true"
              ><Icon
                v-if="(label[section.id] || 'show') === choice.mode"
                icon="material-symbols:check"
                width="16"
            /></span>
            {{ choice.text }}
          </button>
        </div>
        <p v-if="error && !palette" role="alert" class="option-error">
          {{ error }}
        </p>
        <button
          class="option"
          role="menuitem"
          @pointerenter="leavePalette"
          @click="edit(false)"
        >
          Edit
        </button>
        <button
          class="option"
          role="menuitem"
          @pointerenter="leavePalette"
          @click="edit(true)"
        >
          Remove label
        </button>
        <button class="option" type="button" role="menuitem" @pointerenter="leavePalette" @click="addSublabel">Add sublabel</button>
      </template>
    </div>
  </el-popover>
  <el-dialog
    v-if="customMounted"
    v-model="custom"
    title="Add custom color"
    class="mail-dialog color-dialog"
    width="min(412px, calc(100vw - 24px))"
    align-center
    append-to-body
    :show-close="false"
    :close-on-press-escape="!saving"
    :close-on-click-modal="!saving"
    @closed="customClosed"
  >
    <p class="color-preview">
      <span :style="{ backgroundColor: background, color: foreground }">{{
        label.name
      }}</span>
      Preview label color - pick colors below.
    </p>
    <div class="custom-palettes">
      <div v-for="channel in channels" :key="channel.key">
        <h3>{{ channel.title }}</h3>
        <ColorGrid
          :title="channel.title"
          :colors="customPalette(label[channel.key])"
          :columns="8"
          :disabled="saving"
          :selected="channel.key === 'background' ? background : foreground"
          @choose="
            (color) =>
              channel.key === 'background'
                ? (background = color)
                : (foreground = color)
          "
        />
      </div>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="dialog-actions">
      <button :disabled="saving" @click="cancelCustom">Cancel</button>
      <button
        class="primary"
        :disabled="saving"
        @click="save(background, foreground)"
      >
        Apply
      </button>
    </div>
  </el-dialog>
</template>
<script setup>
import { ref, computed, watch, nextTick, useId, onBeforeUnmount } from "vue";
import { useMediaQuery } from "@vueuse/core";
import { Icon } from "@iconify/vue";
import { useMailLabels } from "@/store/mail-labels";
import ColorChoices from "./color-choices.vue";
import ColorGrid from "./color-grid.vue";
import { customPalette, labelStyle } from "./colors";

const show = { mode: "show", text: "Show" },
  hide = { mode: "hide", text: "Hide" };
const displaySections = [
  {
    id: "sidebar",
    title: "In label list",
    options: [show, { mode: "unread", text: "Show if unread" }, hide],
  },
  { id: "messages", title: "In message list", options: [show, hide] },
];
const props = defineProps({ label: { type: Object, required: true } });
const labels = useMailLabels(),
  trigger = ref(),
  colorItem = ref(),
  main = ref();
const open = ref(false),
  palette = ref(false),
  custom = ref(false),
  customMounted = ref(false),
  saving = ref(false),
  error = ref("");
const background = ref(""),
  foreground = ref(""),
  paletteId = useId(),
  narrow = useMediaQuery("(max-width: 600px), (max-height: 540px)");
const channels = [
  { key: "background", title: "Background color" },
  { key: "foreground", title: "Text color" },
];
const choiceProps = computed(() => ({
  id: paletteId,
  label: props.label,
  recent: labels.recentColors,
  saving: saving.value,
  error: error.value,
}));
watch(open, (value) => {
  if (!value) palette.value = false;
  else {
    error.value = "";
    labels.loadRecentColors();
  }
});
function releaseAnchor() {
  if (labels.optionsAnchor === paletteId) labels.optionsAnchor = null;
}
watch([open, customMounted], async ([menu, dialog]) => {
  if (menu || dialog) {
    labels.optionsAnchor = paletteId;
    return;
  }
  await nextTick();
  if (!open.value && !customMounted.value) releaseAnchor();
});
onBeforeUnmount(releaseAnchor);
function focusMenu() {
  const focused=document.activeElement;
  if (open.value && !saving.value && !palette.value && (focused===trigger.value || focused===document.body))
    colorItem.value?.focus();
}
function restoreFocus() {
  nextTick(() => trigger.value?.focus());
}
function hoverPalette(event) {
  if (event.pointerType === "mouse" && !narrow.value) showPalette(false);
}
function leavePalette(event) {
  if (event.pointerType === "mouse") palette.value = false;
}
async function showPalette(focus) {
  palette.value = true;
  if (focus) {
    await nextTick();
    document
      .getElementById(paletteId)
      ?.querySelector('button[tabindex="0"]')
      ?.focus();
  }
}
function back() {
  palette.value = false;
  colorItem.value?.focus();
}
function addSublabel() {
  open.value=false;
  labels.edit={parentId:props.label.id,restoreFocus};
}
function edit(remove) {
  open.value = false;
  labels.edit = { ...props.label, remove, restoreFocus };
}
function customize() {
  open.value = false;
  error.value = "";
  background.value = props.label.background || "#999999";
  foreground.value = props.label.foreground || "#f3f3f3";
  customMounted.value = true;
  custom.value = true;
}
function cancelCustom() {
  custom.value = false;
}
function customClosed() {
  trigger.value?.focus();
  customMounted.value = false;
}
async function setDisplay(list, mode) {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    await labels.setDisplay(props.label.id, list, mode, () => {
      const focused=document.activeElement;
      return open.value && (focused===trigger.value || main.value?.contains(focused) || focused===document.body);
    });
    open.value = false;
  } catch (e) {
    error.value = e.message || "Could not change label visibility.";
  } finally {
    saving.value = false;
  }
}
async function save(bg, fg, remember = custom.value) {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    await labels.setColor(props.label.id, bg, fg, remember);
    const hadFocus = open.value || custom.value;
    open.value = false;
    custom.value = false;
    if (hadFocus && !customMounted.value) restoreFocus();
  } catch (e) {
    error.value = e.message || "Could not update the label color.";
  } finally {
    saving.value = false;
  }
}
function menuKey(event) {
  if (event.defaultPrevented) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (palette.value) back();
    else {
      open.value = false;
      restoreFocus();
    }
    return;
  }
  if (
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
    !event.target.matches('[role="menuitem"],[role="menuitemradio"]')
  )
    return;
  event.preventDefault();
  const items = [
    ...main.value.querySelectorAll('[role="menuitem"],[role="menuitemradio"]'),
  ];
  const index = items.indexOf(event.target);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
  palette.value = false;
  items[next]?.focus();
}
</script>
<style scoped>
.display-section {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--light-border-color);
}
.display-section:last-of-type {
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--light-border-color);
}
.section-title {
  box-sizing: border-box;
  height: 32px;
  font: 500 14px/20px Arial,sans-serif;
  padding: 6px 16px;
  color: var(--secondary-text-color);
}
.display-section .option {
  gap: 8px;
}
.choice-check {
  position: absolute;
  inset-inline-start: 16px;
  width: 16px;
  display: inline-flex;
}
.option-error {
  margin: 4px 16px;
  font-size: 12px;
  color: var(--mail-draft);
}

.option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  width: 100%;
  height: 32px;
  padding: 0 16px 0 48px;
  color: inherit;
  font:
    14px Arial,
    sans-serif;
  cursor: pointer;
}
.option:is(:hover, :focus-visible, [aria-expanded="true"]) {
  background: var(--mail-hover);
}
.submenu-arrow {margin-inline-start:auto;}
.sample {
  display:inline-grid; place-items:center; width:20px; height:20px;
  border-radius: 2px;
  background: var(--light-border-color);
  font-weight: 600;
}
.color-preview {
  display:flex; align-items:center; flex-wrap:wrap; gap:8px;
  min-height:24px; margin:0 0 16px; font:14px/20px Arial,sans-serif;
}
.color-preview span {
  display:inline-block; max-width:100%; overflow-wrap:anywhere;
  border-radius:4px; padding:0 6px; font:12px/18px Arial,sans-serif;
}
.custom-palettes {display:grid; grid-template-columns:repeat(2,minmax(0,146px)); gap:clamp(8px,12vw,52px);}
h3 {font:400 14px/20px Arial,sans-serif; margin:0;}
.custom-palettes :deep(.color-grid) {padding:6px 0; gap:0;}
.custom-palettes :deep(.color-grid button) {
  height:17.33px; aspect-ratio:auto; border:1px solid transparent; background-clip:padding-box; border-radius:0;
}
.custom-palettes :deep(.color-grid button:nth-child(-n+16)) {height:19px; margin-bottom:12px;}
:global(.color-dialog.el-dialog) {border-radius:28px; box-shadow:none; max-height:calc(100dvh - 24px); overflow:auto; padding:24px;}
:global(.color-dialog .el-dialog__header) {padding:0 0 16px;}
:global(.color-dialog .el-dialog__title) {font:400 24px/32px Arial,sans-serif;}
.color-dialog .dialog-actions button {height:40px; padding:0 12px;}
.color-dialog .dialog-actions .primary {min-width:86px; color:var(--mail-on-primary,white); background:var(--mail-blue,var(--el-color-primary));}
@media (pointer:coarse), (max-width:420px) {
  .custom-palettes {grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px;}
  .custom-palettes :deep(.color-grid button) {height:24px;}
  .custom-palettes :deep(.color-grid button:nth-child(-n+16)) {height:24px; margin-bottom:6px;}
}
@media (max-width:380px) {
  .custom-palettes {grid-template-columns:minmax(0,1fr);}
}
@media (forced-colors:active) {
  :global(.el-popper.label-options-popover), :global(.color-dialog.el-dialog) {outline:1px solid CanvasText;}
  .sample, .color-preview span {forced-color-adjust:none;}
}
@media (max-width:600px), (max-height:540px) {
  :global(.el-popper.label-options-popover) { max-height:calc(100dvh - 16px); overflow-y:auto; overscroll-behavior:contain; }
}
:global(.el-popper.label-options-popover) {
  padding: 6px 0;
  border: 0;
  border-radius: 4px;
  background: var(--mail-surface);
  color: var(--regular-text-color);
  box-shadow:
    0 8px 10px 1px #00000024, 0 3px 14px 2px #0000001f, 0 5px 5px -3px #0003;
}
</style>
