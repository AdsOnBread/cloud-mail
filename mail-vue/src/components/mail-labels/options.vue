<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    placement="bottom-start"
    :fallback-placements="['top-start','right-start','left-start']"
    :popper-options="{ modifiers: [{name:'preventOverflow',options:{altAxis:true,tether:false,padding:8}}] }"
    :width="188"
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
        <Icon icon="material-symbols:more-vert" width="18" />
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
        :offset="2"
        :width="182"
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
            Label color <span class="sample" :style="labelStyle(label)">a</span
            ><span aria-hidden="true">▸</span>
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
    width="440px"
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
    </p>
    <p class="preview-caption">Preview label color – pick colors below.</p>
    <div class="custom-palettes">
      <div v-for="channel in channels" :key="channel.key">
        <h3>{{ channel.title }}</h3>
        <ColorGrid
          :title="channel.title"
          :colors="customColors"
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
import { customColors, labelStyle } from "./colors";

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
  labels.edit={parentId:props.label.id};
}
function edit(remove) {
  open.value = false;
  labels.edit = { ...props.label, remove };
}
function customize() {
  open.value = false;
  error.value = "";
  background.value = props.label.background || "#e7e7e7";
  foreground.value = props.label.foreground || "#000000";
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
  border-top: 1px solid var(--light-border-color);
  padding: 4px 0;
}
.display-section:last-of-type {
  border-bottom: 1px solid var(--light-border-color);
}
.section-title {
  font-size: 12px;
  padding: 3px 16px;
  color: var(--secondary-text-color);
}
.display-section .option {
  gap: 8px;
}
.choice-check {
  width: 16px;
  display: inline-flex;
}
.option-error {
  margin: 4px 16px;
  font-size: 12px;
  color: var(--mail-draft);
}

.option {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  width: 100%;
  height: 32px;
  padding: 0 16px;
  color: inherit;
  font:
    14px Arial,
    sans-serif;
  cursor: pointer;
}
.option:is(:hover, :focus-visible, [aria-expanded="true"]) {
  background: var(--mail-hover);
}
.sample {
  margin-left: auto;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--light-border-color);
  font-weight: 600;
}
.color-preview,
.preview-caption {
  text-align: center;
  margin: 8px 0;
}
.color-preview span {
  border-radius: 4px;
  max-width: 100%;
  display: inline-block;
  overflow-wrap: anywhere;
  padding: 3px 9px;
  font:
    500 14px Arial,
    sans-serif;
}
.preview-caption {
  color: var(--regular-text-color);
  font-size: 13px;
}
.custom-palettes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 15px 0 24px;
}
@media (max-width: 560px), (pointer: coarse) {
  .custom-palettes {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .custom-palettes :deep(.color-grid button) {
    min-height: 24px;
    max-height: 30px;
    aspect-ratio: auto;
  }
  :global(.el-dialog.color-dialog) {
    max-height: 88dvh;
    overflow: auto;
    margin: 6dvh auto;
  }
}
h3 {
  font-size: 13px;
  margin: 0 0 6px;
  font-weight: 500;
}
@media (max-width:600px), (max-height:540px) {
  :global(.el-popper.label-options-popover) { max-height:calc(100dvh - 16px); overflow-y:auto; overscroll-behavior:contain; }
}
:global(.el-popper.label-options-popover) {
  padding: 6px 0;
  border: 0;
  border-radius: 6px;
  background: var(--mail-surface);
  color: var(--regular-text-color);
  box-shadow:
    0 2px 6px 2px #3c404324,
    0 1px 2px #3c404333;
}
</style>
