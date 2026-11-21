<template>
  <a :href="href" target="_blank" rel="noopener noreferrer" aria-label="In new window" data-tip="In new window" @click="open">
    <Icon icon="material-symbols:open-in-new" width="19"/>
  </a>
</template>
<script setup>
import {Icon} from "@iconify/vue";
const props = defineProps({href:{type:String,required:true}});
function open(event) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.open(props.href, "_blank", "popup,noopener,noreferrer,width=1000,height=760");
}
</script>
