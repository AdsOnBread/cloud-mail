<template>
  <div class="category-actions">
    <el-popover v-model:visible="open" trigger="click" placement="bottom-start" :offset="0" :width="131"
      :show-arrow="false" :persistent="false" popper-class="label-options-popover category-options-popover"
      @after-enter="focusFirst">
      <template #reference>
        <button ref="trigger" type="button" class="mail-icon category-trigger" :aria-label="title" data-tip="More options"
          aria-haspopup="menu" :aria-expanded="open" @keydown.down.prevent="open=true">
          <Icon icon="material-symbols:more-vert" width="20"/>
        </button>
      </template>
      <div ref="menu" role="menu" :aria-label="title" @keydown="navigate">
        <div v-for="group in groups" :key="group.key" role="group" :aria-label="group.name">
          <div class="group-name">{{ group.name }}</div>
          <button v-for="mode in ['show','hide']" :key="mode" type="button" role="menuitemcheckbox"
            :aria-checked="group.mode===mode" :aria-disabled="busy || !ready" @click="choose(group,mode)">
            <Icon v-if="group.mode===mode && ready" icon="material-symbols:check" width="16"/>
            {{ mode==='show' ? 'Show' : 'Hide' }}
          </button>
        </div>
        <p v-if="error || labels.systemError" role="alert">{{ error || labels.systemError }}</p>
      </div>
    </el-popover>
  </div>
</template>

<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {Icon} from '@iconify/vue';
import {useMailLabels} from '@/store/mail-labels';
import {categoryMessageKey} from '@/utils/inbox-categories';
import {folderMode} from './system-folders';

const props=defineProps({folder:{type:Object,required:true},restoreFocus:{type:Function,required:true}});
const labels=useMailLabels(),open=ref(false),busy=ref(false),error=ref('');
const menu=ref(null),trigger=ref(null);
const title=computed(()=>'Options for '+props.folder.name);
const ready=computed(()=>labels.systemReady && !labels.systemError);
const groups=computed(()=>{
  const id=props.folder.id;
  const result=[{key:id,name:'In label list',mode:folderMode(props.folder,labels.system)}];
  if(id!=='purchases') {
    const key=categoryMessageKey(id);
    result.push({key,name:'In message list',mode:labels.system[key] || 'hide'});
  }
  return result;
});
const anchorId=Symbol('category menu');
function releaseAnchor(){
  if(labels.optionsAnchor===anchorId)labels.optionsAnchor=null;
}
onBeforeUnmount(releaseAnchor);
watch(open,visible=>{
  if(visible)labels.optionsAnchor=anchorId;
  else releaseAnchor();
  if(visible){error.value='';if(!ready.value)labels.loadSystem();}
});
function focusFirst(){
  const focused=document.activeElement;
  if(open.value && (focused===trigger.value || focused===document.body))menu.value?.querySelector('button')?.focus();
}
function dismiss(){
  open.value=false;
  trigger.value?.focus();
}
function navigate(event){
  if(event.key==='Tab'){dismiss();return;}
  if(event.key==='Escape')dismiss();
  else {
    const items=Array.from(menu.value.querySelectorAll('button'));
    const index=items.indexOf(event.target);
    if(event.key==='Home')items[0]?.focus();
    else if(event.key==='End')items.at(-1)?.focus();
    else if(['ArrowUp','ArrowDown'].includes(event.key))items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
    else return;
  }
  event.preventDefault();event.stopPropagation();
}
async function choose(group,mode){
  if(busy.value || !ready.value)return;
  if(group.mode===mode){dismiss();return;}
  const owner=labels.owner,token=labels.sessionToken,id=props.folder.id;
  const popup=menu.value;
  busy.value=true;error.value='';
  try {
    await labels.setSystem(group.key,mode);
    if(owner!==labels.owner || token!==labels.sessionToken || !open.value)return;
    open.value=false;
    // Moving between the two folder groups replaces the trigger and its menu.
    const focused=document.activeElement;
    if(focused===document.body || popup?.contains(focused) || focused===trigger.value)await props.restoreFocus(id);
  } catch(e) {
    if(owner===labels.owner && token===labels.sessionToken)error.value=e.message || 'Could not save this setting.';
  } finally {busy.value=false;}
}
</script>

<style scoped>
.category-actions { position:absolute; inset-inline-end:6px; top:50%; transform:translateY(-50%); }
.category-trigger { width:20px; height:20px; opacity:0; color:inherit; }
:global(.folder-line:hover .category-trigger),:global(.folder-line:focus-within .category-trigger),.category-trigger[aria-expanded=true] { opacity:1; pointer-events:auto; }
:global(.mail-layout.nav-compact .category-actions) { display:none; }
@media (hover:none) { .category-actions { inset-inline-end:0; } .category-trigger { width:32px; height:32px; opacity:1; pointer-events:auto; } }
.group-name { box-sizing:border-box; height:32px; padding:6px 16px; white-space:nowrap; font:500 14px/20px Arial,sans-serif; color:var(--secondary-text-color); }
[role=group]+[role=group] { border-top:1px solid var(--light-border-color); margin-top:6px; padding-top:6px; }
[role=menuitemcheckbox] { position:relative; display:flex; align-items:center; width:100%; height:32px; padding:0 12px 0 48px; color:inherit; font:14px/20px Arial,sans-serif; text-align:start; cursor:pointer; }
[role=menuitemcheckbox] svg { position:absolute; inset-inline-start:16px; }
[role=menuitemcheckbox]:is(:hover,:focus-visible) { background:var(--mail-hover); }
[role=alert] { margin:4px 12px; font-size:12px; }
:global(.el-popper.category-options-popover) { min-width:0; max-height:calc(100dvh - 16px); overflow:auto; }
</style>
