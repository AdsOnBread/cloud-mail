<template>
  <div ref="root" class="spell-layer">
    <button v-for="mark in boxes" :key="mark.key" type="button" class="word-mark" :style="mark.style"
      :aria-label="mark.issue.word" aria-haspopup="menu" :tabindex="mark.first ? 0 : -1"
      @mousedown.prevent @click="correct(mark.issue, $event.currentTarget)" />
    <div ref="bar" role="toolbar" aria-label="Spell Check" class="spell-bar">
      <button type="button" :disabled="busy" @click="scan">Recheck</button>
      <button type="button" aria-label="Language" data-tip="Language" aria-haspopup="menu"
        :aria-expanded="popup === 'language'" @click="openLanguages($event.currentTarget)">
        <Icon icon="material-symbols:arrow-drop-down" width="18" />
      </button>
      <button type="button" aria-label="Close spell check" data-tip="Close spell check" @click="finish">
        <Icon icon="material-symbols:close" width="18" />
      </button>
    </div>
    <span role="status" :class="{'spell-status':error, 'sr-only':!error}">{{ status }}</span>
  </div>
  <Teleport to="body">
    <div v-if="popup" ref="menu" role="menu" :aria-label="popup === 'language' ? 'Spelling language' : 'Spelling suggestions'"
      class="compose-format-popup spell-menu" :style="menuStyle" @keydown="menuKeys">
      <template v-if="popup === 'language'">
        <button v-for="[id,,label] in choices" :key="id" role="menuitemcheckbox" :aria-checked="id === language"
          @click="chooseLanguage(id)"><Icon v-if="id === language" icon="material-symbols:check" width="18" />{{ label }}</button>
      </template>
      <template v-else>
        <button v-for="value in suggestions" :key="value" role="menuitem" @click="replace(value)">{{ value }}</button>
        <hr v-if="suggestions.length">
        <button role="menuitem" @click="ignore">Ignore</button>
      </template>
    </div>
  </Teleport>
</template>

<script setup>
import {nextTick, onBeforeUnmount, onMounted, ref, shallowRef} from 'vue';
import {Icon} from '@iconify/vue';
import {languages} from './languages';
import {collectWords} from './words';

const props = defineProps({editor:{type:Object, required:true}});
const emit = defineEmits(['close']);
const language = defineModel('language', {default:'auto'});
const choices = [['auto','','Auto'], ...languages];
const root = ref(), bar = ref(), menu = ref();
const busy = ref(false), error = ref(false), status = ref('');
const boxes = shallowRef([]), suggestions = ref([]), popup = ref(''), menuStyle = ref({});
let issues = [], selected, opener, worker, pending, revision = 0, frame, observer, destroyed = false;
const ed = props.editor;

