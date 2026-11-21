<template>
  <div class="format-strip" role="toolbar" aria-label="Text formatting">
    <div class="group">
      <button
        v-for="action in history"
        :key="action.command"
        :aria-label="action.label"
        :data-tip="action.label"
        :disabled="!active[action.command]"
        @mousedown.prevent
        @click="apply(action.command)"
      >
        <Icon :icon="'material-symbols:' + action.icon" width="18" />
      </button>
    </div>
    <div class="group">
      <el-dropdown
        v-for="picker in selectors"
        :key="picker.label"
        trigger="click"
        placement="top-start"
        :show-arrow="false"
        popper-class="mail-action-menu compose-format-popup"
        @command="(value) => apply(picker.command, value)"
      >
        <button
          :aria-label="picker.label"
          :data-tip="picker.label"
          @mousedown.prevent
        >
          <span v-if="picker.command === 'FontName'" class="font-name">{{
            fontName
          }}</span>
          <Icon v-else icon="material-symbols:format-size" width="18" />
          <Icon icon="material-symbols:arrow-drop-down" width="14" />
        </button>
        <template #dropdown
          ><el-dropdown-menu>
            <el-dropdown-item
              v-for="[name, value] in picker.options"
              :key="value"
              :command="value"
              :style="
                picker.command === 'FontName'
                  ? { fontFamily: value }
                  : { fontSize: value }
              "
              >{{ name }}</el-dropdown-item
            >
          </el-dropdown-menu></template
        >
      </el-dropdown>
    </div>
    <div class="group">
      <button
        v-for="action in styles"
        :key="action.command"
        :aria-label="action.label"
        :data-tip="action.label"
        :aria-pressed="Boolean(active[action.command])"
        @mousedown.prevent
        @click="apply(action.command)"
      >
        <Icon :icon="'material-symbols:' + action.icon" width="19" />
      </button>
      <el-popover
        v-model:visible="colorOpen"
        trigger="click"
        placement="top"
        :show-arrow="false"
        :width="300"
        popper-class="format-palette compose-format-popup"
      >
        <template #reference
          ><button
            aria-label="Text color"
            data-tip="Text color"
            :aria-expanded="colorOpen"
            @mousedown.prevent
          >
            <Icon icon="material-symbols:format-color-text" width="19" /><Icon
              icon="material-symbols:arrow-drop-down"
              width="14"
            /></button
        ></template>
        <div class="palette-columns">
          <div
            v-for="group in colorGroups"
            :key="group.command"
            role="group"
            :aria-label="group.label"
          >
            <div class="palette-heading">{{ group.label }}</div>
            <div class="swatches">
              <button
                v-for="color in colors"
                :key="color"
                class="swatch"
                :style="{ backgroundColor: color }"
                :aria-label="group.label + ' ' + color"
                @mousedown.prevent
                @click="
                  apply(group.command, color);
                  colorOpen = false;
                "
              />
            </div>
            <button
              class="default-color"
              @mousedown.prevent
              @click="
                clearColor(group.format);
                colorOpen = false;
              "
            >
              Default
            </button>
          </div>
        </div>
      </el-popover>
    </div>
    <div class="group extra-format">
      <button
        v-for="action in paragraph.slice(0, 3)"
        :key="action.command"
        :aria-label="action.label"
        :data-tip="action.label"
        @mousedown.prevent
        @click="apply(action.command)"
      >
        <Icon :icon="'material-symbols:' + action.icon" width="18" />
      </button>
    </div>
    <el-dropdown
      trigger="click"
      placement="top-end"
      :show-arrow="false"
      popper-class="mail-action-menu compose-format-popup"
      @command="more"
    >
      <button
        aria-label="More formatting options"
        data-tip="More formatting options"
        @mousedown.prevent
      >
        <Icon icon="material-symbols:more-horiz" width="18" />
      </button>
      <template #dropdown
        ><el-dropdown-menu>
          <el-dropdown-item
            v-for="action in paragraph"
            :key="action.command"
            :command="action"
          >
            <Icon :icon="'material-symbols:' + action.icon" width="18" />{{
              action.label
            }}
          </el-dropdown-item>
        </el-dropdown-menu></template
      >
    </el-dropdown>
  </div>
</template>
<script setup>
import { ref, watch } from "vue";
import { Icon } from "@iconify/vue";
const props = defineProps({ editor: Object });
const colorOpen = ref(false),
  active = ref({}),
  fontName = ref("Sans Serif");
