<template>
  <el-popover :visible="open" placement="top-end" :show-arrow="false" :width="228"
    :persistent="false" popper-class="compose-format-popup compose-choice-popup">
    <template #reference><span class="more-anchor">
      <button ref="trigger" type="button" class="compose-tool more-trigger" aria-label="More options" data-tip="More options"
        aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? id : undefined" :disabled="disabled"
        @click="toggleMenu" @keydown.down.prevent="openMenu">
        <Icon icon="material-symbols:more-vert" width="20"/>
      </button>
    </span></template>
    <div :id="id" ref="menu" role="menu" aria-label="More options" @keydown="menuKeys">
      <button role="menuitemcheckbox" :aria-checked="fullScreen" @pointerenter="closeLabels" @click="command('fullscreen')">
        <span><Icon v-if="fullScreen" icon="material-symbols:check" width="18"/></span>Default to full screen
      </button>
      <button role="menuitemcheckbox" :aria-checked="plainText" @pointerenter="closeLabels" @click="command('plain')">
        <span><Icon v-if="plainText" icon="material-symbols:check" width="18"/></span>Plain text mode
      </button>
      <hr>
      <button role="menuitem" @pointerenter="closeLabels" @click="command('print')"><span/>Print</button>
      <el-popover :visible="labelsOpen" placement="left-start" :fallback-placements="['right-start','top-end','bottom-end']"
        :show-arrow="false" :width="257" :offset="0" :persistent="false"
        popper-class="compose-format-popup compose-choice-popup compose-label-popup">
        <template #reference><span class="label-anchor">
          <button ref="labelButton" role="menuitem" aria-haspopup="menu" :aria-expanded="labelsOpen" :aria-controls="labelsOpen ? id+'-labels' : undefined"
            @pointermove="$event.pointerType === 'mouse' && showLabels(false)" @keydown.right.stop.prevent="showLabels(true)" @click="showLabels(true)">
            <span/>Label<Icon class="arrow" icon="material-symbols:arrow-right" width="18"/>
          </button>
        </span></template>
        <div :id="id+'-labels'" ref="panel" role="menu" aria-label="Label as" @keydown="labelKeys">
          <div class="search-title">Label as:</div>
          <div class="label-search">
            <input ref="input" v-model="query" aria-label="Search labels" autocomplete="off" spellcheck="false">
            <Icon icon="material-symbols:search" width="16"/>
          </div>
          <div class="choices">
            <button v-for="item in filtered" :key="item.id" role="menuitemcheckbox"
              :aria-checked="selected.includes(item.id)" :title="item.name" @click="toggleLabel(item.id)">
              <Icon :icon="selected.includes(item.id) ? 'material-symbols:check-box' : 'material-symbols:check-box-outline-blank'" width="18"/>
              <span class="name">{{ item.name }}</span>
            </button>
          </div>
          <button v-if="changed" role="menuitem" @click="apply"><span/>Apply</button>
          <hr>
          <button role="menuitemcheckbox" :aria-checked="Boolean(starred)" @click="star">
            <Icon :icon="starred ? 'material-symbols:star' : 'material-symbols:star-outline'" width="18"/>
            {{ starred ? 'Remove star' : 'Add star' }}
          </button>
          <button role="menuitem" @click="command('new-label')"><span/>Create new</button>
          <button role="menuitem" @click="command('manage-labels')"><span/>Manage labels</button>
          <button v-if="labels.error" role="menuitem" @click="labels.load()">Retry loading labels</button>
        </div>
      </el-popover>
    </div>
  </el-popover>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { Icon } from "@iconify/vue";
