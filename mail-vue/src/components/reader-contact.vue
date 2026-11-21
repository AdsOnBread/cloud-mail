<template>
  <component :is="available ? 'button' : 'span'" v-bind="$attrs" ref="trigger" class="reader-contact"
    :type="available ? 'button' : undefined" :aria-label="available ? 'Contact info for '+(name || address) : undefined"
    :aria-haspopup="available ? 'dialog' : undefined" :aria-expanded="available ? Boolean(target) : undefined"
    @pointerenter="enter" @pointerleave="leave" @click="select" @keydown.alt.right="shortcut">
    <slot/>
  <Teleport to="body">
    <ContactCard v-if="target" ref="card" :email="address" :name="name" :owner="user.user.email"
      :account-id="accountId" :can-send="canSend" :anchor="target.anchor" :pointer-offset="target.offset" :focused="pinned"
      @hold="hold" @leave="leave" @close="close" @send="compose"/>
  </Teleport>
  </component>
</template>
<script setup>
import {computed,ref,watch} from "vue";
import {ElMessage} from "element-plus";
import {useAccountStore} from "@/store/account";
import {useUserStore} from "@/store/user";
import {hasPerm} from "@/perm/perm";
import {mailboxSession} from "@/services/mailbox-session";
import {openContactWindow} from "@/layout/write/separate-window";
import {isEmail} from "@/utils/verify-utils";
import ContactCard from "./recipient-field/contact-card.vue";
import {useContactCard} from "./recipient-field/use-contact-card";

defineOptions({inheritAttrs:false});
const props=defineProps({address:String,name:String,accountId:Number,userId:Number,mailboxEmail:String,mailboxName:String});
const user=useUserStore(),accounts=useAccountStore(),trigger=ref();
const {target,card,pinned,open,close,hold,hover,leave}=useContactCard();
const available=computed(()=>Boolean(props.accountId && isEmail(props.address) && user.authenticatedToken &&
  (!props.userId || props.userId===user.user.userId)));
const sender=computed(()=>{
  if (props.mailboxEmail) return {accountId:props.accountId,email:props.mailboxEmail,name:props.mailboxName || user.user.name};
  return [user.user.account,...(accounts.owner===user.user.email ? [accounts.currentAccount,...accounts.accounts] : [])]
    .find(account=>account?.accountId===props.accountId && account.email);
});
const canSend=computed(()=>Boolean(hasPerm("email:send") && sender.value));
function show(offset,focus) {
  if (available.value && user.authenticatedToken===localStorage.getItem("token"))
    open({anchor:trigger.value,trigger:trigger.value,offset},focus);
}
function offset(event) {
  const rect=trigger.value.getBoundingClientRect();
  return Math.max(0,Math.min(rect.width,event.clientX-rect.left));
}
function enter(event) {
  if (!available.value) return;
  const x=offset(event);
  hover(event,()=>show(x,false));
}
function select(event) {
  if (!available.value) return;
  event.stopPropagation();
  show(event.detail ? offset(event) : 0,true);
}
function shortcut(event) {
  if (!available.value || event.shiftKey || event.metaKey || event.ctrlKey) return;
  event.preventDefault();event.stopPropagation();show(0,true);
}
async function compose(person) {
  if (!canSend.value || !available.value || person.accountId!==props.accountId) return;
  close(true);
  try {
    const session=mailboxSession();
    const {accountId,email,name}=sender.value;
    await openContactWindow({owner:session.owner,person,sender:{accountId,email,name}},session);
  } catch(error) {ElMessage.error(error.message || "Could not open a new message.");}
}
watch([()=>props.address,()=>props.accountId,()=>props.userId,()=>user.authenticatedToken,()=>user.user.email],()=>close(),{flush:"sync"});
</script>
<style scoped>
.reader-contact {color:inherit;font:inherit;text-align:inherit;min-width:0;}
button.reader-contact {cursor:pointer;}
button.reader-contact:focus-visible {outline:2px solid var(--el-color-primary);outline-offset:1px;border-radius:3px;}
</style>
