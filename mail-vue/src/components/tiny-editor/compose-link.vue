<template>
  <div v-if="panel" ref="box" :popover="floating ? 'manual' : undefined" class="link-card" :class="{'link-preview':panel.preview, 'selection-link':panel.selectedText}" role="dialog"
    :aria-label="panel.preview ? 'Link options' : 'Edit or Insert link'"
    @keydown.esc.stop.prevent="close(true)" @keydown.tab="tabWithinPreview" @focusout="leaveCard" @pointerdown.stop>
    <template v-if="panel.preview">
      <span v-if="canVisit">Go to link: </span>
      <a v-if="canVisit" :href="safeUrl" :aria-label="destination" :title="destination" target="_blank" rel="noopener noreferrer">{{ previewText }}</a>
      <span v-else class="address" :title="destination">{{ previewText }}</span>
      <span aria-hidden="true">|</span>
      <button type="button" @click="edit">Change</button>
      <span aria-hidden="true">|</span>
      <button type="button" @click="remove">Remove</button>
    </template>
    <form v-else :class="{'image-link':panel.imageLink}" @submit.prevent="apply">
      <label v-if="!panel.imageLink && !panel.selectedText">
        <Icon icon="material-symbols:short-text" width="20" aria-hidden="true" />
        <input ref="textField" v-model="panel.text" aria-label="Anchor Text" placeholder="Text" autocomplete="off" />
      </label>
      <label>
        <Icon icon="material-symbols:link" width="20" aria-hidden="true" />
        <input ref="urlField" v-model="panel.url" aria-label="Link" placeholder="Type or paste a link" autocomplete="off" />
      </label>
      <button v-if="panel.imageLink && panel.existing" class="remove-link" type="button" @click="remove">Remove link</button>
      <button type="submit" class="apply-link" :disabled="!safeUrl">Apply</button>
    </form>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Icon } from "@iconify/vue";
import {visibleFrame} from "./visible-frame";
import { editableLinkUrl, normalizeLinkUrl, selectedLinkUrl, shortenLinkDestination, renameLink } from "./link-text";
const floating = typeof HTMLElement.prototype.showPopover === "function";
const props = defineProps({ editor: Object });
const panel = ref(null),
  box = ref(null),
  textField = ref(null), urlField = ref(null);
let bookmark, anchor, originalText, owner, range, resize, placementEvents, fragment = null;
const safeUrl = computed(() => normalizeLinkUrl(panel.value?.url));
const canVisit = computed(() => /^https?:\/\//i.test(safeUrl.value) ||
  (/^mailto:/i.test(safeUrl.value) && safeUrl.value.includes("?")));
