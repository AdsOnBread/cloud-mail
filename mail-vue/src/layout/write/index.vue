<template>
  <div v-for="item in windows" :key="item.key" class="writer-slot"
    v-show="!item.open || layout.positions.has(item.key)" :style="position(item)"
    @pointerdown.capture="activate(item)" @focusin="activate(item)">
    <MessageComposer :ref="node=>remember(item.key,node)"
      :dock-active="item.key===active" :dock-hidden="item.open && !layout.positions.has(item.key)"
      @editor-focus="activate(item)" @dock-state="update(item,$event)"
      @closed="remove(item)" @sent="remove(item)"/>
  </div>
  <div v-if="hidden.length && !layout.exclusive" class="dock-switcher" :style="{right:layout.right+'px'}">
  <el-dropdown trigger="click" placement="top-start" :show-arrow="false" @command="switchTo">
    <button class="more-drafts" aria-label="More compose windows" data-tip="More compose windows"><Icon icon="material-symbols:more-horiz" width="20"/><span>{{hidden.length}}</span></button>
    <template #dropdown><el-dropdown-menu>
      <el-dropdown-item v-for="item in hidden" :key="item.key" :command="item.key">{{item.caption || 'New Message'}}</el-dropdown-item>
    </el-dropdown-menu></template>
  </el-dropdown>
  </div>
</template>
<script setup>
import {computed,nextTick,onMounted,onBeforeUnmount,ref} from 'vue';
import {Icon} from '@iconify/vue';
import MessageComposer from '@/components/message-composer/index.vue';
import {discardDrafts} from '@/services/cloud-drafts';
import {useMailFeedback} from '@/store/mail-feedback';
import {dockLayout} from './dock';
const feedback=useMailFeedback();
const editors=new Map();
let serial=0,usage=0;
function empty(){return {key:++serial,used:0,open:false,minimized:false,expanded:false,caption:'',draftId:null};}
const windows=ref([empty()]),active=ref(windows.value[0].key),viewport=ref(window.innerWidth);
const occupied=computed(()=>windows.value.filter(item=>item.open));
const layout=computed(()=>dockLayout(occupied.value,viewport.value,active.value));
const hidden=computed(()=>occupied.value.filter(item=>!layout.value.positions.has(item.key)));
function remember(key,node){if(node) editors.set(key,node);else editors.delete(key);}
function position(item){
  const rect=layout.value.positions.get(item.key);
  return rect ? {'--dock-right':rect.right+'px','--dock-width':rect.width+'px'} : {};
}
function update(item,state){Object.assign(item,state);}
function activate(item){
  if(!item.open || active.value===item.key) return;
  active.value=item.key;
  item.used=++usage;
}
function remove(item){
  windows.value=windows.value.filter(row=>row.key!==item.key);
  if(!windows.value.length) windows.value.push(empty());
  if(active.value===item.key) active.value=windows.value.reduce((a,b)=>a.used>b.used?a:b).key;
}
async function switchTo(key){
  const item=windows.value.find(row=>row.key===key);
  if(!item) return;
  activate(item);await nextTick();
  editors.get(key)?.focusWindow();
}
async function launch(method,arg){
  if(method==='openDraft'){
    const existing=occupied.value.find(item=>item.draftId===arg.draftId || item.requestedId===arg.draftId);
    if(existing){await switchTo(existing.key);return;}
  }
  let item=windows.value.find(row=>!row.open);
  if(!item){windows.value.push(empty());item=windows.value.at(-1);}
  item.open=true;item.used=++usage;active.value=item.key;
  item.requestedId=method==='openDraft' ? arg.draftId : null;
  await nextTick();
  const editor=editors.get(item.key);
  if(!editor) return;
  try {await editor[method](arg);}
  finally {
    item.requestedId=null;
    if(!editor.visible && windows.value.includes(item)) remove(item);
  }
}
async function discardEditor(ids,session){
  const matches=occupied.value.filter(item=>ids.includes(item.draftId) || ids.includes(item.requestedId));
  if(!matches.length)return false;
  const locked=[];
  try{
    for(const item of matches){
      const editor=editors.get(item.key);
      if(!editor)throw new Error('Wait until the draft is open before discarding.');
      const expected=await editor.prepareDiscard(session);
      locked.push({editor,expected});
    }
    const recovery=await discardDrafts(ids,locked.map(item=>item.expected),session);
    feedback.dismissedDrafts(recovery);
    for(const {editor} of locked)editor.finishDiscard();
    return true;
  }finally{for(const {editor} of locked)editor.unlockDiscard();}
}
async function followDelivery(...args){
  await nextTick();
  return editors.get(windows.value[0]?.key)?.followDelivery(...args);
}
function resize(){viewport.value=window.innerWidth;}
onMounted(()=>window.addEventListener('resize',resize));
onBeforeUnmount(()=>window.removeEventListener('resize',resize));
defineExpose({open:()=>launch('open'),openReply:email=>launch('openReply',email),openReplyAll:email=>launch('openReplyAll',email),
  openForward:email=>launch('openForward',email),openDraft:draft=>launch('openDraft',draft),followDelivery,discardEditor});
</script>
<style scoped>
.writer-slot{display:contents}
.dock-switcher{position:fixed;bottom:0;z-index:200}
.more-drafts{display:flex;align-items:center;justify-content:center;gap:2px;min-width:40px;height:40px;padding:0 4px;background:var(--mail-compose-header);color:var(--el-text-color-primary);border-radius:8px 8px 0 0;box-shadow:0 2px 8px #0003;cursor:pointer}
</style>
