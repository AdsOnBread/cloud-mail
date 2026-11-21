<template>
  <FormatPopup :model-value="opened" @update:model-value="setOpen" @ready="search?.focus()"
    label="Insert emoji" :tooltip="hint" role="dialog" panel-label="Insert emoji"
    panel-class="compose-emoji-popup" trigger-class="compose-emoji-trigger" :disabled="disabled">
    <template #trigger><Icon icon="material-symbols:mood-outline" width="20" /></template>
    <div class="picker" @keydown="navigate">
      <label class="search">
        <Icon icon="material-symbols:search" width="20" />
        <input ref="search" v-model="query" type="text" aria-label="Search emoji" placeholder="Search"
          autocomplete="off" spellcheck="false" />
      </label>
      <div role="tablist" aria-label="Emoji categories" class="tabs">
        <button v-for="([label,icon], index) in categories" :key="label" type="button" role="tab"
          :aria-label="label" :data-tip="label" :aria-selected="activeTab === index" :aria-controls="panelId"
          :tabindex="index === Math.max(0,activeTab) ? 0 : -1" @click="goTo(index)"
          @keydown="tabKey($event,index)">
          <Icon :icon="'material-symbols:'+icon" width="19" />
        </button>
      </div>
      <div :id="panelId" role="tabpanel" aria-label="Emoji" class="results">
        <div v-if="failed" role="status" class="empty">Couldn’t load emoji.<button type="button" @click="load">Try again</button></div>
        <div v-else-if="!entries" role="status" class="empty">Loading emoji…</div>
        <div v-else-if="!rows.length" role="status" class="empty">No emoji found.<br>Try a different keyword.</div>
        <div v-else ref="scroller" class="scroll" role="menu" :aria-label="searching ? 'Emoji search results' : 'Browse emoji list'"
          @scroll="scrollTop = $event.target.scrollTop">
          <div :style="{ height: rows.length * rowHeight + 'px' }" class="rows">
            <div v-for="(row, offset) in visibleRows" :key="firstRow + offset" class="row"
              :style="{ top: (firstRow + offset) * rowHeight + 'px' }">
              <div v-if="row.heading" class="heading">{{ row.heading }}</div>
              <div v-else-if="row.note" class="note">{{ row.note }}</div>
              <template v-else>
                <button v-for="(item, col) in row.items" :key="item.unicode" type="button" role="menuitem"
                  :data-row="firstRow+offset" :data-col="col" :aria-label="item.label" :data-tip="item.label"
                  :tabindex="(firstRow + offset === firstEmoji && col === 0) ? 0 : -1"
                  @contextmenu="variants($event,item)" @keydown.shift.f10="variants($event,item)"
                  @click="choose(item)">{{ item.unicode }}</button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </FormatPopup>
</template>

<script setup>
import { computed, nextTick, ref, shallowRef, useId, watch } from "vue";
import { useElementSize } from "@vueuse/core";
import { Icon } from "@iconify/vue";
import FormatPopup from "../tiny-editor/format-popup.vue";
import { useUiStore } from "@/store/ui";
import { categories, loadEmoji, searchEmoji } from "./emoji-catalog";

