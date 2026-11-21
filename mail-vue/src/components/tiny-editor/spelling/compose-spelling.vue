<template>
  <div ref="root" class="spell-layer" @keydown.esc.stop.prevent="finish" @keydown="layerKeys">
    <button v-for="mark in boxes" :key="mark.key" type="button" class="word-mark" :style="mark.style"
      :data-issue="mark.issue.index" :aria-label="mark.issue.word" aria-haspopup="menu" :tabindex="mark.first ? 0 : -1"
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
    <span role="status" :class="{'spell-status':error || noMatch, 'sr-only':!error && !noMatch}">{{ status }}</span>
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
import {collectWords, liveWords, replaceWord, spellingTarget, spellingShortcut} from './words';

const props = defineProps({editor:{type:Object, required:true},initialAction:{type:String,default:'check'}});
const emit = defineEmits(['close']);
const language = defineModel('language', {default:'auto'});
const choices = [['auto','','Auto'], ...languages];
const root = ref(), bar = ref(), menu = ref();
const busy = ref(false), error = ref(false), noMatch=ref(false), status = ref('');
const boxes = shallowRef([]), suggestions = ref([]), popup = ref(''), menuStyle = ref({});
let entering = true, issues = [], selected, opener, worker, pending, revision = 0, frame, observer, textChanged = false, destroyed = false;
const ed = props.editor;
const apple=/Mac|iPhone|iPad/.test(navigator.platform);
let keyboardRequest, needsScan=true, fromKeyboard=false, ignored=[];
defineExpose({navigate});
function sameSelection(range) {
  const current=ed.selection.getRng();
  return current.startContainer===range.startContainer && current.startOffset===range.startOffset &&
    current.endContainer===range.endContainer && current.endOffset===range.endOffset;
}
function navigate(action) {
  noMatch.value=false;
  dismiss();
  entering=false;
  keyboardRequest={action,range:ed.selection.getRng().cloneRange()};
  if (busy.value) return;
  if (needsScan) scan(false);
  else runNavigation();
}
async function runNavigation() {
  const request=keyboardRequest;
  if (!request || destroyed) return;
  keyboardRequest=undefined;
  if (!ed.hasFocus() || !sameSelection(request.range)) return;
  const issue=spellingTarget(issues.filter(valid),request.range,request.action,issue=>renderedRects(issue).length>0);
  if (!issue) {
    noMatch.value=true;
    status.value=request.action==='next' ? 'No spelling errors found.' : 'No spelling suggestions at the cursor.';
    return;
  }
  ed.selection.setRng(issue.range.cloneRange());
  ed.selection.scrollIntoView();
  status.value='Misspelled word: '+issue.word;
  if (request.action==='suggest') {
    draw();
    await nextTick();
    if (destroyed || !ed.hasFocus() || !sameSelection(issue.range)) return;
    const mark=root.value?.querySelector('[data-issue="'+issue.index+'"]');
    if (mark) correct(issue,mark,true);
  }
}
function layerKeys(event) {
  const action=spellingShortcut(event,apple);
  const button=event.target.closest?.('[data-issue]');
  const issue=button && issues.find(item=>String(item.index)===button.dataset.issue);
  if (!action || !issue || !valid(issue)) return;
  event.preventDefault();event.stopPropagation();
  ed.focus();ed.selection.setRng(issue.range.cloneRange());
  navigate(action);
}

