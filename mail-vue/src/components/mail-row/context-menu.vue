<template>
  <Teleport to="body">
    <div v-if="state" ref="menu" role="menu" tabindex="-1" aria-label="Conversation actions"
      class="row-context-menu" :style="position" @contextmenu.prevent @keydown="navigate">
      <template v-for="(group,i) in groups" :key="i">
        <div v-if="i" role="separator"></div>
        <button v-for="item in group" :key="item.key" type="button" role="menuitem" tabindex="-1"
          :disabled="item.key==='attach' && forwarding" :aria-haspopup="item.flyout ? 'menu' : undefined"
          :aria-expanded="item.flyout ? sub===item.key : undefined" @pointermove="hover($event,item)" @click="choose($event,item)"
          @keydown.right="item.flyout && openSub($event,item)">
          <Icon :icon="'material-symbols:'+item.icon" width="18" aria-hidden="true"/>
          <span>{{item.label}}</span><Icon v-if="item.flyout" class="arrow" icon="material-symbols:arrow-right" width="20"/>
        </button>
      </template>
      <LabelPicker v-if="sub==='label'" ref="picker" external submenu :trash="trash" :reference="subAnchor"
        :return-focus="state.restoreFocus" @back="sub=''" :rows="filingRows" @finish="close(true)" @apply="(ops,ids)=>emit('label',ops,ids)"/>
      <MovePicker v-if="sub==='move'" ref="picker" external :trash="trash" :reference="subAnchor" :return-focus="state.restoreFocus" @back="sub=''"
        :ids="state.ids" :from-label-id="labelId" @finish="close(true)" @move="(ops,ids)=>emit('move',ops,ids)"/>
      <el-popover v-if="sub==='category'" :visible="true" virtual-triggering :virtual-ref="subAnchor" placement="right-start"
        :fallback-placements="['left-start','bottom-start']" :width="176" :offset="0" :show-arrow="false"
        popper-class="row-category-menu filing-submenu" @after-enter="categoryMenu?.querySelector('button')?.focus()">
        <div ref="categoryMenu" role="menu" aria-label="Move to tab" @keydown="categoryKeys">
          <button v-for="tab in inboxCategories.filter(tab=>tab.id!==category)" :key="tab.id" role="menuitem" type="button"
            @click="categorize(tab.id)">{{tab.name}}</button>
        </div>
      </el-popover>
    </div>
  </Teleport>
</template>
<script setup>
import {computed,nextTick,onDeactivated,onBeforeUnmount,ref,shallowRef,watch} from "vue";
import {useRoute,useRouter} from "vue-router";
import {Icon} from "@iconify/vue";
import {hasPerm} from "@/perm/perm";
import {useUserStore} from "@/store/user";
import {useAccountStore} from "@/store/account";
import {useUiStore} from "@/store/ui";
import {useMailSearchStore} from "@/store/mail-search";
import {inboxCategories} from "@/utils/inbox-categories";
import LabelPicker from "@/components/mail-labels/picker.vue";
import MovePicker from "@/components/mail-labels/move.vue";

const props=defineProps({rows:{type:Array,required:true},scope:String,trash:Boolean,labelId:Number,folder:String,
  category:String,busy:Boolean,forwarding:Boolean});