const props = defineProps({ editor: Object, owner: String, active: Boolean, disabled: Boolean });
const ui = useUiStore();
const hint = /Mac|iPhone|iPad/.test(navigator.platform) ? "Insert emoji (⌘⇧2)" : "Insert emoji (Ctrl+Shift+2)";
const panelId = useId();
const opened = ref(false), search = ref(null), scroller = ref(null), scrollTop = ref(0);
const query = ref(""), failed = ref(false), entries = shallowRef(null);
const skinChoices = shallowRef(null);
const { width, height } = useElementSize(scroller);
const rowHeight = 40;
const columns = computed(() => Math.max(1, Math.min(9, Math.floor(((width.value || 370) - 8) / 40))));
const searching = computed(() => Boolean(query.value.trim() || skinChoices.value));
const recent = computed(() => ui.recentEmoji[props.owner] || []);
const rows = computed(() => {
  if (!entries.value) return [];
  const result = [];
  function add(items, tab) {
    for (let start = 0; start < items.length; start += columns.value)
      result.push({ items: items.slice(start, start + columns.value), tab });
  }
  if (searching.value) add(skinChoices.value || searchEmoji(entries.value, query.value), -1);
  else {
    categories.forEach(([heading, , group], tab) => {
      result.push({ heading, tab });
      if (tab === 0 && !recent.value.length)
        result.push({ note: "You haven't used any emojis yet.", tab });
      add(tab === 0 ? recent.value : entries.value.filter(item => item.group === group), tab);
    });
  }
  return result;
});
const activeTab = computed(() => searching.value ? -1 : rows.value[Math.floor(scrollTop.value / rowHeight)]?.tab ?? 0);
const firstRow = computed(() => Math.max(0, Math.floor(scrollTop.value / rowHeight) - 1));
const visibleRows = computed(() => rows.value.slice(firstRow.value,
  firstRow.value + Math.ceil((height.value || 260) / rowHeight) + 3));
const firstEmoji = computed(() => {
  const firstVisible = Math.ceil(scrollTop.value / rowHeight);
  return rows.value.findIndex((row, index) => index >= firstVisible && row.items);
});

let restoreSelection;
let opening = 0;
async function load() {
  failed.value = false;
  try { entries.value = await loadEmoji(); }
  catch { failed.value = true; }
}
function setOpen(value) {
  if (value && (!props.active || props.disabled)) return;
  if (value === opened.value) return;
  opening++;
  opened.value = value;
  if (value) {
    restoreSelection = props.editor?.rememberSelection();
    query.value = "";
    skinChoices.value = null;
    scrollTop.value = 0;
    if (!entries.value) load();
  } else restoreSelection = undefined;
}
defineExpose({ open: () => setOpen(true) });
watch(() => [props.active, props.disabled, props.owner, props.editor], () => setOpen(false));

