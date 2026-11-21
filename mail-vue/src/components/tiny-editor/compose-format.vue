<template>
  <div
    ref="strip"
    class="format-strip"
    data-tip-placement="top"
    :class="{'with-history':showHistory}"
    role="toolbar"
    aria-label="Text formatting"
    @pointerdown.capture="remember"
  >
    <div v-if="showHistory" class="group">
      <button
        v-for="a in history"
        :key="a.command"
        :aria-label="a.label"
        :data-tip="tip(a)"
        :disabled="!active[a.command]"
        @mousedown.prevent
        @click="apply(a.command)"
      >
        <Icon :icon="icon(a)" width="18" />
      </button>
    </div>
    <div class="group">
      <FormatPicker
        v-for="picker in selectors"
        :key="picker.label"
        :label="picker.label"
        :tooltip="tip(picker)"
        :choices="picker.options"
        :value="picker.command === 'FontName' ? fontValue : sizes[sizeIndex][1]"
        @open="opened(true)"
        @choose="(value) => apply(picker.command, value)"
      >
        <span v-if="picker.command === 'FontName'" class="font-name">{{
          fontName
        }}</span>
        <Icon v-else icon="material-symbols:format-size" width="18" />
      </FormatPicker>
    </div>
    <div class="group">
      <button
        v-for="a in styles"
        :key="a.command"
        :aria-label="a.label"
        :data-tip="tip(a)"
        :aria-pressed="!!active[a.command]"
        @mousedown.prevent
        @click="apply(a.command)"
      >
        <Icon :icon="icon(a)" width="19" />
      </button>
      <FormatPopup
        v-model="colorOpen"
        label="Text color"
        role="dialog"
        panel-label="Text and background colors"
        panel-class="format-palette"
        @open="openColors"
        @ready="focusColors"
      >
        <template #trigger
          ><Icon icon="material-symbols:format-color-text" width="19" /><Icon
            icon="material-symbols:arrow-drop-down"
            width="14"
        /></template>
        <div ref="palette" class="palette-columns">
          <div v-for="group in colorGroups" :key="group.command">
            <div class="palette-heading">{{ group.label }}</div>
            <div
              role="grid"
              :aria-label="group.label"
              class="swatches"
              @keydown="navigateColors($event, group.command)"
            >
              <div
                v-for="(row, y) in colorRows"
                :key="y"
                role="row"
                class="swatch-row"
              >
                <button
                  v-for="(color, x) in row"
                  :key="color"
                  role="gridcell"
                  class="swatch"
                  :style="{ backgroundColor: color }"
                  :aria-label="group.label + ' ' + color"
                  :title="color"
                  :aria-selected="currentColors[group.command] === color"
                  :tabindex="positions[group.command] === 8 * y + x ? 0 : -1"
                  :data-position="8 * y + x"
                  @focus="positions[group.command] = 8 * y + x"
                  @mousedown.prevent
                  @click="chooseColor(group.command, color)"
                >
                  <Icon
                    v-if="currentColors[group.command] === color"
                    icon="material-symbols:check"
                    width="14"
                    :color="checkColor(color)"
                  />
                </button>
              </div>
            </div>
            <button
              :aria-label="'Default ' + group.label.toLowerCase()"
              class="default-color"
              @mousedown.prevent
              @click="chooseColor(group.command, null)"
            >
              Default
            </button>
          </div>
        </div>
      </FormatPopup>
    </div>
    <div v-if="showLists" class="group">
      <FormatPicker
        label="Align"
        tooltip="Align"
        :choices="alignmentChoices"
        :value="alignment.command"
        icons-only
        @open="opened(true)"
        @choose="(command) => apply(command)"
      >
        <Icon :icon="icon(alignment)" width="19" />
      </FormatPicker>
      <button
        v-for="a in visibleParagraph"
        :key="a.command"
        :aria-label="a.label"
        :data-tip="tip(a)"
        :aria-pressed="a.toggle ? !!active[a.command] : undefined"
        @mousedown.prevent
        @click="apply(a.command)"
      >
        <Icon :icon="icon(a)" width="18" />
      </button>
    </div>
    <FormatPicker
      label="More formatting options"
      :choices="overflowChoices"
      actions
      :icons-only="showIndent"
      @open="opened(true)"
      @choose="(command) => apply(command)"
      ><Icon icon="material-symbols:more-horiz" width="18"
    /></FormatPicker>
  </div>
