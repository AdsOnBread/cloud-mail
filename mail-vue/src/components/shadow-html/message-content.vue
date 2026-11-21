<template>
  <div class="mail-content">
    <template v-for="(part,index) in parts" :key="index">
      <button v-if="part.quote" type="button" class="trimmed-toggle" :aria-expanded="open.has(index)"
        :aria-controls="id+'-'+index" :aria-label="caption(index)" :data-tip="caption(index)" @click="toggle(index)">
        <span aria-hidden="true"><i></i><i></i><i></i></span>
      </button>
      <div :id="part.quote ? id+'-'+index : undefined" :hidden="part.quote && !open.has(index)">
        <template v-if="!part.quote || seen.has(index)">
          <ShadowHtml v-if="part.html" :html="part.html" :natural-flow="hasQuotes" :file-key="fileKey" :resolve-file-url="resolveFileUrl"/>
          <pre v-else class="mail-plain">{{part.text}}</pre>
        </template>
      </div>
    </template>
  </div>
</template>
<script setup>
import {computed,ref,useId,watch} from 'vue';
import ShadowHtml from './index.vue';
import {messageParts} from './quoted-content';
const props=defineProps({html:String,text:String,subject:String,reply:Boolean,fileKey:Function,resolveFileUrl:Function});
const parts=computed(()=>messageParts(props)),open=ref(new Set()),seen=ref(new Set()),id=useId();
const hasQuotes=computed(()=>parts.value.some(part=>part.quote));
const caption=index=>open.value.has(index) ? 'Hide expanded content' : 'Show trimmed content';
function toggle(index) {
  if (open.value.has(index)) open.value.delete(index);
  else {seen.value.add(index);open.value.add(index);}
}
watch(parts,()=>{open.value=new Set();seen.value=new Set();},{flush:'sync'});
</script>
<style scoped>
:global(html.dark) .mail-content {--trimmed-background:#444746;--trimmed-hover:#535755;--trimmed-dots:#c4c7c5}
.mail-plain {margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 Arial, sans-serif}
.trimmed-toggle {display:flex;width:24px;height:11px;padding:0;margin:4px 0;border:0;border-radius:5.5px;align-items:center;justify-content:center;background:var(--trimmed-background,#e8eaed);color:var(--trimmed-dots,#5f6368);cursor:pointer}
.trimmed-toggle span {display:flex;align-items:center;gap:2px}
.trimmed-toggle i {width:3px;height:3px;border-radius:50%;background:currentColor}
.trimmed-toggle:is(:hover,:focus-visible) {background:var(--trimmed-hover,#dadce0);color:var(--el-text-color-primary)}
@media(pointer:coarse){.trimmed-toggle {position:relative;margin-block:12px}.trimmed-toggle::before{content:'';position:absolute;inset:-10px -6px}}
</style>
