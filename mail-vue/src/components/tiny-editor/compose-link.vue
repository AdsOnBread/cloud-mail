<template>
  <div v-if="panel" ref="box" class="link-card" :class="{'link-preview':panel.preview, 'selection-link':panel.selectedText}" role="dialog"
    :aria-label="panel.preview ? 'Link options' : 'Edit or Insert link'"
    @keydown.esc.stop.prevent="close(true)" @focusout="leaveCard" @pointerdown.stop>
    <template v-if="panel.preview">
      <span>Go to link:</span>
      <a v-if="safeUrl" :href="safeUrl" target="_blank" rel="noopener noreferrer">{{ panel.url }}</a>
      <span v-else class="address">{{ panel.url }}</span>
      <span aria-hidden="true">|</span>
      <button type="button" @click="edit">Change</button>
      <span aria-hidden="true">|</span>
      <button type="button" @click="remove">Remove</button>
    </template>
    <form v-else :class="{'image-link':panel.imageLink}" @submit.prevent="apply">
      <label v-if="!panel.imageLink && !panel.selectedText">
        <Icon icon="material-symbols:short-text" width="18" aria-hidden="true" />
        <input ref="textField" v-model="panel.text" aria-label="Anchor Text" placeholder="Text" autocomplete="off" />
      </label>
      <label>
        <Icon icon="material-symbols:link" width="18" aria-hidden="true" />
        <input ref="urlField" v-model="panel.url" aria-label="Link" placeholder="Type or paste a link" autocomplete="off" />
      </label>
      <button v-if="panel.imageLink && panel.existing" class="remove-link" type="button" @click="remove">Remove link</button>
      <button type="submit" class="apply-link" :disabled="!safeUrl">Apply</button>
    </form>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { Icon } from "@iconify/vue";
import { normalizeLinkUrl, selectedWebUrl, renameLink } from "./link-text";
const props = defineProps({ editor: Object });
const panel = ref(null),
  box = ref(null),
  textField = ref(null), urlField = ref(null);
let bookmark, anchor, originalText, owner, range, resize, fragment = null;
const safeUrl = computed(() => normalizeLinkUrl(panel.value?.url));
function outside(event) {
  if (
    !box.value?.contains(event.target) &&
    !event.target.closest?.("[data-compose-link]")
  )
    close(false);
}
// The editor selection is inside an iframe, while the card belongs to the outer editor box.
function position() {
  const card = box.value;
  const frame = owner?.iframeElement;
  const parent = card?.offsetParent;
  if (!frame || !parent) return;
  const bounds = parent.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const lines = Array.from((fragment == null ? range : anchor).getClientRects());
  const line = (fragment == null ? lines.find(rect => rect.bottom > 0 && rect.top < frame.clientHeight)
    : lines[Math.min(fragment, lines.length - 1)]) || lines[0] || owner.selection.getNode().getBoundingClientRect();
  if (panel.value.preview && (line.bottom <= 0 || line.top >= frame.clientHeight)) {
    close(box.value.contains(document.activeElement));
    return;
  }
  const edge = 3;
  const x = frameRect.left - bounds.left + frame.clientLeft + line.left;
  const top = frameRect.top - bounds.top + frame.clientTop + line.top;
  const below = Math.min(frameRect.bottom - bounds.top, top + line.height) + edge;
  const maxTop = bounds.height - card.offsetHeight - edge;
  const above = top - card.offsetHeight - edge;
  card.style.left = Math.max(edge, Math.min(x, bounds.width - card.offsetWidth - edge)) + "px";
  card.style.top = Math.max(edge, Math.min(below <= maxTop ? below : above, maxTop)) + "px";
}
function close(focus = false) {
  if (!panel.value) return;
  document.removeEventListener("pointerdown", outside, true);
  owner.off("mousedown Undo Redo SetContent", insideEditor);
  owner.off("keydown", editorKey);
  owner.getWin()?.removeEventListener("scroll", position);
  resize?.disconnect();
  panel.value = null;
  if (focus && owner === props.editor && !owner.removed) owner.focus();
  anchor = bookmark = range = owner = resize = null;
}
function leaveCard(event) {
  if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
}
function insideEditor() {
  close(false);
}
function editorKey(event) {
  if (!panel.value?.preview || event.ctrlKey || event.metaKey || event.altKey) return;
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
  fragment = anchor && pointer ? Math.max(0, Array.from(anchor.getClientRects()).findIndex(rect =>
    pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom)) : null;
  bookmark = ed.selection.getBookmark(2, true);
  originalText = anchor?.textContent ?? ed.selection.getContent({format:"text"});
  const imageLink = photoAction || (!originalText.trim() && Boolean((anchor || range.cloneContents()).querySelector("img")));
  const selectedText = !anchor && !imageLink && !range.collapsed && Boolean(originalText.trim());
  const directUrl = selectedText && selectedWebUrl(originalText);
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
  panel.value = {text:originalText, url:anchor?.getAttribute("href") || "", preview, imageLink,
    selectedText:selectedText && !anchor, existing:Boolean(anchor)};
  const opened = panel.value;
  document.addEventListener("pointerdown", outside, true);
  ed.on("mousedown Undo Redo SetContent", insideEditor);
  ed.on("keydown", editorKey, true);
  ed.getWin().addEventListener("scroll", position, {passive:true});
  await nextTick();
  if (!box.value || panel.value !== opened) return;
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
  background:var(--mail-surface);
  color:var(--regular-text-color);
  border-radius:12px;
  padding:16px;
  box-shadow:0 2px 6px 2px #3c404326,0 1px 2px #3c40434d;
  font:14px/20px Arial,sans-serif;
}
form { display:grid; grid-template-columns:minmax(0,1fr) 68px; align-items:center; gap:8px; }
label {
  display:flex; align-items:center; gap:16px; min-width:0; height:32px;
  grid-column:1; padding:0 8px; box-sizing:border-box; cursor:text;
  border:1px solid var(--secondary-text-color); border-radius:4px;
}
label:focus-within { border-color:var(--el-color-primary); box-shadow:inset 0 0 0 1px var(--el-color-primary); }
label svg { flex:none; }
input {
  width:100%; min-width:0; padding:0; color:inherit; background:transparent;
  font:inherit; border:0; outline:none;
}
button { font:inherit; cursor:pointer; }
.apply-link {
  grid-column:2; grid-row:2; padding:6px 14px; border-radius:16px;
  font-weight:500; color:var(--el-color-primary);
}
.selection-link { width:334px; padding:18px 16px; }
.selection-link .apply-link { grid-row:1; }
.image-link label { grid-column:1 / -1; }
.remove-link { grid-row:2;justify-self:start;color:var(--el-color-primary); }
.remove-link:hover { text-decoration:underline; }
.apply-link:disabled { color:var(--secondary-text-color); opacity:0.65; cursor:default; }
.apply-link:hover:enabled { background:var(--mail-hover); }
.link-preview {
  display:flex; align-items:center; gap:5px; width:max-content; border-radius:2px;
  padding:5px 10px; font:13px/18px Arial,sans-serif;
}
.link-preview span,.link-preview button { flex:none; white-space:nowrap; }
.link-preview a,.link-preview .address { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.link-preview a,.link-preview button { padding:0; color:var(--el-color-primary); text-decoration:none; }
.link-preview a:hover,.link-preview button:hover { text-decoration:underline; }
</style>
