<template>
  <span v-if="name===mailName" class="phooey-lockup" role="img" :aria-label="mailName"><span aria-hidden="true" v-html="suiteWordmark"/><span aria-hidden="true">mail</span></span>
  <span v-else class="installation-name">{{name}}</span>
</template>
<script setup>
import {computed} from 'vue';
import {displayMailName,mailName,suiteWordmark} from '../../../shared/mail-brand';
const props=defineProps({title:String});
const name=computed(()=>displayMailName(props.title));
</script>
<style scoped>
.phooey-lockup{display:inline-flex;align-items:center;gap:7px;color:var(--phooey-ink,#173c35);font:420 26px/1 'Phooey Inter',system-ui,sans-serif;letter-spacing:-.04em;white-space:nowrap}
.phooey-lockup :deep(svg){display:block;width:95px;height:auto}
.installation-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