function scrollTo(top) {
  if (scroller.value) scroller.value.scrollTop = top;
  scrollTop.value = scroller.value?.scrollTop || 0;
}
watch(query, () => { skinChoices.value = null; scrollTo(0); }, { flush: "sync" });
async function goTo(index) {
  skinChoices.value = null;
  query.value = "";
  await nextTick();
  const target = rows.value.findIndex(row => row.heading && row.tab === index);
  if (target >= 0) scrollTo(target * rowHeight);
}
function tabKey(event, index) {
  const delta = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  const next = delta ? (index + delta + categories.length) % categories.length :
    event.key === "Home" ? 0 : event.key === "End" ? categories.length - 1 : null;
  if (next === null) return;
  event.preventDefault();
  event.currentTarget.parentElement.children[next].focus();
  goTo(next);
}
async function choose(item) {
  const epoch = opening, editor = props.editor;
  await editor?.ready();
  if (!opened.value || epoch !== opening || editor !== props.editor || props.disabled || !props.active) return;
  restoreSelection?.();
  if (editor?.insertEmoji(item.unicode)) {
    const saved = { label: item.label, unicode: item.unicode };
    ui.recentEmoji[props.owner] = [saved, ...recent.value.filter(other => other.unicode !== item.unicode)].slice(0, 27);
  }
  setOpen(false);
}
async function focusItem(row, col) {
  if (!scroller.value || !rows.value[row]?.items) return;
  const top = row * rowHeight, bottom = top + rowHeight;
  if (top < scrollTop.value) scrollTo(top);
  else if (bottom > scrollTop.value + scroller.value.clientHeight)
    scrollTo(bottom - scroller.value.clientHeight);
  await nextTick();
  scroller.value?.querySelector('[data-row="' + row + '"][data-col="' + col + '"]')?.focus({ preventScroll: true });
}
async function variants(event, item) {
  const original = item.skins ? item : entries.value?.find(other =>
    other.unicode === item.unicode || other.skins?.some(skin => skin.unicode === item.unicode));
  if (!original?.skins?.length) return;
  event.preventDefault();
  skinChoices.value = [original, ...original.skins];
  scrollTo(0);
  await nextTick();
  const index = skinChoices.value?.findIndex(choice => choice.unicode === item.unicode) ?? -1;
  if (index >= 0) focusItem(Math.floor(index / columns.value), index % columns.value);
}
function navigate(event) {
  if (skinChoices.value && event.key === "Escape") {
    event.stopPropagation();
    event.preventDefault();
    skinChoices.value = null;
    search.value?.focus();
    return;
  }
  const key = event.key, button = event.target.closest("button[data-row]");
  if (!button) {
    if ((key === "ArrowDown" || (key === "Enter" && event.target === search.value)) && firstEmoji.value >= 0 && rows.value[firstEmoji.value]?.items) {
      event.preventDefault();
      focusItem(firstEmoji.value, 0);
    }
    return;
  }
  if (!["Home","End","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(key)) return;
  event.preventDefault();
  let row = Number(button.dataset.row), col = Number(button.dataset.col);
  let delta = 0;
  if (key === "Home") col = 0;
  if (key === "End") col = rows.value[row].items.length - 1;
  if (key === "ArrowUp") delta = -1;
  if (key === "ArrowDown") delta = 1;
  if (key === "ArrowLeft" && --col < 0) { delta = -1; col = columns.value - 1; }
  if (key === "ArrowRight" && ++col >= rows.value[row].items.length) { delta = 1; col = 0; }
  if (delta) {
    do { row += delta; } while (rows.value[row] && !rows.value[row].items);
  }
  if (row < 0) search.value?.focus();
  else if (rows.value[row]) focusItem(row, Math.min(col, rows.value[row].items.length - 1));
}
</script>

<style scoped>
:global(.compose-emoji-trigger) {display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:50%;color:var(--regular-text-color);cursor:pointer}
:global(.compose-emoji-trigger:hover), :global(.compose-emoji-trigger[aria-expanded="true"]) {background:var(--base-fill)}
:global(.compose-emoji-popup.format-popup) {width:370px;height:340px;overflow:hidden;border:0;border-radius:8px;box-shadow:0 2px 6px #0003,0 8px 24px #0002}
.picker {display:flex;flex-direction:column;height:100%;min-height:0;font:14px Arial,sans-serif;color:var(--el-text-color-primary)}
.search {display:flex;align-items:center;gap:8px;flex:none;height:32px;margin:8px;padding:0 12px;background:var(--base-fill);border-radius:20px;color:var(--regular-text-color)}
.search input {flex:1;width:0;outline:0;background:transparent;color:inherit;font:inherit}
.tabs {display:flex;align-items:center;justify-content:space-around;height:42px;flex:none;margin:0 4px;border-bottom:1px solid var(--light-border-color)}
.tabs button {position:relative;display:grid;place-items:center;flex:1;min-width:0;height:36px;color:var(--regular-text-color);border-radius:50%;cursor:pointer}
.tabs button[aria-selected="true"] {color:var(--el-color-primary)}
.tabs button[aria-selected="true"]::after {content:"";position:absolute;bottom:-3px;width:24px;height:3px;background:currentColor;border-radius:4px 4px 0 0}
.tabs button:hover,.row button:hover {background:var(--base-fill)}
.results,.scroll {min-height:0;flex:1}
.results {display:flex}
.scroll {overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.rows {position:relative}
.row {display:flex;align-items:center;position:absolute;left:4px;right:4px;height:40px}
.row button {display:grid;place-items:center;width:40px;height:40px;flex:none;cursor:pointer;border-radius:50%;font:24px/1 "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}
.heading,.note {padding:0 8px}
.heading {font-weight:500}
.note,.empty {color:var(--regular-text-color)}
.empty {margin:auto;text-align:center;line-height:1.5}
.empty button {display:block;margin:4px auto;color:var(--el-color-primary);cursor:pointer}
.picker button:focus-visible {outline:2px solid var(--el-color-primary);outline-offset:-2px}
</style>
