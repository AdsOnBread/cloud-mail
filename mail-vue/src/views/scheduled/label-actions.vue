<template>
  <el-popover :visible="open" placement="bottom-start" :width="210" :show-arrow="false" :persistent="false"
    popper-class="mail-action-menu scheduled-more-menu" @after-enter="open && item?.focus()">
    <template #reference>
      <button ref="trigger" type="button" class="mail-icon" aria-label="More email options" data-tip="More"
        aria-haspopup="menu" :aria-expanded="open" :disabled="disabled" @click="open=!open" @keydown.down.prevent="open=true">
        <Icon icon="material-symbols:more-vert" width="20"/>
      </button>
    </template>
    <div ref="panel" role="menu" aria-label="More email options" @keydown.esc.stop.prevent="finish">
      <button ref="item" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="!!picker?.open"
        :aria-disabled="filingDisabled" @pointermove="$event.pointerType==='mouse' && show()"
        @keydown.right.stop.prevent="show" @click="show">
        Label as <Icon icon="material-symbols:arrow-right" width="18"/>
      </button>
      <LabelPicker v-if="item" ref="picker" scheduled external submenu :reference="item" :rows="rows"
        :return-focus="focus" :disabled="filingDisabled" @finish="finish" @apply="(...args)=>emit('apply',...args)"/>
    </div>
  </el-popover>
</template>
<script setup>
import {ref,watch,onBeforeUnmount} from 'vue';
import {Icon} from '@iconify/vue';
import LabelPicker from '@/components/mail-labels/picker.vue';
const props=defineProps({rows:Array,disabled:Boolean,filingDisabled:Boolean});
const emit=defineEmits(['apply']);
const trigger=ref(),panel=ref(),item=ref(),picker=ref(),open=ref(false);
function focus(){trigger.value?.focus();}
function finish(){open.value=false;focus();}
function show(){if(!props.filingDisabled) picker.value?.show();}
function outside(event){
  const target=event.target;
  if (!trigger.value?.contains(target) && !panel.value?.contains(target) && !target.closest?.('.scheduled-label-flyout')) open.value=false;
}
function listen(on) {
  for(const type of ['pointerdown','focusin']) {
    if(on) document.addEventListener(type,outside,true);
    else document.removeEventListener(type,outside,true);
  }
}
watch(open,listen);
watch(()=>JSON.stringify(props.rows.map(({draftId,version})=>[draftId,version])),()=>{open.value=false;});
onBeforeUnmount(()=>listen(false));
defineExpose({focus});
</script>
<style scoped>
[role=menuitem] {display:flex;align-items:center;justify-content:space-between;width:100%;height:32px;padding:0 12px 0 20px;color:inherit;cursor:pointer;font:14px/20px Arial,sans-serif;text-align:start}
[role=menuitem]:is(:hover,:focus-visible,[aria-expanded=true]) {background:var(--mail-hover)}
[role=menuitem][aria-disabled=true] {opacity:.45;cursor:default}
:global(.scheduled-more-menu.el-popover.el-popper) {padding:6px 0}
</style>
