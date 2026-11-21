<template>
  <div v-if="panel" ref="box" class="link-card" role="dialog" aria-label="Link" @keydown.esc.stop.prevent="close(true)" @pointerdown.stop>
    <template v-if="panel.preview">
      <a :href="safeUrl" target="_blank" rel="noopener noreferrer">{{ panel.url }}</a>
      <button @click="edit">Change</button><button @click="remove">Remove</button>
    </template>
    <form v-else @submit.prevent="apply">
      <label><span>Text</span><input v-model="panel.text" aria-label="Text to display" placeholder="Text to display" /></label>
      <label><Icon icon="material-symbols:link" width="18" /><input ref="urlField" v-model="panel.url" aria-label="Link address" placeholder="Paste or search for a link" autocomplete="off" /></label>
      <button class="apply-link" :disabled="!safeUrl">Apply</button>
    </form>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { Icon } from "@iconify/vue";
const props = defineProps({ editor: Object });
const panel = ref(null), box = ref(null), urlField = ref(null);
let bookmark, anchor, originalText, owner;
const safeUrl = computed(() => {
  const raw = panel.value?.url.trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return "";
  try {
    const candidate = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? "mailto:" + raw :
      /^[\w-]+(?:\.[\w-]+)+(?:[/?#:][^\s]*)?$/.test(raw) ? "https://" + raw : raw;
    const url = new URL(candidate);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
});
function outside(event) {
  if (!box.value?.contains(event.target) && !event.target.closest?.('[data-compose-link]')) close(false);
}
function close(focus = false) {
  if (!panel.value) return;
  document.removeEventListener("pointerdown", outside, true);
  owner?.off("mousedown", insideEditor);
  panel.value = null;
  if (focus && owner === props.editor && !owner.removed) owner.focus();
  anchor = bookmark = owner = null;
}
function insideEditor() { close(false); }
async function open(existing = null, preview = false) {
  close(false);
  const ed = props.editor;
  if (!ed?.initialized) return;
  owner = ed;
  anchor = existing || ed.dom.getParent(ed.selection.getNode(), "a[href]");
  bookmark = ed.selection.getBookmark(2, true);
  originalText = anchor?.textContent || ed.selection.getContent({format:"text"});
  panel.value = {text:originalText, url:anchor?.getAttribute("href") || "", preview};
  document.addEventListener("pointerdown", outside, true);
  ed.on("mousedown", insideEditor);
  await nextTick();
  if (!preview) urlField.value?.focus();
}
async function edit() { panel.value.preview = false; await nextTick(); urlField.value?.focus(); }
function change(fn) {
  if (!owner || owner !== props.editor || owner.removed) { close(); return; }
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
  const href = safeUrl.value, text = panel.value.text || href;
  change(ed => {
    if (anchor?.isConnected) {
      ed.dom.setAttrib(anchor, "href", href);
      if (text !== originalText) anchor.textContent = text;
    } else if (!ed.selection.isCollapsed() && text === originalText) {
      ed.execCommand("mceInsertLink", false, {href});
    } else {
      const link = ed.getDoc().createElement("a");
      link.href = href; link.textContent = text;
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
function remove() { change(ed => { if (anchor?.isConnected) ed.dom.remove(anchor, true); }); }
onBeforeUnmount(() => close());
defineExpose({ open, close });
</script>
<style scoped>
.link-card { position:absolute; z-index:8; left:4px; bottom:4px; width:max-content; max-width:calc(100% - 8px); display:flex; align-items:center; gap:10px; background:var(--mail-surface); color:var(--regular-text-color); padding:8px 12px; border-radius:8px; box-shadow:0 2px 6px 2px #3c404326,0 1px 2px #3c40434d; font:14px/20px Arial,sans-serif; }
form { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:2px 6px; width:320px; max-width:100%; }
label { display:flex; align-items:center; gap:8px; min-width:0; height:34px; }
label:first-child { grid-column:1/-1; border-bottom:1px solid var(--light-border-color); }
label span { font-size:12px; }
input { flex:1; min-width:0; font:inherit; color:inherit; border:0; background:transparent; outline:none; }
label:focus-within { box-shadow:inset 0 -2px var(--el-color-primary); }
button,a { color:var(--el-color-primary); font:500 14px/20px Arial,sans-serif; }
a { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
button { cursor:pointer; padding:4px 6px; border-radius:4px; }
button:hover:not(:disabled) { background:var(--mail-read); }
.apply-link { border-radius:16px; padding-inline:12px; }
</style>
