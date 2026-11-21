<template>
  <el-popover
    v-model:visible="open"
     :trigger="external ? [] : 'click'" :virtual-triggering="external" :virtual-ref="reference"
    :offset="external ? 0 : undefined" :fallback-placements="external ? ['left-start','bottom-start'] : undefined"
    :placement="external ? 'right-start' : 'bottom-start'"
    role="dialog"
    :width="241"
    :show-arrow="false"
    :popper-class="external ? 'label-picker filing-submenu' : 'label-picker'"
    @after-enter="open && menu?.focus()"
  >
    <template v-if="!external" #reference
      ><button
        ref="trigger"
        class="mail-icon"
        :aria-expanded="open"
        aria-label="Move to"
        aria-haspopup="menu"
        data-tip="Move to"
        :disabled="disabled"
      >
        <Icon
          icon="material-symbols:drive-file-move-outline"
          width="20"
        /></button
    ></template>
    <FilingMenu ref="menu" v-model="query" title="Move to" search-label="Find destination" show-manage
      @keydown.left="backToParent" @dismiss="dismiss" @leave="open=false" @create="createLabel" @manage="manageLabels">
      <button v-for="item in destinations" :key="item.id" type="button" role="menuitem" :title="item.name" @click="choose(item.id)">
        <Icon :style="{color:item.background}" :icon="item.id ? (item.background ? 'material-symbols:label' : 'material-symbols:label-outline') : 'material-symbols:inbox-outline'" width="18"/>
        <span>{{item.name}}</span>
      </button>
      <div v-if="categoryOptions.length" class="filing-category">Categories</div>
      <button v-for="item in categoryOptions" :key="item.id" type="button" role="menuitem" @click="chooseCategory(item.id)">
        <Icon :icon="'material-symbols:'+item.icon" width="18"/><span>{{item.name}}</span>
      </button>
    </FilingMenu>
  </el-popover>
</template>
<script setup>
import { ref, computed, watch } from "vue";
import {useRoute,useRouter} from "vue-router";
import FilingMenu from "./filing-menu.vue";
import { Icon } from "@iconify/vue";
import {inboxCategories} from "@/utils/inbox-categories";
import { useMailLabels } from "@/store/mail-labels";
const props = defineProps({
  ids: { type: Array, required: true },
  fromLabelId: Number,
  trash:Boolean,
  external:Boolean, reference:Object, returnFocus:Function,
  showCategories:Boolean,
  disabled: Boolean,
});
const emit = defineEmits(["move","category","finish","back"]);
const labels = useMailLabels(),
  open = ref(false),
  query = ref(""),
  menu = ref(),
  trigger = ref();
const route=useRoute(),router=useRouter();
let anchors = [];
defineExpose({open,show:()=>{if (!props.disabled && props.ids.length) open.value=true;}});
const destinations = computed(() =>
  [{ id: 0, name: "Inbox" }, ...labels.items].filter(
    (item) =>
      item.id !== props.fromLabelId &&
      item.name.toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
);
watch(
  () => props.ids.join(","),
  () => {
    open.value = false;
  },
);
watch(open, (value) => {
  if (value) {
    query.value = "";
    anchors = [...props.ids];
  }
});
function createLabel(){
  const move={clientId:crypto.randomUUID(),ids:[...anchors],fromLabelId:props.fromLabelId || 0,trash:props.trash,path:route.fullPath};
  dismiss();
  labels.edit={name:query.value.trim(),move,restoreFocus:props.returnFocus || (()=>trigger.value?.focus())};
  emit("finish");
}
function manageLabels(){dismiss();emit('finish');router.push({name:'label-settings'});}
function dismiss() {
  open.value = false;
  (props.reference || trigger.value)?.focus();
  emit("back");
}
function backToParent(event) {
  if (!props.external || event.isComposing || event.target.matches('input,textarea')) return;
  event.preventDefault(); event.stopPropagation(); dismiss();
}
const categoryOptions=computed(()=>props.showCategories?inboxCategories.filter(c=>c.name.toLowerCase().includes(query.value.trim().toLowerCase())):[]);
function chooseCategory(id){dismiss();emit('category',id,anchors);emit('finish');}
function choose(id) {
  dismiss();
  emit("move", { labelId: id, fromLabelId: props.fromLabelId || 0 }, anchors);
  emit("finish");
}
</script>