function finish() {
  emit('close');
  ed.focus();
}
function dismiss(restore = false) {
  popup.value = '';
  selected = undefined;
  if (restore && fromKeyboard) ed.focus();
  else if (restore && opener?.isConnected) opener.focus({preventScroll:true});
  fromKeyboard=false;
  opener = undefined;
}
function outside(event) {
  if (!menu.value?.contains(event.target) && !root.value?.contains(event.target)) dismiss();
}
function menuKeys(event) {
  const action=spellingShortcut(event,apple);
  if (action && popup.value==='suggest' && selected && valid(selected)) {
    event.preventDefault();event.stopPropagation();
    if (action==='next') {
      const range=selected.range.cloneRange();
      dismiss();ed.focus();ed.selection.setRng(range);
      navigate(action);
    }
    return;
  }
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
function renderedRects(issue) {
  const element=issue.range.startContainer.parentElement;
  if (!element || ed.getWin().getComputedStyle(element).visibility!=='visible') return [];
  return Array.from(issue.range.getClientRects()).filter(rect=>rect.width>0 && rect.height>0);
}
function draw() {
  frame = undefined;
  if (destroyed) return;
  if (textChanged) {
    if (issues.length) issues = liveWords(ed.getBody(), issues);
    textChanged = false;
  }
  const area = root.value.getBoundingClientRect();
  const viewport = ed.iframeElement.getBoundingClientRect();
  const marks = [];
  for (const issue of issues) {
    if (!valid(issue)) continue;
    let part = 0;
    for (const rect of renderedRects(issue)) {
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
  if (entering && !busy.value) {
    entering = false;
    if (bar.value.contains(document.activeElement)) nextTick(() =>
      (root.value?.querySelector('.word-mark') || bar.value?.querySelector('button'))?.focus({preventScroll:true}));
  }
}
function redraw() {
  if (!frame) frame = requestAnimationFrame(draw);
}
function place() {
  if (!menu.value) return;
  if (!opener?.isConnected) { dismiss(); return; }
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
  const width = viewport?.width || document.documentElement.clientWidth;
  const height = viewport?.height || document.documentElement.clientHeight;
  const bounds = {maxWidth:Math.max(0, width - 16) + 'px', maxHeight:Math.max(0, Math.min(380, height - 16)) + 'px'};
  Object.assign(menu.value.style, bounds);
  const rect = opener.getBoundingClientRect(), panel = menu.value.getBoundingClientRect();
  const above = popup.value === 'language' || rect.bottom + panel.height > top + height - 8;
  menuStyle.value = {...bounds,
    left:Math.max(left + 8, Math.min(rect.left, left + width - panel.width - 8)) + 'px',
    top:Math.max(top + 8, Math.min(above ? rect.top - panel.height : rect.bottom, top + height - panel.height - 8)) + 'px',
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
  worker = pending = keyboardRequest = undefined;
  needsScan=true;
  busy.value = false;
  error.value = true;
  status.value = 'Spell check unavailable. Select Recheck to try again.';
}
function scan(resetIgnored=true) {
  if (resetIgnored) ignored=[];
  noMatch.value=false;
  dismiss();
  busy.value = true;
  error.value = false;
  status.value = 'Checking spelling';
  needsScan=false;
  const words = collectWords(ed.getBody());
  issues = [];
  redraw();
  try {
    ask({type:'check', language:language.value, locales:navigator.languages,
      sample:words.slice(0, 200).map(item => item.word).join(' '),
      words:Array.from(new Set(words.map(item => item.word))),
      base:new URL(import.meta.env.BASE_URL, document.baseURI).href}, ({wrong}) => {
      const invalid = new Set(wrong);
      if (ignored.length) ignored=liveWords(ed.getBody(),ignored);
      const skip=new Map();
      for (const {range} of ignored) {
        const node=range.startContainer;
        if (!skip.has(node)) skip.set(node,new Set());
        skip.get(node).add(range.startOffset);
      }
      issues = liveWords(ed.getBody(), words.filter(item => invalid.has(item.word) &&
        !skip.get(item.range.startContainer)?.has(item.range.startOffset)));
      issues.forEach((issue, index) => { issue.index = index; });
      busy.value = false;
      status.value = 'Spell checking completed';
      redraw();
      if (keyboardRequest) needsScan ? scan(false) : runNavigation();
    });
  } catch { failed(); }
}
function correct(issue, trigger, keyboard=false) {
  if (busy.value || !liveWords(ed.getBody(), [issue]).length) return;
  dismiss();
  selected = issue;
  fromKeyboard=keyboard;
  ask({type:'suggest', word:issue.word}, data => {
    if (selected !== issue || !valid(issue) || !trigger.isConnected || (keyboard && (!ed.hasFocus() || !sameSelection(issue.range)))) return;
    suggestions.value = data.suggestions;
    display('suggest', trigger);
  });
}
function ignore() {
  if (selected && valid(selected)) ignored.push(selected);
  issues = issues.filter(issue => issue !== selected);
  dismiss();
  redraw();
  ed.focus();
}
function replace(value) {
  const issue = selected;
  if (!issue || !liveWords(ed.getBody(), [issue]).length) { dismiss(); return; }
  ed.focus();
  ed.selection.setRng(issue.range);
  ed.undoManager.transact(() => ed.selection.setRng(replaceWord(issue.range, value)));
  ed.nodeChanged();
  ed.dispatch('change');
  ignore();
}
function editorEscape(event) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finish();
}
function edited(event) {
  // TinyMCE can finalize the preceding undo level on shortcut keyup. Its change
  // event leaves the caret in place and must not cancel a pending first lookup.
  if (event.type.toLowerCase()!=='change') {
    keyboardRequest=undefined;noMatch.value=false;
  }
  needsScan=true;
  textChanged = true;
  if (selected && !valid(selected)) dismiss();
  redraw();
}
onMounted(() => {
  observer = new ResizeObserver(redraw);
  observer.observe(root.value);
  observer.observe(ed.iframeElement);
  ed.on('input change undo redo SetContent', edited);
  ed.on('keydown', editorEscape, true);
  ed.getWin().addEventListener('scroll', redraw);
  ed.getDoc().addEventListener('pointerdown', outside, true);
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('scroll', redraw, true);
  window.addEventListener('resize', redraw);
  window.visualViewport?.addEventListener('resize', redraw);
  window.visualViewport?.addEventListener('scroll', redraw);
  if (props.initialAction!=='check') { navigate(props.initialAction);return; }
  scan();
  bar.value.querySelector('[aria-label="Language"]').focus({preventScroll:true});
});
onBeforeUnmount(() => {
  destroyed = true;
  pending = undefined;
  worker?.terminate();
  observer?.disconnect();
  cancelAnimationFrame(frame);
  ed.off('input change undo redo SetContent', edited);
  ed.off('keydown', editorEscape);
  ed.getWin()?.removeEventListener('scroll', redraw);
  ed.getDoc()?.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('scroll', redraw, true);
  window.removeEventListener('resize', redraw);
  window.visualViewport?.removeEventListener('resize', redraw);
  window.visualViewport?.removeEventListener('scroll', redraw);
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
.spell-menu {position:fixed;z-index:4000;min-width:min(144px,100%);box-sizing:border-box;max-width:calc(100vw - 16px);max-height:min(380px,calc(100dvh - 16px));
  overflow:auto;padding:6px 0;background:var(--el-bg-color);color:var(--el-text-color-primary);border-radius:4px;
  box-shadow:0 8px 10px 1px #00000024,0 3px 14px 2px #0000001f,0 5px 5px -3px #0003;}
.spell-menu button {position:relative;display:block;text-align:left;width:100%;padding:6px clamp(26px,10vw,48px);min-height:32px;overflow-wrap:anywhere;font-size:14px;line-height:20px;}
.spell-menu button svg {position:absolute;left:20px;top:7px;}
.spell-menu hr {border:0;border-top:1px solid var(--light-border-color);margin:6px 0;}
.sr-only {position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden;white-space:nowrap;}
.spell-status {position:absolute;bottom:48px;right:8px;background:var(--el-bg-color);padding:6px;font-size:13px;}
</style>
