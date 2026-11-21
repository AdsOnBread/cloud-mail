<template>
  <div class="avatar" aria-hidden="true" :style="{backgroundColor:color}">{{initial}}</div>
</template>
<script setup>
import {computed} from "vue";
const props = defineProps({name:String, address:String});
const sender = computed(() => props.name || props.address || "Unknown sender");
const initial = computed(() => Array.from(sender.value.trim())[0]?.toUpperCase() || "?");
const colors = ["#5e35b1","#1967d2","#00796b","#a52714","#5b6670","#7b1fa2","#32652c","#b06000"];
const color = computed(() => {
  let hash = 0;
  for (const character of (props.address || sender.value).trim().toLowerCase()) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return colors[hash % colors.length];
});
</script>
<style scoped>
.avatar {width:var(--avatar-size,40px);height:var(--avatar-size,40px);flex-shrink:0;border-radius:50%;display:grid;place-items:center;color:white;font:500 20px/1 Arial,sans-serif;user-select:none}
</style>
