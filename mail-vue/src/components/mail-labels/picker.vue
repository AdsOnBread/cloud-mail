<template>
  <el-popover v-model:visible="open" :trigger="external ? [] : 'click'" placement="bottom-start"
    :virtual-triggering="external" :virtual-ref="reference" :width="241" :show-arrow="false"
    popper-class="label-picker" @after-enter="open && menu?.focus()">
    <template v-if="!external" #reference>
      <button ref="trigger" class="mail-icon" aria-label="Label as" data-tip="Labels" aria-haspopup="menu"
        :disabled="disabled" :aria-expanded="open"><Icon icon="material-symbols:label-outline" width="20"/></button>
    </template>
    <FilingMenu ref="menu" v-model="query" title="Label as" search-label="Search labels" :show-manage="!query.trim()"
      @dismiss="dismiss" @leave="open=false" @create="createLabel" @manage="manageLabels">
      <button v-for="label in filtered" :key="label.id" type="button" role="menuitemcheckbox" :aria-checked="state(label.id)"
        :title="label.name" @click="toggle(label.id)">
        <Icon :icon="checkboxIcon(state(label.id))" width="18"/><span>{{label.name}}</span>
      </button>
      <template #apply>
        <button v-if="Object.keys(changes).length" type="button" role="menuitem" @click="apply">Apply</button>
      </template>
    </FilingMenu>
  </el-popover>
</template>
<script setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import FilingMenu from "./filing-menu.vue";
import { useMailLabels } from "@/store/mail-labels";
const props = defineProps({ rows:{type:Array,required:true}, disabled:Boolean, external:Boolean, reference:Object, trash:Boolean, scheduled:Boolean });
const emit = defineEmits(["apply"]);
const router=useRouter(), labels=useMailLabels();
const open=ref(false), query=ref(""), changes=ref({}), menu=ref(), trigger=ref();
const filtered=computed(()=>labels.items.filter(item=>item.name.toLowerCase().includes(query.value.trim().toLowerCase())));
const rowIds=computed(()=>props.scheduled ? props.rows.map(({draftId,version})=>({draftId,version})) : props.rows.map(row=>row.lastEmailId));
let anchors=[];
defineExpose({show:()=>{if (!props.disabled && rowIds.value.length) open.value=true;}});
watch(open,value=>{
  if (value) {
    query.value="";
    changes.value={};
    anchors=[...rowIds.value];
  }
});
watch(()=>JSON.stringify(rowIds.value),()=>{open.value=false;});
function restoreFocus() { (props.reference || trigger.value)?.focus(); }
function dismiss() { open.value=false; restoreFocus(); }
function createLabel() {
  dismiss();
  labels.edit={clientId:crypto.randomUUID(),name:query.value.trim(),anchors:[...anchors],trash:props.trash,scheduled:props.scheduled,restoreFocus};
}
function manageLabels() { dismiss(); router.push({name:'label-settings'}); }
function currentState(id) {
  const count=props.rows.filter(row=>row.labelIds?.includes(id)).length;
  return count===0 ? false : count===props.rows.length ? true : "mixed";
}
function state(id) { return changes.value[id] ?? currentState(id); }
function checkboxIcon(value) {
  return "material-symbols:"+(value==="mixed" ? "indeterminate-check-box" : value ? "check-box" : "check-box-outline-blank");
}
function toggle(id) {
  const next=state(id)!==true;
  if (next===currentState(id)) delete changes.value[id];
  else changes.value[id]=next;
}
function apply() {
  const ops={add:[],remove:[]};
  for (const [id,on] of Object.entries(changes.value)) ops[on ? "add" : "remove"].push(Number(id));
  dismiss();
  emit("apply",ops,anchors);
}
</script>
