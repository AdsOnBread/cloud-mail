<template>
  <el-popover v-model:visible="open" :trigger="external ? [] : 'click'" :placement="submenu ? 'right-start' : 'bottom-start'" :offset="submenu ? 0 : undefined"
    :fallback-placements="submenu ? ['left-start','bottom-end','bottom-start','top-end','top-start'] : undefined"
    :virtual-triggering="external" :virtual-ref="reference" :width="241" :show-arrow="false"
    :popper-class="submenu ? 'label-picker scheduled-label-flyout filing-submenu' : 'label-picker'" @after-enter="open && menu?.focus()">
    <template v-if="!external" #reference>
      <button ref="trigger" class="mail-icon" aria-label="Label as" data-tip="Labels" aria-haspopup="menu"
        :disabled="disabled" :aria-expanded="open"><Icon icon="material-symbols:label-outline" width="20"/></button>
    </template>
    <FilingMenu ref="menu" v-model="query" title="Label as" search-label="Search labels" :show-manage="!query.trim()"
      @keydown.left="backToParent" @dismiss="dismiss" @leave="open=false" @create="createLabel" @manage="manageLabels">
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
import {useUserStore} from "@/store/user";
import {useAccountStore} from "@/store/account";
import { useMailLabels } from "@/store/mail-labels";
const props = defineProps({ rows:{type:Array,required:true}, disabled:Boolean, external:Boolean, reference:Object, trash:Boolean, scheduled:Boolean, submenu:Boolean, returnFocus:Function });
const emit = defineEmits(["apply","finish","back"]);
const router=useRouter(), labels=useMailLabels(), user=useUserStore(), account=useAccountStore();
const open=ref(false), query=ref(""), changes=ref({}), menu=ref(), trigger=ref();
const filtered=computed(()=>labels.items.filter(item=>item.name.toLowerCase().includes(query.value.trim().toLowerCase())));
const rowIds=computed(()=>props.scheduled ? props.rows.map(({draftId,version})=>({draftId,version})) : props.rows.map(row=>row.lastEmailId));
let anchors=[], sessionToken, mailbox;
function validSelection() {
  return sessionToken && sessionToken===user.authenticatedToken && sessionToken===localStorage.getItem("token") &&
    mailbox===account.currentAccountId && !props.disabled;
}
defineExpose({show:()=>{if (!props.disabled && rowIds.value.length) open.value=true;},open});
watch(open,value=>{
  if (value) {
    sessionToken=user.authenticatedToken;mailbox=account.currentAccountId;
    if(!validSelection()){open.value=false;return;}
    query.value="";
    changes.value={};
    anchors=[...rowIds.value];
  }
});
watch([()=>JSON.stringify(rowIds.value),()=>user.authenticatedToken,()=>account.currentAccountId],()=>{open.value=false;});
function restoreFocus() { (props.reference || trigger.value)?.focus(); }
function dismiss() { open.value=false; restoreFocus(); emit("back"); }
function backToParent(event) {
  if (!props.submenu || event.isComposing || event.target.matches('input,textarea')) return;
  event.preventDefault();
  event.stopPropagation();
  dismiss();
}
function createLabel() {
  if(!validSelection())return dismiss();
  dismiss();
  labels.edit={clientId:crypto.randomUUID(),name:query.value.trim(),anchors:[...anchors],trash:props.trash,scheduled:props.scheduled,restoreFocus:props.returnFocus || restoreFocus};
  emit("finish");
}
function manageLabels() { dismiss(); emit('finish'); router.push({name:'label-settings'}); }
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
  if(!validSelection())return dismiss();
  const ops={add:[],remove:[]};
  for (const [id,on] of Object.entries(changes.value)) ops[on ? "add" : "remove"].push(Number(id));
  dismiss();
  emit("finish");
  emit("apply",ops,anchors);
}
</script>
