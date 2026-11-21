<template>
  <Teleport to="body">
    <div v-if="photo" ref="bar" role="toolbar" aria-label="Photo options" class="photo-options compose-format-popup"
      :style="position" @keydown="keys" @mousedown.prevent>
      <template v-for="(label, i) in actions" :key="label">
        <span v-if="i" aria-hidden="true">|</span>
        <button type="button" :disabled="i < 2 && !loaded" @click="act(label)">{{ label }}</button>
      </template>
    </div>
    <dialog v-if="editing" ref="altDialog" :aria-labelledby="id+'-title'" class="alt-dialog compose-format-popup"
      @cancel.prevent="close(true)" @keydown.esc.prevent.stop="close(true)">
      <form @submit.prevent="applyAlt">
        <h2 :id="id+'-title'">Alt text</h2>
        <p :id="id+'-help'">Alt text is accessed by screen readers for people who might have trouble seeing your content.</p>
        <label>Description: <input ref="field" v-model="description" :aria-describedby="id+'-help'" autocomplete="off"></label>
        <footer><button type="button" @click="close(true)">Cancel</button><button type="submit" class="apply">Apply</button></footer>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import { photoDimensions } from "./photo-size";

const props = defineProps({ editor: Object });
const emit = defineEmits(["edit-link"]);
const id = useId();
const photo = shallowRef(null), bar = ref(), altDialog = ref(), field = ref();
const editing = ref(false), description = ref(""), loaded = ref(false);
const position = ref({visibility:"hidden"});
const actions = computed(() => {
  const items = ["Small", "Best fit", "Original size", "Edit alt text"];
  if (photo.value?.closest("a[href]")) items.push("Edit link");
  return [...items, "Remove"];
});