const destination = computed(() => (panel.value?.url || "").replace(/^mailto:/i, ""));
const previewText = computed(() => shortenLinkDestination(destination.value));
function outside(event) {
  if (
    !box.value?.contains(event.target) &&
    !event.target.closest?.("[data-compose-link]")
  )
    close(false);
}
// Selection rectangles are local to TinyMCE's iframe. Gmail lets the card use
// space outside the composer, so use viewport coordinates in the top layer.
function position() {
  const card = box.value, frame = owner?.iframeElement;
  if (!card || !frame) return;
  const parent = frame.closest(".editor-box");
  if (!parent) return;
  if (!frame.getClientRects().length || frame.closest("[inert]")) {
    close();
    return;
  }
  const rect = frame.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
  const right = left + (viewport?.width || document.documentElement.clientWidth);
  const bottom = top + (viewport?.height || document.documentElement.clientHeight);
  const clip = visibleFrame(frame, {left:Math.max(rect.left,left), right:Math.min(rect.right,right),
    top:Math.max(rect.top,top), bottom:Math.min(rect.bottom,bottom)});
  // Scrolling a reader or Settings can move the entire editor out of view.
  // Keep a partly edited URL available when the writer scrolls back.
  if (clip.left >= clip.right || clip.top >= clip.bottom) {
    if (panel.value.preview) close();
    else card.style.visibility = "hidden";
    return;
  }
  card.style.visibility = "";
  const lines = Array.from((fragment == null ? range : anchor).getClientRects());
  const line = (fragment == null ? lines.find(rect => rect.bottom > 0 && rect.top < frame.clientHeight)
    : lines[Math.min(fragment, lines.length - 1)]) || lines[0] || owner.selection.getNode().getBoundingClientRect();
  const startX = rect.left + frame.clientLeft + line.left;
  const startY = rect.top + frame.clientTop + line.top;
  const endY = startY + line.height;
  if (panel.value.preview && (endY <= clip.top || startY >= clip.bottom ||
      startX + line.width < clip.left || startX > clip.right)) {
    close(card.contains(document.activeElement));
    return;
  }
  const local = parent.getBoundingClientRect();
  const bounds = floating ? {left,top,right,bottom} : local;
  const preview = panel.value.preview;
  const inset = floating ? (preview ? 0 : 10) : 3;
  const gap = preview ? 1 : 2;
  card.style.maxWidth = Math.max(0,bounds.right-bounds.left-2*inset)+"px";
  if (floating) card.style.maxHeight = Math.max(0,bounds.bottom-bounds.top-2*inset)+"px";
  const x = Math.max(bounds.left+inset, Math.min(startX-(preview ? 1 : 0),bounds.right-card.offsetWidth-inset));
  const below = Math.min(endY,clip.bottom) + gap;
  const maxTop = bounds.bottom-card.offsetHeight-inset;
  const y = Math.max(bounds.top+inset, Math.min(below <= maxTop ? below : startY-card.offsetHeight-gap,maxTop));
  card.style.left = (floating ? x : x-local.left) + "px";
  card.style.top = (floating ? y : y-local.top) + "px";
}
function close(focus = false) {
  if (!panel.value) return;
  document.removeEventListener("pointerdown", outside, true);
  owner.off("mousedown Undo Redo SetContent", insideEditor);
  owner.off("keydown", editorKey);
  placementEvents?.abort();
  resize?.disconnect();
  panel.value = null;
  if (focus && owner === props.editor && !owner.removed) owner.focus();
  anchor = bookmark = range = owner = resize = placementEvents = null;
}
function leaveCard(event) {
  if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
}
function insideEditor(event) {
  if (event.paste && panel.value?.preview) followCaret();
  else close(false);
}
function tabWithinPreview(event) {
  if (!panel.value?.preview || event.ctrlKey || event.metaKey || event.altKey) return;
  const actions = Array.from(box.value.querySelectorAll("a[href],button"));
  const index = actions.indexOf(document.activeElement);
  if (index < 0) return;
  const next = actions[index + (event.shiftKey ? -1 : 1)];
  if (next) {
    event.preventDefault();
    next.focus();
  } else if (event.shiftKey) {
    event.preventDefault();
    close(true);
  }
}
function linkLabel(link) {
  // TinyMCE temporarily pads the active edge of a link with a caret marker.
  const label = link.textContent;
  return link.getAttribute("data-mce-selected") === "inline-boundary" ? label.replace(/^\uFEFF|\uFEFF$/g, "") : label;
}
function fragmentAt(link, point) {
  return Math.max(0, Array.from(link.getClientRects()).findIndex(rect =>
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom));
}
function followCaret() {
  const ed = props.editor;
  if (!ed?.initialized || ed.removed || !ed.hasFocus() || (panel.value && !panel.value.preview)) return;
  const selection = ed.selection.getRng();
  const link = ed.dom.getParent(selection.commonAncestorContainer, "a[href]");
  if (!link || !link.textContent.trim() || link.closest('[contenteditable="false"]')) {
    if (panel.value?.preview) close();
    return;
  }
  // Use the moving end of a backwards selection to choose the line of a wrapped link.
  const native = ed.getDoc().getSelection();
  if (!native?.focusNode || !link.contains(native.focusNode)) {
    if (panel.value?.preview) close();
    return;
  }
  const caret = ed.dom.createRng();
  caret.setStart(native.focusNode, native.focusOffset);
  caret.collapse(true);
  const line = caret.getBoundingClientRect();
  const point = {x:line.left, y:line.top + line.height / 2};
  if (anchor !== link || !panel.value) {
    open(link, true, point);
    return;
  }
  range = selection.cloneRange();
  bookmark = ed.selection.getBookmark(2, true);
  fragment = fragmentAt(link, point);
  originalText = panel.value.text = linkLabel(link);
  position();
}
function editorKey(event) {
  if (!panel.value?.preview || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.isComposing || (event.key !== "Tab" && event.key !== "Escape")) return;
  if (event.key === "Tab" && !event.shiftKey) {
    event.preventDefault();
    box.value?.querySelector("a[href],button")?.focus();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  close(false);
}
function focusField() {
  const field = textField.value || urlField.value;
  field?.focus({preventScroll:true});
  if (anchor && field === textField.value) field?.select();
}
async function open(existing = null, preview = false, pointer = null, photoAction = false) {
  close(false);
  const ed = props.editor;
  if (!ed?.initialized || ed.removed) return;
  owner = ed;
  anchor = existing || ed.dom.getParent(ed.selection.getNode(), "a[href]");
  range = ed.selection.getRng().cloneRange();
  fragment = anchor && pointer ? fragmentAt(anchor, pointer) : null;
  bookmark = ed.selection.getBookmark(2, true);
  originalText = anchor ? linkLabel(anchor) : ed.selection.getContent({format:"text"});
  const imageLink = photoAction || (!originalText.trim() && Boolean((anchor || range.cloneContents()).querySelector("img")));
  const selectedText = !anchor && !imageLink && !range.collapsed && Boolean(originalText.trim());
  const directUrl = selectedText && selectedLinkUrl(originalText);
  if (directUrl && !range.cloneContents().querySelector("img,hr,table,br:not([data-mce-bogus]),audio,video,iframe,object,embed,svg,canvas,[contenteditable=false]")) {
    ed.undoManager.transact(() => ed.execCommand("mceInsertLink", false, {href:directUrl}));
    ed.nodeChanged();
    ed.dispatch("change");
    anchor = ed.dom.getParent(ed.selection.getEnd(), "a[href]");
    if (anchor) {
      preview = true;
      range.selectNodeContents(anchor);
      const after = ed.dom.createRng();
      after.setStartAfter(anchor);
      after.collapse(true);
      ed.selection.setRng(after);
      bookmark = ed.selection.getBookmark(2, true);
    }
  }
  panel.value = {text:originalText, url:editableLinkUrl(anchor?.getAttribute("href") || ""), preview, imageLink,
    selectedText:selectedText && !anchor, existing:Boolean(anchor)};
  const opened = panel.value;
  document.addEventListener("pointerdown", outside, true);
  ed.on("mousedown Undo Redo SetContent", insideEditor);
  ed.on("keydown", editorKey, true);
  placementEvents = new AbortController();
  const options = {capture:true, passive:true, signal:placementEvents.signal};
  for (const target of [window, ed.getWin(), window.visualViewport].filter(Boolean)) {
    target.addEventListener("resize", position, options);
    target.addEventListener("scroll", position, options);
  }
  await nextTick();
  if (!box.value || panel.value !== opened) return;
  if (floating) box.value.showPopover();
  position();
  if (!box.value || panel.value !== opened) return;
  resize = new ResizeObserver(position);
  resize.observe(box.value);
  resize.observe(box.value.parentElement);
  resize.observe(ed.iframeElement);
  if (!preview) focusField();
}
async function edit() {
  panel.value.preview = false;
  await nextTick();
  position();
  focusField();
}
function change(fn) {
  if (!owner || owner !== props.editor || owner.removed) {
    close();
    return;
  }
  const ed = owner;
  ed.focus();
  ed.selection.moveToBookmark(bookmark);
  ed.undoManager.transact(() => fn(ed));
  ed.nodeChanged();
  ed.dispatch("change");
  close(true);
}
function apply() {
  if (!safeUrl.value) return;
  const imageLink = panel.value.imageLink;
  const href = safeUrl.value,
    text = panel.value.text || panel.value.url.trim();
  change((ed) => {
    if (anchor?.isConnected) {
      ed.dom.setAttrib(anchor, "href", href);
      if (!imageLink && text !== originalText) renameLink(anchor, text);
    } else if (!ed.selection.isCollapsed() && (imageLink || text === originalText)) {
      ed.execCommand("mceInsertLink", false, { href });
    } else {
      const link = ed.getDoc().createElement("a");
      link.href = href;
      link.textContent = text;
      ed.insertContent(link.outerHTML);
    }
    ed.selection.collapse(false);
    const edited = anchor || ed.dom.getParent(ed.selection.getEnd(), "a[href]");
    if (edited?.isConnected) {
      const after = ed.dom.createRng();
      after.setStartAfter(edited);
      after.collapse(true);
      ed.selection.setRng(after);
    }
  });
}
function remove() {
  change((ed) => {
    if (anchor?.isConnected) ed.dom.remove(anchor, true);
  });
}
// The editor handles Select All itself. macOS also has native Control-key
// equivalents of the arrows and line boundaries, including in Safari.
function movesSelection(event) {
  if (event.isComposing) return false;
  if (/^(?:Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/.test(event.key)) return true;
  const key = event.key.toLowerCase();
  return ((event.ctrlKey || event.metaKey) && key === "a") ||
    (event.ctrlKey && !event.altKey && !event.metaKey && /^[befnp]$/.test(key));
}
watch(() => props.editor, (ed, _, cleanup) => {
  if (!ed) return;
  let moving = false;
  const down = event => { moving = movesSelection(event); };
  const moved = () => { if (moving) followCaret(); };
  const stop = () => { moving = false; };
  const up = event => {
    if (moving || movesSelection(event)) followCaret();
    stop();
  };
  const input = event => {
    if (!event.isComposing && /^(?:insertText|insertParagraph|insertLineBreak|insertFromPaste|delete)/.test(event.inputType)) followCaret();
  };
  ed.on("keydown", down);
  ed.on("SelectionChange", moved);
  ed.on("keyup", up);
  ed.on("blur mousedown", stop);
  ed.on("input", input);
  ed.on("compositionend", followCaret);
  cleanup(() => {
    ed.off("keydown", down);
    ed.off("SelectionChange", moved);
    ed.off("keyup", up);
    ed.off("blur mousedown", stop);
    ed.off("input", input);
    ed.off("compositionend", followCaret);
    close();
  });
}, {immediate:true});
onBeforeUnmount(() => close());
defineExpose({ open, close, openPhoto: link => open(link, false, null, true) });
</script>
<style scoped>
.link-card {
  box-sizing:border-box;
  position:absolute;
  z-index:8;
  width:324px;
  max-width:calc(100% - 6px);
  border:0;
  background:var(--el-bg-color);
  color:var(--regular-text-color);
  border-radius:12px;
  padding:16px;
  box-shadow:0 2px 6px 2px #3c404326,0 1px 2px #3c40434d;
  font:14px/20px Arial,sans-serif;
}
.link-card:popover-open { position:fixed; inset:auto; margin:0; }
form { display:grid; grid-template-columns:minmax(0,1fr) 64px; align-items:center; gap:8px 12px; }
label {
  display:flex; align-items:center; gap:16px; min-width:0; height:32px;
  grid-column:1; padding:0 15px 0 7px; box-sizing:border-box; cursor:text;
  border:1px solid var(--send-outline); border-radius:4px;
}
label:focus-within { border-color:var(--send-blue); box-shadow:inset 0 0 0 1px var(--send-blue); }
label svg { flex:none; }
input {
  width:100%; min-width:0; padding:0; color:inherit; background:transparent;
  font:inherit; border:0; outline:none;
}
button { font:inherit; cursor:pointer; }
.apply-link {
  grid-column:2; grid-row:2; height:32px; padding:0 12px; border-radius:16px;
  font-weight:500; color:var(--send-blue);
}
.selection-link { width:334px; padding:18px 16px; }
.selection-link .apply-link { grid-row:1; }
.image-link label { grid-column:1 / -1; }
.remove-link { grid-row:2;justify-self:start;color:var(--el-color-primary); }
.remove-link:hover { text-decoration:underline; }
.apply-link:disabled { color:var(--secondary-text-color); opacity:0.65; cursor:default; }
.apply-link:hover:enabled { background:color-mix(in srgb, var(--send-blue) 8%, transparent); }
.link-preview {
  display:flex; align-items:center; width:max-content; border-radius:2px;
  padding:6px 10px; border:1px solid #bbb; border-bottom-color:#a8a8a8;
  box-shadow:0 1px 3px rgb(0 0 0 / 20%); color:#222; font:13px/16.5px Arial,sans-serif;
  --preview-link:#15c;
}
.link-preview span,.link-preview button { flex:none; white-space:pre; }
.link-preview [aria-hidden] {margin-inline:6px;}
.link-preview a,.link-preview .address { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.link-preview a,.link-preview button { padding:0; color:var(--preview-link); text-decoration:none; }
.link-preview a:hover,.link-preview button:hover { text-decoration:underline; }
:global(html.dark .link-card.link-preview) {
  --preview-link:var(--send-blue); color:var(--regular-text-color); border-color:var(--send-outline);
}
@media (forced-colors:active) {
  .link-card {outline:1px solid CanvasText;}
  label:focus-within {outline:2px solid Highlight;}
}
</style>