const fonts = [
  ["Sans Serif", "arial,helvetica,sans-serif"],
  ["Serif", "georgia,serif"],
  ["Fixed Width", "monospace"],
  ["Wide", "verdana,sans-serif"],
  ["Narrow", "arial narrow,sans-serif"],
  ["Comic Sans MS", "comic sans ms,sans-serif"],
  ["Garamond", "garamond,serif"],
  ["Tahoma", "tahoma,sans-serif"],
  ["Trebuchet MS", "trebuchet ms,sans-serif"],
];
const selectors = [
  { label: "Font", command: "FontName", options: fonts },
  {
    label: "Text size",
    command: "FontSize",
    options: [
      ["Small", "10px"],
      ["Normal", "14px"],
      ["Large", "18px"],
      ["Huge", "32px"],
    ],
  },
];
const action = (label, command, icon, value) => ({
  label,
  command,
  icon,
  value,
});
const history = [
  action("Undo", "Undo", "undo"),
  action("Redo", "Redo", "redo"),
];
const styles = [
  action("Bold", "Bold", "format-bold"),
  action("Italic", "Italic", "format-italic"),
  action("Underline", "Underline", "format-underlined"),
];
const paragraph = [
  action("Align left", "JustifyLeft", "format-align-left"),
  action("Numbered list", "InsertOrderedList", "format-list-numbered"),
  action("Bulleted list", "InsertUnorderedList", "format-list-bulleted"),
  action("Align center", "JustifyCenter", "format-align-center"),
  action("Align right", "JustifyRight", "format-align-right"),
  action("Indent less", "Outdent", "format-indent-decrease"),
  action("Indent more", "Indent", "format-indent-increase"),
  action("Quote", "mceBlockQuote", "format-quote"),
  action("Strikethrough", "Strikethrough", "format-strikethrough"),
  action("Remove formatting", "RemoveFormat", "format-clear"),
  action("Insert table", "mceInsertTableDialog", "table-chart-outline"),
  action("Edit HTML", "mceCodeEditor", "code"),
  action("Preview", "mcePreview", "visibility-outline"),
];
const colorGroups = [
  { label: "Background color", command: "HiliteColor", format: "hilitecolor" },
  { label: "Text color", command: "ForeColor", format: "forecolor" },
];
const colors = [
  "#000000",
  "#434343",
  "#666666",
  "#999999",
  "#b7b7b7",
  "#cccccc",
  "#efefef",
  "#ffffff",
  "#cc0000",
  "#ff9900",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0000ff",
  "#9900ff",
  "#ff00ff",
  "#e6b8af",
  "#fce5cd",
  "#fff2cc",
  "#d9ead3",
  "#d0e0e3",
  "#c9daf8",
  "#d9d2e9",
  "#ead1dc",
  "#cc4125",
  "#e69138",
  "#f1c232",
  "#6aa84f",
  "#45818e",
  "#3c78d8",
  "#674ea7",
  "#a64d79",
];
function update() {
  const ed = props.editor;
  if (!ed?.initialized) return;
  active.value = {
    Undo: ed.undoManager.hasUndo(),
    Redo: ed.undoManager.hasRedo(),
    ...Object.fromEntries(
      styles.map((a) => [a.command, ed.queryCommandState(a.command)]),
    ),
  };
  const font = String(ed.queryCommandValue("FontName") || "")
    .split(",")[0]
    .replace(/["']/g, "")
    .trim()
    .toLowerCase();
  fontName.value =
    fonts.find(([, value]) => value.split(",")[0] === font)?.[0] ||
    "Sans Serif";
}
watch(
  () => props.editor,
  (ed, old, cleanup) => {
    if (!ed) return;
    const events = "NodeChange Undo Redo AddUndo init";
    ed.on(events, update);
    update();
    cleanup(() => ed.off(events, update));
  },
  { immediate: true },
);
function apply(command, value) {
  const ed = props.editor;
  if (!ed?.initialized) return;
  ed.focus();
  ed.execCommand(command, false, value);
  ed.nodeChanged();
  update();
}
function clearColor(format) {
  const ed = props.editor;
  ed.focus();
  ed.undoManager.transact(() => ed.formatter.remove(format));
  ed.nodeChanged();
  ed.dispatch("change");
}
function more(action) {
  apply(action.command, action.value);
}
</script>
<style scoped>
.format-strip {
  display: flex;
  align-items: center;
  align-self: stretch;
  max-width: 100%;
  padding: 4px 7px;
  flex-shrink: 0;
  gap: 1px;
  border: 0;
  border-radius: 20px;
  background: var(--mail-compose-header);
}
.group {
  display: flex;
  align-items: center;
  padding-right: 2px;
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
.format-strip button {
  height: 28px;
  min-width: 25px;
  padding: 0 3px;
  border-radius: 3px;
}
.format-strip button:hover,
.default-color:hover {
  background: var(--mail-hover);
}
.format-strip button[aria-pressed="true"] {
  color: var(--el-color-primary);
  background: var(--mail-selected);
}
.font-name {
  max-width: 74px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.palette-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.palette-heading {
  font-weight: 500;
  margin-bottom: 8px;
  font-size: 13px;
}
.swatches {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 1px;
}
.swatch {
  height: 16px;
  border: 1px solid #0002;
}
.swatch:hover,
.swatch:focus-visible {
  outline: 2px solid var(--el-color-primary);
  z-index: 1;
}
.default-color {
  margin-top: 8px;
  padding: 4px 6px;
}
@container compose-editor (max-width:425px) {
  .extra-format {
    display: none;
  }
}
@container compose-editor (max-width:305px) {
  .format-strip button {
    min-width: 20px;
    padding: 0 1px;
  }
  .font-name {
    max-width: 42px;
  }
}
</style>
