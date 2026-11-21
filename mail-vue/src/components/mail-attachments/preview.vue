<template>
  <Teleport to="body">
    <dialog ref="dialog" class="file-preview" :aria-label="'Preview '+file.filename" @close="$emit('close')" @keydown.stop>
      <header>
        <button aria-label="Close preview" data-tip="Close" autofocus @click="dialog.close()"><Icon icon="material-symbols:arrow-back" width="24"/></button>
        <strong>{{ file.filename }}</strong>
        <button aria-label="Download attachment" data-tip="Download" :disabled="!blob" @click="download"><Icon icon="material-symbols:download" width="22"/></button>
      </header>
      <div class="stage" @click.self="dialog.close()">
        <p v-if="error" role="alert">{{ error }} <button @click="load">Retry</button></p>
        <p v-else-if="!blob" role="status">Loading preview…</p>
        <img v-else-if="kind==='image'" :src="objectURL" :alt="file.filename" @error="kind='other'">
        <PdfPreview v-else-if="kind==='pdf'" :blob="blob"/>
        <pre v-else-if="kind==='text'">{{ sample }}</pre>
        <div v-else class="fallback"><span>Preview unavailable</span><button @click="download">Download</button></div>
      </div>
    </dialog>
  </Teleport>
</template>
<script setup>
import {ref,shallowRef,onMounted,onBeforeUnmount,defineAsyncComponent} from 'vue';
import {Icon} from '@iconify/vue';
import http from '@/axios';
const PdfPreview=defineAsyncComponent(()=>import('./pdf-preview.vue'));
const props=defineProps({file:{type:Object,required:true}});
defineEmits(['close']);
const dialog=ref(),blob=shallowRef(null),objectURL=ref(''),kind=ref('other'),error=ref(''),sample=ref('');
const controller=new AbortController();
async function load(){
  error.value='';
  try{
    const data=await http.get('/v1/attachments/'+props.file.attId+'/content',{responseType:'blob',signal:controller.signal,noMsg:true});
    if(controller.signal.aborted)return;
    const mime=data.type.split(';')[0].toLowerCase(), name=props.file.filename;
    if(/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime))kind.value='image';
    else if(mime==='application/pdf' || /\.pdf$/i.test(name))kind.value='pdf';
    else if(mime.startsWith('text/') || ['application/json','application/xml'].includes(mime) || /\.(txt|csv|md|log)$/i.test(name)){
      sample.value=await data.slice(0,256*1024).text();
      if(controller.signal.aborted)return;
      if(data.size>256*1024)sample.value+='\n…';
      kind.value='text';
    }
    blob.value=data;
    objectURL.value=URL.createObjectURL(data);
  }catch{if(!controller.signal.aborted)error.value='Could not load attachment.';}
}
function download(){
  const link=document.createElement('a');
  // A user can close the preview immediately after starting a download.
  const url=URL.createObjectURL(blob.value);
  link.href=url;link.download=props.file.filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
onMounted(()=>{dialog.value.showModal();load();});
onBeforeUnmount(()=>{controller.abort();dialog.value?.close();if(objectURL.value)URL.revokeObjectURL(objectURL.value);});
</script>
<style scoped>
.file-preview {box-sizing:border-box;position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;padding:0;border:0;margin:0;background:rgba(24,25,27,.96);color:#fff}
.file-preview[open] {display:flex;flex-direction:column}
.file-preview::backdrop{background:rgba(0,0,0,.65)}
header {display:flex;align-items:center;gap:12px;padding:8px 16px;height:60px;box-sizing:border-box;background:rgba(32,33,36,.92)}
header strong {flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 16px/24px Arial,sans-serif}
header button {width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:inherit;cursor:pointer}
header button:hover,header button:focus-visible {background:#ffffff24}
header button:disabled {opacity:.38}
.stage {display:grid;place-items:center;min-height:0;flex:1;padding:16px;overflow:hidden}
.stage img {max-width:100%;max-height:100%;min-height:0;object-fit:contain}
.stage pre {box-sizing:border-box;align-self:start;justify-self:center;margin:0;overflow:auto;background:white;color:#202124;padding:clamp(16px,4vw,48px);width:min(820px,100%);height:100%;font:14px/1.55 monospace;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}
.fallback {display:grid;justify-items:center;gap:16px}
.stage p button,.fallback button {border:1px solid #aaa;border-radius:24px;color:white;padding:6px 16px;cursor:pointer}
</style>