function current(image = photo.value) {
  const ed = props.editor;
  return image && ed?.initialized && !ed.removed && ed.getBody()?.contains(image)
    && !image.closest('[contenteditable="false"],[data-mce-bogus]');
}
function imageOnlyLink(image) {
  const link = image.closest("a[href]");
  if (!link) return null;
  for (let node = image; node !== link; node = node.parentNode) {
    if ([...node.parentNode.childNodes].some(sibling => sibling !== node &&
        (sibling.nodeType !== 3 || sibling.textContent.trim()))) return null;
  }
  return link;
}
function caretAfter(image) {
  const ed = props.editor;
  ed.focus();
  const range = ed.getDoc().createRange();
  range.setStartAfter(imageOnlyLink(image) || image);
  range.collapse(true);
  ed.selection.setRng(range);
}
function close(restore = false) {
  const image = photo.value;
  altDialog.value?.close();
  editing.value = false;
  photo.value = null;
  if (restore && current(image)) caretAfter(image);
}
function visibleFrame(frame, bounds) {
  const area = {...bounds};
  for (let parent = frame.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const rect = parent.getBoundingClientRect();
    if (style.overflowX !== "visible") {
      area.left = Math.max(area.left,rect.left + parent.clientLeft);
      area.right = Math.min(area.right,rect.left + parent.clientLeft + parent.clientWidth);
    }
    if (style.overflowY !== "visible") {
      area.top = Math.max(area.top,rect.top + parent.clientTop);
      area.bottom = Math.min(area.bottom,rect.top + parent.clientTop + parent.clientHeight);
    }
  }
  return area;
}
function place() {
  const image = photo.value, popup = bar.value;
  if (!current(image)) { close(); return; }
  const frame = props.editor.iframeElement;
  const rect = frame.getBoundingClientRect();
  if (!rect.width || !rect.height || frame.closest("[inert]")) { close(); return; }
  if (!popup) return;
  loaded.value = image.naturalWidth > 0 && image.naturalHeight > 0;
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
  const right = left + (viewport?.width || document.documentElement.clientWidth);
  const bottom = top + (viewport?.height || document.documentElement.clientHeight);
  if (editing.value) {
    if (altDialog.value) {
      const modal = altDialog.value;
      modal.style.width = Math.max(0,Math.min(560,right-left-16))+"px";
      modal.style.maxHeight = Math.max(0,bottom-top-16)+"px";
      modal.style.left = left+(right-left-modal.offsetWidth)/2+"px";
      modal.style.top = top+(bottom-top-modal.offsetHeight)/2+"px";
    }
    return;
  }
  popup.style.maxWidth = Math.max(0,right-left-8)+"px";
  const clip = visibleFrame(frame,{left:Math.max(rect.left,left),right:Math.min(rect.right,right),
    top:Math.max(rect.top,top),bottom:Math.min(rect.bottom,bottom)});
  const imageRect = image.getBoundingClientRect();
  const x = Math.max(rect.left + frame.clientLeft + imageRect.left, clip.left);
  const y = Math.max(rect.top + frame.clientTop + imageRect.top, clip.top);
  const endX = Math.min(rect.left + frame.clientLeft + imageRect.right, clip.right);
  const endY = Math.min(rect.top + frame.clientTop + imageRect.bottom, clip.bottom);
  if (x >= endX || y >= endY) { close(); return; }
  const below = endY + 3;
  const popY = below + popup.offsetHeight <= bottom - 4 ? below : y - popup.offsetHeight - 3;
  position.value = {
    left: Math.max(left+4, Math.min(x, right-popup.offsetWidth-4)) + "px",
    top: Math.max(top+4, popY) + "px",
  };
}
function focusFirst() { bar.value?.querySelector("button:enabled")?.focus({preventScroll:true}); }
async function open(image, keyboard = false) {
  if (image?.nodeName !== "IMG" || !current(image)) return false;
  close();
  position.value = {visibility:"hidden"};
  loaded.value = Boolean(image.naturalWidth && image.naturalHeight);
  photo.value = image;
  await nextTick();
  if (photo.value !== image) return false;
  place();
  await nextTick();
  if (keyboard) focusFirst();
  return true;
}
function outside(event) {
  if (!editing.value && !bar.value?.contains(event.target)) close();
}
function editorKey(event) {
  if (editing.value) return;
  if (event.key === "Tab" && !event.shiftKey) {
    event.preventDefault(); event.stopImmediatePropagation();
    focusFirst();
  } else {
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); }
    close(event.key === "Escape");
  }
}
watch(photo, (image, _, cleanup) => {
  if (!image) return;
  const ed = props.editor;
  const observer = new ResizeObserver(place);
  observer.observe(image);
  observer.observe(ed.iframeElement);
  // The first render may wrap the toolbar at a narrow viewport width.
  nextTick(() => { if (photo.value===image && bar.value) observer.observe(bar.value); });
  const abort = new AbortController(), opts = {capture:true, signal:abort.signal};
  for (const root of [window, ed.getWin(), window.visualViewport].filter(Boolean)) {
    root.addEventListener("scroll",place,opts);
    root.addEventListener("resize",place,opts);
  }
  for (const name of ["pointerdown","focusin"]) document.addEventListener(name,outside,opts);
  image.addEventListener("load",place,opts);
  image.addEventListener("error",place,opts);
  const end = () => close();
  ed.on("mousedown SetContent Undo Redo remove",end);
  ed.on("keydown",editorKey,true);
  cleanup(() => { abort.abort(); observer.disconnect(); ed.off("mousedown SetContent Undo Redo remove",end); ed.off("keydown",editorKey); });
}, {flush:"sync"});
onBeforeUnmount(() => close());