const emit=defineEmits(["select-only","command","move","label","category"]);
const user=useUserStore(),account=useAccountStore(),ui=useUiStore(),search=useMailSearchStore(),route=useRoute(),router=useRouter();
const state=shallowRef(null),menu=ref(),picker=ref(),sub=ref(""),subAnchor=shallowRef(null),categoryMenu=ref();
const position=ref({}),idOf=row=>props.trash ? row.emailId : row.lastEmailId;
const filingRows=computed(()=>props.rows.map(row=>({lastEmailId:idOf(row),labelIds:row.labelIds})));
const action=(key,label,icon,flyout=false)=>({key,label,icon,flyout});
const groups=computed(()=>{
  if (!state.value) return [];
  const {rows}=state.value, first=rows[0], scheduled=rows.some(row=>row.scheduledDraftId);
  const markRead=rows.some(row=>props.trash ? row.unread===0 : row.unreadCount);
  const fileInbox=["archived","snoozed"].includes(props.folder) || rows.every(row=>row.filedAway);
  const sender=props.trash ? first.sendEmail : first.lastSenderEmail;
  const senderName=(props.trash ? first.name : first.lastSenderName) || sender;
  const canDelete=hasPerm("email:delete"),replies=[action("reply","Reply","reply"),action("all","Reply all","reply-all")];
  if(user.defaultReplyAll) replies.reverse();
  return [
    props.category ? [action("category","Move to tab","tab",true)] : [],
    hasPerm("email:send") && !scheduled ? [...replies,action("forward","Forward","forward"),action("attach","Forward as attachment","forward-to-inbox-outline")] : [],
    [
      ...(!props.trash ? [action(fileInbox?"inbox":"archive",fileInbox?"Move to Inbox":"Archive",fileInbox?"move-to-inbox-outline":"archive-outline")] :
        canDelete ? [scheduled ? action("restore",rows.every(row=>row.scheduledDraftId)?"Restore to Drafts":"Restore to previous location","restore-from-trash-outline") : action("inbox","Move to inbox","move-to-inbox-outline")] : []),
      ...(canDelete ? [action("delete",props.trash?"Delete forever":"Delete",props.trash?"delete-forever-outline":"delete-outline")] : []),
      action(markRead?"read":"unread",markRead?"Mark as read":"Mark as unread",markRead?"drafts-outline":"mail-outline"),
      ...(!props.trash ? [action("snooze","Snooze","schedule-outline")] : []),
    ],
    [
      ...(!scheduled && (!props.trash || canDelete) ? [action("move","Move to","drive-file-move-outline",true)] : []),
      action("label","Label as","label-outline",true),
      ...(!props.trash ? [rows.every(row=>row.importanceReason) ? action("unimportant","Mark as not important","label-important-outline") : action("important","Mark as important","label-important-outline")] : []),
    ],
    rows.length===1 && sender ? [action("find","Find emails from "+senderName,"search")] : [],
    rows.length===1 ? [action("window","Open in new window","open-in-new")] : [],
  ].filter(group=>group.length);
});
function place() {
  if (!state.value || !menu.value) return;
  const {x,y}=state.value,r=menu.value.getBoundingClientRect();
  position.value={left:Math.max(0,Math.min(x,innerWidth-r.width))+"px",top:Math.max(0,Math.min(y,innerHeight-r.height))+"px"};
}
function close(focus=false) {
  const anchor=state.value?.opener;
  state.value=null;sub.value="";subAnchor.value=null;
  if(focus && anchor?.isConnected) anchor.focus({preventScroll:true});
}
async function show(event,row) {
  if(props.busy) return;
  const opener=event.currentTarget.querySelector(".conversation-open");
  if(!opener) return;
  const keyboard=event.type==="keydown" || (!event.clientX && !event.clientY);
  const rect=opener.getBoundingClientRect(),id=idOf(row);
  const rows=props.rows.some(r=>idOf(r)===id)?[...props.rows]:[row];
  close();emit("select-only",rows.map(idOf));
  const opened={opener,restoreFocus:()=>opener.isConnected && opener.focus({preventScroll:true}),rows,ids:rows.map(idOf),x:keyboard?rect.left:event.clientX,y:keyboard?rect.bottom:event.clientY};
  state.value=opened;
  await nextTick();
  if(state.value!==opened) return;
  place();
  (keyboard?menu.value.querySelector("button:not(:disabled)"):menu.value)?.focus({preventScroll:true});
}
function choose(event,item) {
  if(item.flyout) return openSub(event,item);
  const {rows,ids,opener}=state.value;
  close(true);
  if(["reply","all","forward"].includes(item.key)) {
    ui.writerRef?.openRowResponses(rows.map(r=>props.trash?r:{emailId:idOf(r)}),item.key);
  } else if(item.key==="window") {
    const row=rows[0];
    const location=props.trash ? {name:"trash",query:{message:row.emailId,sender:row.accountId,window:"1"}} :
        {path:"/mail",query:{emailId:idOf(row),folder:props.folder,labelId:props.labelId,category:props.category || undefined,window:"1"}};
    window.open(router.resolve(location).href,"_blank","popup,noopener,noreferrer,width=1000,height=760");
  } else if(item.key==="find") {
    const address=props.trash?rows[0].sendEmail:rows[0].lastSenderEmail;
    // Preserve a separately opened Trash window's mailbox scope.
    const pinned=props.trash && route.query.window==="1";
    if (!pinned) search.visit("all");
    search.query="";
    search.filters={from:address};
    if (!pinned && route.name!=="all") router.push({name:"all"});
  } else emit("command",item.key,ids,opener);
}
function hover(event,item) {
  if(event.pointerType!=="mouse") return;
  if(item.flyout) openSub(event,item);
  else sub.value="";
}
async function openSub(event,item) {
  if(event.type==="keydown") {event.preventDefault();event.stopPropagation();}
  subAnchor.value=event.currentTarget;sub.value=item.key;
  await nextTick();
  if(sub.value===item.key && !picker.value?.open) picker.value?.show();
}
function categorize(id) {const ids=state.value.ids;close(true);emit("category",id,ids);}
function cycle(event,panel) {
  const buttons=[...panel.querySelectorAll(':scope > button:not(:disabled)')];
  const i=buttons.indexOf(document.activeElement);
  const idx=event.key==="Home"?0:event.key==="End"?buttons.length-1:
    event.key==="ArrowUp"?(i<0?buttons.length-1:(i-1+buttons.length)%buttons.length):(i+1)%buttons.length;
  buttons[idx]?.focus();
}
function categoryKeys(event) {
  if(["Escape","ArrowLeft"].includes(event.key)) { sub.value="";subAnchor.value?.focus(); }
  else if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)) cycle(event,categoryMenu.value);
  else return;
  event.preventDefault();event.stopPropagation();
}
function navigate(event) {
  if(event.target.closest('[role=menu]')!==menu.value) return;
  if(event.key==="Escape") close(true);
  else if(event.key==="Tab") {close(true);return;}
  else if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)) {sub.value="";cycle(event,menu.value);}
  else return;
  event.preventDefault();event.stopPropagation();
}
function outside(event) {
  if(!menu.value?.contains(event.target) && !event.target.closest?.('.filing-submenu')) close();
}
function scrolled(event) {
  if(event.target===document || event.target.contains?.(state.value?.opener)) close();
}
watch(()=>!!state.value,on=>{
  for(const type of ["pointerdown","focusin"]) document[on?"addEventListener":"removeEventListener"](type,outside,true);
  document[on?"addEventListener":"removeEventListener"]("scroll",scrolled,true);
  window[on?"addEventListener":"removeEventListener"]("resize",place);
},{flush:"sync"});
watch([()=>props.scope,()=>route.fullPath,()=>user.authenticatedToken,()=>account.currentAccountId],()=>close(),{flush:"sync"});
watch(()=>[props.busy,props.rows.map(idOf).join(",")],([busy,ids])=>{
  if(state.value && (busy || state.value.ids.join(",")!==ids)) close();
});
onDeactivated(()=>close());
onBeforeUnmount(()=>close());
defineExpose({show});
</script>
<style scoped>
.row-context-menu {position:fixed;z-index:1900;box-sizing:border-box;max-width:100vw;max-height:100dvh;overflow:auto;overscroll-behavior:contain;
  background:var(--el-bg-color);color:var(--regular-text-color);border-radius:4px;padding:6px 0;outline:none;
  box-shadow:0 8px 10px 1px #00000024,0 3px 14px 2px #0000001f,0 5px 5px -3px #0003;font:14px/20px Arial,sans-serif}
.row-context-menu button,.row-category-menu button {position:relative;display:flex;align-items:center;width:100%;height:32px;padding:6px 48px;
  text-align:start;font:inherit;color:inherit;cursor:pointer;white-space:nowrap}
.row-context-menu button span {overflow:hidden;text-overflow:ellipsis}
.row-context-menu button svg {position:absolute;left:16px}
.row-context-menu button .arrow {left:auto;right:12px}
.row-context-menu button:is(:hover,:focus-visible,[aria-expanded=true]),.row-category-menu button:is(:hover,:focus-visible) {background:var(--mail-hover);outline:none}
.row-context-menu button:disabled {opacity:.45;cursor:default}
.row-context-menu [role=separator] {border-top:1px solid var(--light-border-color);margin:6px 0}
:global(.row-category-menu.el-popper) {padding:6px 0}
.row-category-menu button {padding:6px 16px}
@media (forced-colors:active) {
  .row-context-menu, :global(.row-category-menu.el-popper) {border:1px solid CanvasText}
  .row-context-menu button:focus-visible, .row-category-menu button:focus-visible {outline:2px solid Highlight;outline-offset:-2px}
}
</style>