function finish() {
  emit('close');
  ed.focus();
}
function dismiss(restore = false) {
  popup.value = '';
  selected = undefined;
  if (restore && opener?.isConnected) opener.focus({preventScroll:true});
  opener = undefined;
}
function outside(event) {
  if (!menu.value?.contains(event.target) && !root.value?.contains(event.target)) dismiss();
}
function menuKeys(event) {
  const items = Array.from(menu.value.querySelectorAll('button'));
  const index = items.indexOf(document.activeElement);
  if (event.key === 'Escape') { event.stopPropagation(); dismiss(true); }
  else if (event.key === 'Tab') { dismiss(true); return; }
  else if (event.key === 'Home') items[0]?.focus();
  else if (event.key === 'End') items.at(-1)?.focus();
  else if (event.key === 'ArrowDown') items[(index + 1) % items.length]?.focus();
  else if (event.key === 'ArrowUp') items[(index + items.length - 1) % items.length]?.focus();
  else return;
  event.preventDefault();
}
function valid(issue) {
  return ed.getBody().contains(issue.range.commonAncestorContainer) && issue.range.toString() === issue.word;
}
function draw() {
  frame = undefined;
  if (destroyed) return;
  const area = root.value.getBoundingClientRect();
  const viewport = ed.iframeElement.getBoundingClientRect();
  const marks = [];
  for (const issue of issues) {
    if (!valid(issue)) continue;
    let part = 0;
    for (const rect of issue.range.getClientRects()) {
      const x = Math.max(0, rect.left), y = Math.max(0, rect.top);
      const width = Math.min(rect.right, viewport.width) - x;
      const height = Math.min(rect.bottom, viewport.height) - y;
      if (width <= 0 || height <= 0) continue;
      marks.push({issue, key:issue.index + '-' + part, first:part++ === 0, style:{
        left:(viewport.left - area.left + x) + 'px', top:(viewport.top - area.top + y) + 'px',
        width:width + 'px', height:height + 'px',
      }});
    }
  }
  boxes.value = marks;
  if (popup.value) nextTick(place);
}
function redraw() {
  if (!frame) frame = requestAnimationFrame(draw);
}
function place() {
  if (!menu.value) return;
  if (!opener?.isConnected) { dismiss(); return; }
  const rect = opener.getBoundingClientRect(), panel = menu.value.getBoundingClientRect();
  const above = popup.value === 'language' || rect.bottom + panel.height > innerHeight - 8;
  menuStyle.value = {
    left:Math.max(8, Math.min(rect.left, innerWidth - panel.width - 8)) + 'px',
    top:Math.max(8, Math.min(above ? rect.top - panel.height : rect.bottom, innerHeight - panel.height - 8)) + 'px',
  };
}
async function display(type, trigger) {
  popup.value = type;
  opener = trigger;
  await nextTick();
  if (!menu.value || opener !== trigger) return;
  place();
  (menu.value.querySelector('[aria-checked=true]') || menu.value.querySelector('button'))?.focus({preventScroll:true});
  if (type === 'language') document.activeElement?.scrollIntoView({block:'nearest'});
}
function openLanguages(trigger) {
  if (popup.value === 'language') { dismiss(true); return; }
  selected = undefined;
  display('language', trigger);
}
function chooseLanguage(id) {
  language.value = id;
  dismiss(true);
  nextTick(scan);
}
function ask(message, receive) {
  const id = ++revision;
  pending = {id, receive};
  if (!worker) {
    worker = new Worker(new URL('./spelling.worker.js', import.meta.url), {type:'module'});
    worker.onmessage = ({data}) => {
      if (data.id !== pending?.id) return;
      const callback = pending.receive;
      pending = undefined;
      if (data.error) failed();
      else callback(data);
    };
    worker.onerror = failed;
  }
  worker.postMessage({id, ...message});
}
function failed() {
  worker?.terminate();
  worker = pending = undefined;
  busy.value = false;
  error.value = true;
  status.value = 'Spell check unavailable. Select Recheck to try again.';
}
function scan() {
  dismiss();
  busy.value = true;
  error.value = false;
  status.value = 'Checking spelling';
  const words = collectWords(ed.getBody());
  issues = [];
  redraw();
  try {
    ask({type:'check', language:language.value, locales:navigator.languages,
      sample:words.slice(0, 200).map(item => item.word).join(' '),
      words:Array.from(new Set(words.map(item => item.word))),
      base:new URL(import.meta.env.BASE_URL, document.baseURI).href}, ({wrong}) => {
      const invalid = new Set(wrong);
      issues = words.filter(item => invalid.has(item.word) && valid(item));
      issues.forEach((issue, index) => { issue.index = index; });
      busy.value = false;
      status.value = 'Spell checking completed';
      redraw();
    });
  } catch { failed(); }
}
function correct(issue, trigger) {
  if (busy.value || !valid(issue)) return;
  dismiss();
  selected = issue;
  ask({type:'suggest', word:issue.word}, data => {
    if (selected !== issue || !valid(issue) || !trigger.isConnected) return;
    suggestions.value = data.suggestions;
    display('suggest', trigger);
  });
}
function ignore() {
  issues = issues.filter(issue => issue !== selected);
  dismiss();
  redraw();
  ed.focus();
}
function replace(value) {
  const issue = selected;
  if (!issue || !valid(issue)) { dismiss(); return; }
  ed.focus();
  ed.selection.setRng(issue.range);
  ed.undoManager.transact(() => { ed.insertContent(ed.dom.encode(value)); });
  ed.nodeChanged();
  ed.dispatch('change');
  ignore();
}
function edited() {
  if (selected && !valid(selected)) dismiss();
  redraw();
}
onMounted(() => {
  observer = new ResizeObserver(redraw);
  observer.observe(root.value);
  observer.observe(ed.iframeElement);
  ed.on('input change undo redo SetContent NodeChange', edited);
  ed.getWin().addEventListener('scroll', redraw);
  ed.getDoc().addEventListener('pointerdown', outside, true);
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('scroll', redraw, true);
  window.addEventListener('resize', redraw);
  scan();
});
onBeforeUnmount(() => {
  destroyed = true;
  pending = undefined;
  worker?.terminate();
  observer?.disconnect();
  cancelAnimationFrame(frame);
  ed.off('input change undo redo SetContent NodeChange', edited);
  ed.getWin()?.removeEventListener('scroll', redraw);
  ed.getDoc()?.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('scroll', redraw, true);
  window.removeEventListener('resize', redraw);
});
</script>

<style scoped>
.spell-layer {position:absolute;inset:0;pointer-events:none;z-index:2;}
.word-mark {position:absolute;background:rgba(234,67,53,.24);border:0;border-radius:0;margin:0;padding:0;pointer-events:auto;cursor:pointer;}
.word-mark:focus-visible {outline:2px solid var(--el-color-primary);}
.spell-bar {position:absolute;right:8px;bottom:8px;display:flex;align-items:center;height:36px;border-radius:4px;
  background:var(--mail-compose-bg,var(--el-bg-color));box-shadow:0 1px 3px #0003;pointer-events:auto;}
.spell-bar button,.spell-menu button {font:inherit;color:inherit;border:0;background:transparent;cursor:pointer;}
.spell-bar button {height:36px;min-width:37px;display:grid;place-items:center;border-radius:4px;font-size:14px;font-weight:500;}
.spell-bar button:first-child {width:80px;}
.spell-bar button:nth-child(2) {min-width:20px;width:20px;}
.spell-bar button:hover,.spell-menu button:hover,.spell-menu button:focus-visible {background:var(--el-fill-color-light);}
.spell-bar button:disabled {opacity:.55;}
.spell-menu {position:fixed;z-index:4000;min-width:144px;max-width:calc(100vw - 16px);max-height:min(380px,calc(100dvh - 16px));
  overflow:auto;padding:6px 0;background:var(--el-bg-color);color:var(--el-text-color-primary);border-radius:4px;
  box-shadow:0 8px 10px 1px #00000024,0 3px 14px 2px #0000001f,0 5px 5px -3px #0003;}
.spell-menu button {position:relative;display:block;text-align:left;width:100%;padding:6px 48px;min-height:32px;font-size:14px;line-height:20px;white-space:nowrap;}
.spell-menu button svg {position:absolute;left:20px;top:7px;}
.spell-menu hr {border:0;border-top:1px solid var(--light-border-color);margin:6px 0;}
.sr-only {position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden;white-space:nowrap;}
.spell-status {position:absolute;bottom:48px;right:8px;background:var(--el-bg-color);padding:6px;font-size:13px;}
</style>