function mutate(change) {
  const image = photo.value;
  if (!current(image)) { close(); return; }
  const ed = props.editor;
  close();
  caretAfter(image);
  ed.undoManager.transact(() => change(ed,image));
  ed.nodeChanged();
  ed.dispatch("change");
}
function resize(label) {
  mutate((ed,image) => {
    const container = image.closest("td,th") || ed.getBody();
    const style = ed.getWin().getComputedStyle(container);
    const available = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const original = label==="Original size";
    const size = original ? null : photoDimensions(image.naturalWidth,image.naturalHeight,available,label==="Small");
    if (!original && !size) return;
    ed.dom.setStyles(image,{width:null,height:"auto","min-width":null,"min-height":null,"max-width":original ? "none" : "100%","max-height":null});
    ed.dom.setAttribs(image,{width:size?.width ?? null,height:size?.height ?? null});
  });
}
async function act(label) {
  if (!current()) { close(); return; }
  if (label==="Remove") {
    mutate((ed,image) => ed.dom.remove(imageOnlyLink(image) || image));
  } else if (label==="Edit alt text") {
    description.value = photo.value.getAttribute("alt") || "";
    editing.value = true;
    await nextTick();
    if (!editing.value) return;
    altDialog.value.showModal();
    place();
    field.value.focus();
    field.value.select();
  } else if (label==="Edit link") {
    const link=photo.value.closest("a[href]");
    close();
    if (link) emit("edit-link",link);
  } else resize(label);
}
function applyAlt() { mutate((_ed,image) => image.setAttribute("alt",description.value)); }
function keys(event) {
  const buttons = [...bar.value.querySelectorAll("button:enabled")];
  const index = buttons.indexOf(event.target);
  if (event.key==="Escape" || (event.key==="Tab" && (event.shiftKey ? index===0 : index===buttons.length-1))) {
    event.preventDefault(); event.stopPropagation(); close(true); return;
  }
  const delta = {ArrowRight:1,ArrowLeft:-1}[event.key];
  if (delta || event.key==="Home" || event.key==="End") {
    event.preventDefault();
    buttons[delta ? (index+delta+buttons.length)%buttons.length : event.key==="Home" ? 0 : buttons.length-1]?.focus();
  }
}
defineExpose({open,close});
</script>
<style scoped>
.photo-options {position:fixed;z-index:2400;box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:0 6.75px;width:max-content;max-width:calc(100vw - 8px);padding:5px 8px;border:1px solid var(--light-border-color);border-radius:2px;background:var(--mail-surface);box-shadow:0 2px 5px #0003;color:var(--regular-text-color);font:13px/16.5px Arial,sans-serif}
.photo-options button {padding:0;background:transparent;border:0;color:#1155cc;font:inherit;white-space:nowrap;cursor:pointer}
:global(.dark) .photo-options button {color:#a8c7fa}
.photo-options button:disabled {color:var(--secondary-text-color);cursor:default}
.photo-options button:enabled:hover {text-decoration:underline}
.photo-options button:focus-visible,.alt-dialog button:focus-visible {outline:2px solid var(--el-color-primary);outline-offset:1px}
.alt-dialog {position:fixed;inset:auto;margin:0;box-sizing:border-box;width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 16px);overflow:auto;padding:24px;border:0;border-radius:28px;color:var(--el-text-color-primary);background:var(--mail-surface);box-shadow:0 8px 32px #0003;font:14px/20px Arial,sans-serif}
.alt-dialog::backdrop {background:rgb(0 0 0 / .38)}
form {min-height:min(230px,calc(100dvh - 68px));display:flex;flex-direction:column;gap:16px}
h2 {font-size:24px;line-height:32px;font-weight:400;margin:0}
p {margin:0}
label {display:flex;align-items:center;gap:8px}
input {width:0;max-width:391px;flex:1;height:26px;border:1px solid var(--el-border-color);color:inherit;background:transparent;padding:2px 5px}
input:focus {outline:1px solid var(--el-color-primary)}
footer {margin-top:auto;display:flex;justify-content:flex-end;gap:8px}
footer button {padding:0 18px;height:40px;border-radius:20px;color:var(--el-color-primary);font-weight:500;cursor:pointer}
footer button:hover {background:var(--mail-hover)}
footer .apply {color:white;background:var(--el-color-primary)}
</style>