</template>
<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useElementSize } from "@vueuse/core";
import { Icon } from "@iconify/vue";
import FormatPopup from "./format-popup.vue";
import FormatPicker from "./format-picker.vue";
import {
  colorRows,
  currentFont,
  currentSize,
  fonts,
  sizes,
} from "./format-options";
const props = defineProps({ editor: Object, requestFormat: Function });
const strip = ref(null),
  palette = ref(null),
  colorOpen = ref(false);
const { width } = useElementSize(computed(() => strip.value?.parentElement));
const showLists = computed(() => width.value >= 395),
  showIndent = computed(() => width.value >= 450),
  showHistory = computed(() => width.value >= 595);
const active = ref({}),
  fontName = ref("Sans Serif"),
  sizeIndex = ref(1),
  currentColors = ref({});
const positions = ref({ ForeColor: 0, HiliteColor: 7 });
let bookmark;
const selectors = [
  {
    label: "Font",
    command: "FontName",
    shortcut: "⇧5 / ⇧6",
    options: fonts.map(([name, value]) => ({
      name,
      value,
      style: { fontFamily: value },
    })),
  },
  {
    label: "Text size",
    command: "FontSize",
    shortcut: "⇧− / ⇧+",
    options: sizes.map(([name, value]) => ({
      name,
      value,
      style: { fontSize: value },
    })),
  },
];
const action = (label, command, icon, shortcut, toggle = false) => ({
  label,
  command,
  icon,
  shortcut,
  toggle,
});
const history = [
  action("Undo", "Undo", "undo", "Z"),
  action("Redo", "Redo", "redo", "⇧Z"),
];
const styles = [
  action("Bold", "Bold", "format-bold", "B"),
  action("Italic", "Italic", "format-italic", "I"),
  action("Underline", "Underline", "format-underlined", "U"),
];
const alignments = [
  action("Align left", "JustifyLeft", "format-align-left", "⇧L"),
  action("Align center", "JustifyCenter", "format-align-center", "⇧E"),
  action("Align right", "JustifyRight", "format-align-right", "⇧R"),
];
const lists = [
  action(
    "Numbered list",
    "InsertOrderedList",
    "format-list-numbered",
    "⇧7",
    true,
  ),
  action(
    "Bulleted list",
    "InsertUnorderedList",
    "format-list-bulleted",
    "⇧8",
    true,
  ),
];
const indents = [
  action("Indent less", "Outdent", "format-indent-decrease", "["),
  action("Indent more", "Indent", "format-indent-increase", "]"),
];
const extra = [
  action("Remove formatting", "RemoveFormat", "format-clear", "\\"),
  action("Strikethrough", "Strikethrough", "format-strikethrough", "⇧X"),
  action("Quote", "mceBlockQuote", "format-quote", "⇧9"),
];
const editing = [
  action("Insert table", "mceInsertTableDialog", "table-chart-outline"),
  action("Edit HTML", "mceCodeEditor", "code"),
  action("Preview", "mcePreview", "visibility-outline"),
];
const tracked = [
  ...styles,
  ...alignments,
  ...lists,
  ...extra.filter((a) => a.command !== "RemoveFormat"),
];
const visibleParagraph = computed(() =>
  showIndent.value ? [...lists, ...indents] : lists,
);
const overflow = computed(() => [
  ...(!showLists.value ? [...alignments, ...lists] : []),
  ...(!showIndent.value ? indents : []),
  ...extra,
  ...(!showHistory.value ? history : []),
  ...editing,
]);
const alignment = computed(
  () => alignments.find((a) => active.value[a.command]) || alignments[0],
);
const icon = (a) => "material-symbols:" + a.icon;
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
function shortcut(a) {
  return a.shortcut
    .split(" / ")
    .map((s) => (mac ? "⌘" + s : "Ctrl+" + s.replace("⇧", "Shift+")))
    .join(" / ");
}
const tip = (a) => (a.shortcut ? a.label + " (" + shortcut(a) + ")" : a.label);
const fontValue = computed(
  () => fonts.find(([name]) => name === fontName.value)?.[1],
);
const alignmentChoices = alignments.map((a) => ({
  name: a.label,
  value: a.command,
  icon: icon(a),
  tooltip: tip(a),
}));
const overflowChoices = computed(() =>
  overflow.value.map((a) => ({
    name: a.label,
    value: a.command,
    icon: icon(a),
    tooltip: tip(a),
    disabled: history.includes(a) && !active.value[a.command],
  })),
);
const colorGroups = [
  { label: "Background color", command: "HiliteColor" },
  { label: "Text color", command: "ForeColor" },
];
function hexColor(value) {
  if (/^#[a-f\d]{6}$/i.test(value)) return value.toLowerCase();
  const rgb = value?.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
  return rgb
    ? "#" +
        rgb
          .slice(1)
          .map((n) => Number(n).toString(16).padStart(2, "0"))
          .join("")
    : null;
}
function checkColor(hex) {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16));
  return (299 * r + 587 * g + 114 * b) / 1000 > 145 ? "#202124" : "#ffffff";
}
function update() {
  const ed = props.editor;
  if (!ed?.initialized || ed.removed) return;
  active.value = {
    Undo: ed.undoManager.hasUndo(),
    Redo: ed.undoManager.hasRedo(),
    ...Object.fromEntries(
      tracked.map((a) => [a.command, ed.queryCommandState(a.command)]),
    ),
  };
  fontName.value = currentFont(ed);
  sizeIndex.value = currentSize(ed);
}
function readColors(ed) {
  const node = ed.selection.getStart(true);
  let background = null;
  for (let n = node; n && n !== ed.getBody(); n = n.parentElement) {
    background = hexColor(ed.dom.getStyle(n, "background-color", true));
    if (background) break;
  }
  currentColors.value = {
    ForeColor: hexColor(ed.dom.getStyle(node, "color", true)),
    HiliteColor: background,
  };
}
function remember() {
  const ed = props.editor;
  if (!ed?.initialized || ed.removed) return;
  // TinyMCE's normalized bookmarks omit its temporary caret character. Keep the
  // live DOM range so changing another format immediately after typing stays put.
  const range = ed.selection.getRng().cloneRange();
  bookmark = {
    range,
    start: range.startContainer,
    end: range.endContainer,
    fallback: ed.selection.getBookmark(2, true),
  };
}
function opened(visible) {
  if (visible) {
    remember();
    update();
  }
}
watch(
  () => props.editor,
  (ed, old, cleanup) => {
    bookmark = null;
    if (!ed) return;
    const events = "NodeChange Undo Redo AddUndo init";
    ed.on(events, update);
    ed.on("blur", remember);
    update();
    cleanup(() => {
      ed.off(events, update);
      ed.off("blur", remember);
    });
  },
  { immediate: true },
);
function editingSelection() {
  const ed = props.editor;
  if (!ed?.initialized || ed.removed) return;
  const saved = bookmark;
  bookmark = null;
  ed.focus();
  if (saved) {
    const body = ed.getBody();
    if (body.contains(saved.start) && body.contains(saved.end))
      ed.selection.setRng(saved.range, saved.fallback.forward);
    else ed.selection.moveToBookmark(saved.fallback);
  }
  return ed;
}
function apply(command, value) {
  const ed = editingSelection();
  if (!ed) return;
  if (props.requestFormat && command !== "Undo" && command !== "Redo") {
    props.requestFormat(command, value);
    return;
  }
  ed.execCommand(command, false, value);
  ed.nodeChanged();
  update();
}
function openColors() {
  opened(true);
  if (!props.editor?.initialized || props.editor.removed) return;
  readColors(props.editor);
  for (const { command } of colorGroups) {
    const index = colorRows.flat().indexOf(currentColors.value[command]);
    positions.value[command] =
      index >= 0 ? index : command === "ForeColor" ? 0 : 7;
  }
}
async function focusColors() {
  await nextTick();
  if (colorOpen.value)
    palette.value
      ?.querySelector('[role="gridcell"][tabindex="0"]')
      ?.focus({ preventScroll: true });
}
function chooseColor(command, color) {
  colorOpen.value = false;
  if (color) {
    apply(command, color);
    return;
  }
  const ed = editingSelection();
  if (!ed) return;
  ed.undoManager.transact(() =>
    ed.formatter.remove(command === "ForeColor" ? "forecolor" : "hilitecolor"),
  );
  ed.nodeChanged();
  ed.dispatch("change");
  update();
}
function navigateColors(event, command) {
  const pos = positions.value[command],
    row = Math.floor(pos / 8) * 8;
  const next = {
    ArrowLeft: Math.max(row, pos - 1),
    ArrowRight: Math.min(row + 7, pos + 1),
    ArrowUp: Math.max(pos % 8, pos - 8),
    ArrowDown: Math.min(56 + (pos % 8), pos + 8),
    Home: event.ctrlKey ? 0 : row,
    End: event.ctrlKey ? 63 : row + 7,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.querySelector('[data-position="' + next + '"]')?.focus();
}
</script>
<style scoped>
.format-strip {
  display: flex;
  align-items: center;
  align-self: flex-start;
  width: min(100%, 521px);
  justify-content: space-between;
  box-sizing: border-box;
  max-width: 100%;
  flex-shrink: 0;
  gap: 3px;
  padding: 6px 8px;
  min-height: 40px;
  border-radius: 22px;
  background: var(--mail-compose-header);
}
.format-strip.with-history { width: min(100%, 595px); }
.group {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 3px;
  border-right: 1px solid var(--light-border-color);
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--regular-text-color);
  cursor: pointer;
  font:
    13px Arial,
    sans-serif;
}
.format-strip :deep(button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--regular-text-color);
  font:
    13px Arial,
    sans-serif;
  height: 28px;
  min-width: 24px;
  padding: 0 3px;
  border-radius: 4px;
}
.format-strip :deep(button:hover),
.default-color:hover {
  background: var(--mail-hover);
}
.format-strip :deep(button[aria-pressed="true"]) {
  background: var(--mail-selected);
  color: var(--el-color-primary);
}
.format-strip :deep(button:disabled) {
  opacity: 0.4;
  cursor: default;
}
.font-name {
  min-width: 66px;
  max-width: 74px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:global(.format-palette.format-popup) {
  width: min(326px, calc(100vw - 12px));
  padding: 10px;
}
.palette-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.palette-heading {
  font:
    500 13px/20px Arial,
    sans-serif;
  margin-bottom: 4px;
  color: var(--el-text-color-primary);
}
.swatches {
  display: grid;
  gap: 1px;
}
.swatch-row {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 1px;
}
.swatch {
  box-sizing: border-box;
  width: 100%;
  height: 17px;
  border: 1px solid #0002;
  padding: 0;
}
.swatch:hover,
.swatch:focus-visible {
  outline: 2px solid var(--el-text-color-primary);
  outline-offset: -1px;
  z-index: 1;
}
.default-color {
  margin-top: 6px;
  padding: 4px 6px;
  border-radius: 4px;
}
.default-color:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
@container compose-editor (max-width:440px) {
  .font-name {
    min-width: 0;
    max-width: 68px;
  }
  .format-strip {
    gap: 2px;
    padding-inline: 5px;
  }
}
@container compose-editor (max-width:305px) {
  .format-strip :deep(button) {
    min-width: 20px;
    padding: 0 1px;
  }
  .font-name {
    max-width: 45px;
  }
  .group {
    gap: 0;
  }
}
</style>
