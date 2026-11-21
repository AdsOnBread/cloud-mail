<template>
  <div ref="menu" class="filing-menu" role="menu" :aria-label="title" @keydown="navigate" @focusout="leave">
    <div class="filing-title">{{ title }}:</div>
    <div class="filing-search">
      <input ref="input" v-model="query" :aria-label="searchLabel" autocomplete="off" spellcheck="false">
      <Icon icon="material-symbols:search" width="18" aria-hidden="true"/>
    </div>
    <div class="filing-choices"><slot/></div>
    <slot name="apply"/>
    <div class="filing-management">
      <button type="button" role="menuitem" @click="$emit('create')"><span>{{ query.trim() ? '"'+query.trim()+'" (create new)' : 'Create new' }}</span></button>
      <button v-if="showManage" type="button" role="menuitem" @click="$emit('manage')">Manage labels</button>
    </div>
  </div>
</template>
<script setup>
import { ref } from "vue";
import { Icon } from "@iconify/vue";
defineProps({title:String,searchLabel:String,showManage:Boolean});
const query=defineModel({type:String,required:true});
const emit=defineEmits(["create","manage","dismiss","leave"]);
const input=ref(),menu=ref();
defineExpose({focus:()=>input.value?.focus()});
function leave(event) {
  // WebKit can focus the popover itself when a pointer clicks a checkbox.
  const popup=menu.value.closest('.el-popper') || menu.value;
  if (event.relatedTarget && !popup.contains(event.relatedTarget)) emit("leave");
}
function navigate(event) {
  if (event.isComposing || event.keyCode===229) return;
  const buttons=[...menu.value.querySelectorAll('button:not(:disabled)')];
  if (event.key==="Escape") emit("dismiss");
  else if (event.key==="Enter" && event.target===input.value) buttons[0]?.click();
  else if (event.key==="ArrowDown" || event.key==="ArrowUp") {
    const items=[input.value,...buttons], index=items.indexOf(event.target);
    items[(index+(event.key==="ArrowDown" ? 1 : -1)+items.length)%items.length].focus();
  } else return;
  event.preventDefault();
  event.stopPropagation();
}
</script>
<style>
.filing-menu { display:flex; flex-direction:column; max-height:calc(100dvh - 32px); overflow:auto; font:14px/20px Arial,sans-serif; color:var(--el-text-color-primary); }
.filing-title { flex:none; padding:8px 16px; font-weight:500; }
.filing-search { flex:none; display:flex; align-items:center; height:25px; margin:0 8px 16px; border-bottom:1px solid var(--secondary-text-color); }
.filing-search:focus-within { box-shadow:inset 0 -2px var(--el-color-primary); border-color:transparent; }
.filing-search input { min-width:0; width:100%; padding:1px 2px 4px; font:inherit; color:inherit; border:0; outline:0; background:none; }
.filing-search svg { flex:none; margin-right:4px; color:var(--secondary-text-color); }
.filing-choices { min-height:0; max-height:240px; overflow-y:auto; overscroll-behavior:contain; }
.filing-menu button { display:flex; align-items:center; position:relative; flex:none; width:100%; height:32px; padding:6px 16px 6px 48px; text-align:left; color:inherit; font:inherit; cursor:pointer; }
.filing-menu button span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.filing-menu button svg { position:absolute; left:16px; color:var(--regular-text-color); }
.filing-menu button:is(:hover,:focus-visible) { background:var(--mail-hover); }
.filing-management { flex:none; margin-top:6px; padding-top:6px; border-top:1px solid var(--light-border-color); }
.filing-category { padding:6px 16px; font-size:12px; color:var(--secondary-text-color); }
@media (max-height:300px) { .filing-choices { flex-shrink:0; max-height:112px; } }
</style>
