<template>
  <el-popover v-model:visible="open" trigger="click" :trigger-keys="[]" @after-enter="enterDetails" role="dialog" placement="bottom-start" :offset="4"
    :show-arrow="false" width="max-content" popper-class="message-details-popper">
    <template #reference>
      <button ref="trigger" type="button" class="recipient-toggle" aria-label="Show details" data-tip="Show details"
        aria-haspopup="dialog" :aria-expanded="open" :aria-description="summary" @keydown.esc="escape" @keydown.enter.stop.prevent="toggleKeyboard" @keydown.space.stop.prevent="toggleKeyboard" @keydown.tab="tabFromTrigger">
        <span>{{summary}}</span><Icon icon="material-symbols:arrow-drop-down" width="14" aria-hidden="true"/>
      </button>
    </template>
    <dl ref="panel" class="recipient-details" aria-label="Message details" tabindex="0" @keydown.esc="escape" @keydown.tab="tabFromPanel">
      <template v-for="[label,value] in fields" :key="label"><dt>{{label}}:</dt><dd>{{value}}</dd></template>
    </dl>
  </el-popover>
</template>
<script setup>
import {computed,ref} from "vue";
import {Icon} from "@iconify/vue";
import {useAccountStore} from "@/store/account";
import {useUserStore} from "@/store/user";
import {recipientEntries} from "@/utils/recipients";
import {formatDetailDate} from "@/utils/day";
const props=defineProps({message:{type:Object,required:true}});
const account=useAccountStore(),user=useUserStore();
const trigger=ref(),panel=ref(),open=ref(false);
let keyboard=false;
const groups=computed(()=>{
  const m=props.message;
  return [["to",recipientEntries(m.recipient)],["cc",recipientEntries(m.cc)],
    ["bcc",m.type===1 && m.userId!=null && m.userId===user.user.userId ? recipientEntries(m.bcc) : []]]
    .filter(([,entries])=>entries.length);
});
function addressText({name,address}) {
  return name && address && name!==address ? name+" <"+address+">" : address || name;
}
const summary=computed(()=>{
  const first=groups.value[0];
  const own=new Set(account.ownAddresses.map(address=>address.toLowerCase()));
  if (!first) return props.message.toEmail ? "to "+(own.has(props.message.toEmail.toLowerCase()) ? "me" : props.message.toEmail) : "Show details";
  return first[0]+" "+first[1].map(({name,address})=>own.has(address.toLowerCase()) ? "me" : name || address).join(", ");
});
const fields=computed(()=>{
  const m=props.message;
  return [
    ["from",addressText({name:m.name,address:m.sendEmail})],
    ...groups.value.map(([label,entries])=>[label,entries.map(addressText).join(", ")]),
    ["delivered to",!groups.value.length && m.type===0 ? m.toEmail : ""],
    ["date",m.createTime && formatDetailDate(m.createTime)],
    ["subject",m.subject || "(no subject)"]
  ].filter(([,value])=>value);
});
function toggleKeyboard(){
  keyboard=!open.value;
  open.value=!open.value;
}
function enterDetails(){
  if (keyboard && open.value && document.activeElement===trigger.value) panel.value?.focus({preventScroll:true});
  keyboard=false;
}
function tabFromTrigger(event){
  if (!open.value) return;
  if (event.shiftKey) { open.value=false; return; }
  event.preventDefault();
  panel.value?.focus({preventScroll:true});
}
function tabFromPanel(event){
  open.value=false;
  trigger.value?.focus();
  if (event.shiftKey) event.preventDefault();
}
function escape(event) {
  if (!open.value) return;
  event.stopPropagation();
  event.preventDefault();
  open.value=false;
  trigger.value?.focus();
}
</script>
<style scoped>
.recipient-toggle {display:inline-flex;align-items:center;max-width:100%;min-width:0;height:20px;padding:0;border:0;background:transparent;color:var(--regular-text-color);font:12px/16px Arial,sans-serif;cursor:pointer;text-align:start}
.recipient-toggle span {white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.recipient-toggle svg {flex:none;border-radius:2px}
.recipient-toggle:is(:hover,:focus-visible) svg {background:var(--mail-hover)}
.recipient-details {max-height:min(365px,calc(65dvh - 32px));overflow:auto;display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:baseline;column-gap:16px;margin:0;font:14px/20px Arial,sans-serif}
dt,dd {padding:2px 0;margin:0}
dt {text-align:right;color:var(--secondary-text-color)}
dd {overflow-wrap:anywhere;color:var(--el-text-color-primary)}
:global(.message-details-popper.el-popover.el-popper) {box-sizing:border-box;width:max-content;max-width:min(468px,calc(100vw - 16px));max-height:min(400px,65dvh);overflow:hidden;padding:13px 21px 17px;background:var(--mail-surface);border:1px solid var(--light-border-color);border-radius:0;box-shadow:0 2px 4px #0003}
</style>