import { useMailLabels } from "@/store/mail-labels";
const props = defineProps({disabled:Boolean, active:Boolean, fullScreen:Boolean, plainText:Boolean, starred:[Boolean,Number], labelIds:Array});
const emit = defineEmits(["command","labels","star"]);
const labels = useMailLabels();
const id=useId();
defineExpose({focus:()=>trigger.value?.focus()});
const trigger=ref(), menu=ref(), labelButton=ref(), panel=ref(), input=ref();
const open=ref(false), labelsOpen=ref(false), query=ref(""), selected=ref([]);
const filtered=computed(()=>labels.items.filter(item=>item.name.toLowerCase().includes(query.value.trim().toLowerCase())));
const changed=computed(()=>selected.value.length!==(props.labelIds || []).length || selected.value.some(id=>!props.labelIds?.includes(id)));
function closeLabels() { labelsOpen.value=false; }
function close(focus=false) {
  closeLabels();
  open.value=false;
  if(focus) trigger.value?.focus();
}
function openMenu() {
  open.value=true;
  nextTick(()=>menu.value?.querySelector('button')?.focus());
}
function toggleMenu() { if(open.value) close(true); else openMenu(); }
function command(name) { close(true); emit("command",name); }
function showLabels(focus) {
  if(!labelsOpen.value) {
    selected.value=[...(props.labelIds || [])];
    query.value="";
    labelsOpen.value=true;
  }
  if(focus) nextTick(()=>input.value?.focus());
}
function toggleLabel(id) {
  selected.value=selected.value.includes(id) ? selected.value.filter(other=>other!==id) : [...selected.value,id];
}
function apply() { emit("labels",selected.value); close(true); }
function star() { emit("star",!props.starred); close(true); }
function move(event,root) {
  const options=[...root.querySelectorAll("button:not(:disabled),input")];
  const index=options.indexOf(document.activeElement);
  const delta=event.key==="ArrowUp" ? -1 : 1;
  options[(index+delta+options.length)%options.length]?.focus();
  event.preventDefault();event.stopPropagation();
}
function menuKeys(event) {
  if (event.key==="Escape") {event.stopPropagation();event.preventDefault();close(true);}
  else if (["ArrowDown","ArrowUp"].includes(event.key)) move(event,menu.value);
}
function labelKeys(event) {
  if(event.key==="Escape" || (event.key==="ArrowLeft" && event.target!==input.value)) {
    event.preventDefault();event.stopPropagation();closeLabels();labelButton.value?.focus();
  } else if(["ArrowDown","ArrowUp"].includes(event.key)) move(event,panel.value);
}
function outside(event) {
  if (![trigger.value,menu.value,panel.value].some(node=>node?.contains(event.target))) close();
}
watch(open,value=>{
  for(const name of ["pointerdown","focusin"]) {
    if(value) document.addEventListener(name,outside,true);
    else document.removeEventListener(name,outside,true);
  }
});
watch(()=>props.active && !props.disabled,active=>{if(!active)close();});
onBeforeUnmount(()=>{for(const name of ["pointerdown","focusin"]) document.removeEventListener(name,outside,true);});
</script>
<style scoped>
.more-anchor {display:inline-flex}
.label-anchor {display:block}
.more-trigger {display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;color:var(--regular-text-color);cursor:pointer}
.more-trigger:hover {background:var(--base-fill)}
:global(.compose-choice-popup.el-popover) {padding:6px 0;border:0;border-radius:4px;background:var(--mail-surface);box-shadow:0 2px 6px #0003,0 8px 24px #0002;max-width:calc(100vw - 12px)}
[role="menu"] {color:var(--el-text-color-primary);font-size:14px;max-height:min(470px,calc(100dvh - 26px));overflow:auto}
[role="menu"] button {display:flex;align-items:center;gap:9px;width:100%;height:32px;padding:0 16px;cursor:pointer;color:inherit;text-align:left;font:inherit}
[role="menu"] button:hover,[role="menu"] button:focus-visible,[aria-expanded="true"] {background:var(--mail-hover)}
button>span:first-child {width:18px;flex:none}
.arrow {margin-left:auto}
hr {border:0;border-top:1px solid var(--compose-divider);margin:5px 0}
.choices {max-height:min(260px,32vh);overflow:auto}
.name {overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.search-title {padding:6px 16px}
.label-search {display:flex;align-items:center;border:1px solid var(--el-border-color);height:26px;margin:0 16px 5px;padding:0 5px}
.label-search:focus-within {border-color:var(--el-color-primary)}
.label-search input {min-width:0;flex:1;color:inherit;background:transparent;border:0;outline:0}
</style>
