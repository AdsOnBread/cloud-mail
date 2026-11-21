<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    placement="bottom-start"
    role="dialog"
    :width="240"
    :show-arrow="false"
    popper-class="label-picker"
    @after-enter="input?.focus()"
  >
    <template #reference
      ><button
        ref="trigger"
        class="mail-icon"
        :aria-expanded="open"
        aria-label="Move to"
        aria-haspopup="dialog"
        data-tip="Move to"
        :disabled="disabled"
      >
        <Icon
          icon="material-symbols:drive-file-move-outline"
          width="20"
        /></button
    ></template>
    <div ref="menu" class="move-picker" @keydown="navigate">
      <strong>Move to</strong
      ><input
        ref="input"
        v-model="query"
        type="search"
        aria-label="Find destination"
        placeholder="Find a label"
      />
      <button
        v-for="item in destinations"
        :key="item.id"
        @click="choose(item.id)"
      >
        <Icon
          :style="{color:item.background}"
          :icon="
            item.id
              ? (item.background ? 'material-symbols:label' : 'material-symbols:label-outline')
              : 'material-symbols:inbox-outline'
          "
          width="18"
        />{{ item.name }}
      </button>
      <div v-if="categoryOptions.length" class="category-destinations">
        <span>Categories</span>
        <button v-for="item in categoryOptions" :key="item.id" @click="chooseCategory(item.id)"><Icon :icon="'material-symbols:'+item.icon" width="18"/>{{item.name}}</button>
      </div>
      <div class="move-management">
        <button @click="createLabel">{{ query.trim() ? 'Create new “'+query.trim()+'”' : 'Create new' }}</button>
        <button @click="manageLabels">Manage labels</button>
      </div>
    </div>
  </el-popover>
</template>
<script setup>
import { ref, computed, watch } from "vue";
import {useRoute,useRouter} from "vue-router";
import { Icon } from "@iconify/vue";
import {inboxCategories} from "@/utils/inbox-categories";
import { useMailLabels } from "@/store/mail-labels";
const props = defineProps({
  ids: { type: Array, required: true },
  fromLabelId: Number,
  trash:Boolean,
  showCategories:Boolean,
  disabled: Boolean,
});
const emit = defineEmits(["move","category"]);
const labels = useMailLabels(),
  open = ref(false),
  query = ref(""),
  input = ref(),
  menu = ref(),
  trigger = ref();
const route=useRoute(),router=useRouter();
let anchors = [];
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
  const move={ids:[...anchors],fromLabelId:props.fromLabelId || 0,trash:props.trash,path:route.fullPath};
  dismiss();
  labels.edit={name:query.value.trim(),move};
}
function manageLabels(){dismiss();router.push({name:'label-settings'});}
function navigate(event) {
  if (event.isComposing || event.keyCode===229) return;
  if (event.key==='ArrowDown' || event.key==='ArrowUp') step(event.key==='ArrowDown' ? 1 : -1);
  else if (event.key==='Escape') dismiss();
  else if (event.key==='Enter' && event.target===input.value) menu.value.querySelector('button')?.click();
  else return;
  event.preventDefault();
  event.stopPropagation();
}
function step(direction) {
  const buttons=Array.from(menu.value?.querySelectorAll('button') || []);
  if (!buttons.length) return;
  const index=buttons.indexOf(document.activeElement);
  const next=index<0 ? (direction>0 ? 0 : buttons.length-1) : (index+direction+buttons.length)%buttons.length;
  buttons[next].focus();
}
function dismiss() {
  open.value = false;
  trigger.value?.focus();
}
const categoryOptions=computed(()=>props.showCategories?inboxCategories.filter(c=>c.name.toLowerCase().includes(query.value.trim().toLowerCase())):[]);
function chooseCategory(id){dismiss();emit('category',id,anchors);}
function choose(id) {
  dismiss();
  emit("move", { labelId: id, fromLabelId: props.fromLabelId || 0 }, anchors);
}
</script>
<style scoped>
.move-management{border-top:1px solid var(--light-border-color);margin-top:4px;padding-top:4px}
.category-destinations{border-top:1px solid var(--light-border-color);margin-top:4px}.category-destinations span{font-size:12px;color:var(--secondary-text-color)}
.move-picker {
  max-height: 320px;
  overflow: auto;
  padding: 6px 0;
}
.move-picker strong,
.move-picker span {
  display: block;
  padding: 6px 14px;
}
.move-picker input {
  margin: 6px 12px;
  width: calc(100% - 24px);
  padding: 6px;
  border: 1px solid var(--light-border-color);
  border-radius: 4px;
  color: inherit;
}
.move-picker button {
  width: 100%;
  display: flex;
  align-items: center;
  text-align: left;
  gap: 12px;
  padding: 7px 14px;
  color: inherit;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.move-picker button:hover,
.move-picker button:focus-visible {
  background: var(--mail-hover);
}
</style>
