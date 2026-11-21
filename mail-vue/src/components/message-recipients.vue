<template>
  <MessageDetails :summary="summary" :fields="fields"/>
</template>
<script setup>
import {computed} from "vue";
import MessageDetails from "./message-details.vue";
import {useAccountStore} from "@/store/account";
import {useUserStore} from "@/store/user";
import {headerRecipients,headerAddressText} from "@/utils/recipients";
import {formatDetailDate} from "@/utils/day";
const props=defineProps({message:{type:Object,required:true}});
const account=useAccountStore(),user=useUserStore();
const groups=computed(()=>{
  const m=props.message;
  return [["to",headerRecipients(m.recipient)],["cc",headerRecipients(m.cc)],
    ["bcc",m.type===1 && m.userId!=null && m.userId===user.user.userId ? headerRecipients(m.bcc) : []]]
    .filter(([,entries])=>entries.length);
});
const summary=computed(()=>{
  const first=groups.value[0];
  const own=new Set(account.ownAddresses.map(address=>address.toLowerCase()));
  if (!first) return props.message.toEmail ? "to "+(own.has(props.message.toEmail.toLowerCase()) ? "me" : props.message.toEmail) : "Show details";
  return first[0]+" "+first[1].map(({name,address})=>own.has(address?.toLowerCase()) ? "me" : name || address).join(", ");
});
const fields=computed(()=>{
  const m=props.message;
  return [
    ["from",headerAddressText({name:m.name,address:m.sendEmail})],
    ...groups.value.map(([label,entries])=>[label,entries.map(headerAddressText).join(", ")]),
    ["delivered to",!groups.value.length && m.type===0 ? m.toEmail : ""],
    ["date",m.createTime && formatDetailDate(m.createTime)],
    ["subject",m.subject || "(no subject)"]
  ].filter(([,value])=>value);
});
</script>
