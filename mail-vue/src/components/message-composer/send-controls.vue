<template>
  <div ref="group" class="split-send">
    <button type="button" class="send-primary" :disabled="busy" :aria-keyshortcuts="shortcut"
      :data-tip="tip" @click="$emit('send',$event.currentTarget)">
      <span v-if="busy" class="send-spinner" aria-hidden="true"/>{{ sending ? "Sending…" : "Send" }}
    </button>
    <button ref="trigger" type="button" class="send-options" aria-label="More send options" data-tip="More send options"
      aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? id : undefined" :disabled="busy"
      @click="toggle" @keydown.down.prevent.stop="selectItem" @keydown.up.prevent.stop="selectItem"
      @keydown.esc="escapeMenu" @keydown.tab="close(false)">
      <Icon icon="material-symbols:arrow-drop-down" width="20"/>
    </button>
    <Teleport to="body">
      <div v-if="open" :id="id" ref="menu" role="menu" aria-label="More send options"
        class="send-menu compose-format-popup" :style="position" @keydown.esc.stop.prevent="close(true)"
        @keydown.tab="close(true)">
        <button ref="item" type="button" role="menuitem" tabindex="-1" @click="choose"
          @keydown.up.stop.prevent @keydown.down.stop.prevent>
          <Icon icon="material-symbols:schedule-send-outline" width="20"/>Schedule send
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import {nextTick, ref, useId, watch} from "vue";
import {Icon} from "@iconify/vue";
const props = defineProps({busy:Boolean, sending:Boolean, active:Boolean, tip:String, shortcut:String});
const emit = defineEmits(["send","schedule"]);
const group=ref(null), trigger=ref(null), menu=ref(null), item=ref(null);
const id=useId(), open=ref(false), position=ref({});
function place() {
  if (!group.value || !menu.value) return;
  const anchor=group.value.getBoundingClientRect(), box=menu.value.getBoundingClientRect();
  const viewport=window.visualViewport, x=viewport?.offsetLeft || 0, y=viewport?.offsetTop || 0;
  const right=x+(viewport?.width || document.documentElement.clientWidth);
  const bottom=y+(viewport?.height || document.documentElement.clientHeight);
  const above=anchor.top-box.height;
  const top=above>=y || anchor.bottom+box.height>bottom ? above : anchor.bottom;
  position.value={left:Math.max(x,Math.min(anchor.left,right-box.width))+"px",
    top:Math.max(y,Math.min(top,bottom-box.height))+"px"};
}
function close(restore) {
  if (!open.value) return;
  open.value=false;
  if (restore) trigger.value?.focus({preventScroll:true});
}
function escapeMenu(event) {
  if (!open.value) return;
  event.stopPropagation(); event.preventDefault();
  close(true);
}
function toggle(event) {
  if (open.value) close(true);
  else if (!event.detail) selectItem();
  else {
    trigger.value.focus({preventScroll:true});
    open.value=true;
  }
}
async function selectItem() {
  open.value=true;
  await nextTick();
  item.value?.focus({preventScroll:true});
}
function choose() {
  close(true);
  emit("schedule",trigger.value);
}
watch(() => props.active && !props.busy, active => { if (!active) close(false); });
watch(open, async (visible,_,cleanup) => {
  if (!visible) return;
  const outside=event=>{
    if (!menu.value?.contains(event.target) && trigger.value!==event.target && !trigger.value?.contains(event.target))
      close(false);
  };
  const blur=()=>close(false);
  document.addEventListener("pointerdown",outside,true);
  document.addEventListener("focusin",outside,true);
  window.addEventListener("blur",blur);
  window.addEventListener("scroll",place,true);
  window.addEventListener("resize",place);
  window.visualViewport?.addEventListener("resize",place);
  window.visualViewport?.addEventListener("scroll",place);
  const observer=new ResizeObserver(place);
  cleanup(()=>{
    observer.disconnect();
    document.removeEventListener("pointerdown",outside,true);
    document.removeEventListener("focusin",outside,true);
    window.removeEventListener("blur",blur);
    window.removeEventListener("scroll",place,true);
    window.removeEventListener("resize",place);
    window.visualViewport?.removeEventListener("resize",place);
    window.visualViewport?.removeEventListener("scroll",place);
  });
  await nextTick();
  if (open.value && menu.value) {
    place(); observer.observe(group.value); observer.observe(menu.value);
  }
});
</script>

<style scoped>
.split-send {display:inline-flex; flex:none; align-items:stretch;}
.send-primary,.send-options {
  height:36px; display:inline-flex; align-items:center; justify-content:center;
  background:var(--send-blue); color:var(--send-ink); border:0; cursor:pointer;
}
.send-primary { min-width:72px; padding:0 18px; gap:6px; font:500 14px/20px Arial,sans-serif; border-radius:18px 0 0 18px; }
.send-options { width:33px; padding:0; border-radius:0 18px 18px 0; border-left:1px solid var(--send-ink); }
.send-primary:hover,.send-options:hover {background:color-mix(in srgb,var(--send-blue),var(--send-ink) 8%);}
.send-primary:focus-visible,.send-options:focus-visible,.send-options[aria-expanded=true] {
  background:color-mix(in srgb,var(--send-blue),var(--send-ink) 24%);
}
.send-primary:disabled,.send-options:disabled {opacity:.65; cursor:default;}
.send-spinner {width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:send-spin .7s linear infinite;}
@keyframes send-spin {to{transform:rotate(1turn);}}
@media(prefers-reduced-motion:reduce){.send-spinner{animation:none;}}
.send-menu {
  position:fixed;z-index:2400;box-sizing:border-box;width:min(158px,100vw);padding:6px 0;
  border-radius:4px;background:var(--mail-surface);color:var(--el-text-color-primary);
  box-shadow:0 8px 10px 1px #00000024,0 3px 14px 2px #0000001f,0 5px 5px -3px #0003;
}
.send-menu button {display:flex;align-items:center;gap:12px;width:100%;height:32px;padding:0 16px;border:0;
  background:transparent;color:inherit;cursor:pointer;font:400 14px/20px Arial,sans-serif;text-align:left;}
.send-menu button:hover,.send-menu button:focus {background:#eee;outline:0;}
:global(html.dark) .send-menu button:hover,:global(html.dark) .send-menu button:focus {background:#393a3e;}
</style>
