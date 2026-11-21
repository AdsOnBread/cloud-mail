<template>
  <section class="pdf-view" aria-label="PDF preview">
    <div class="sheet"><canvas v-show="ready" ref="canvas" :aria-label="'Page '+page" role="img" /><span v-if="!ready" role="status">{{ error || 'Loading page…' }}</span></div>
    <nav v-if="pages>1" aria-label="PDF pages">
      <button aria-label="Previous page" :disabled="page===1" @click="page--">‹</button>
      <span>Page {{ page }} of {{ pages }}</span>
      <button aria-label="Next page" :disabled="page===pages" @click="page++">›</button>
    </nav>
  </section>
</template>
<script setup>
import {ref, onMounted, onBeforeUnmount, watch} from 'vue';
import {getDocument, GlobalWorkerOptions, version} from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerURL;
const props=defineProps({blob:Blob});
const canvas=ref(),page=ref(1),pages=ref(0),ready=ref(false),error=ref('');
let documentTask,pdf,renderTask,revision=0,closed=false;
onMounted(async()=>{
  try {
    const data=await props.blob.arrayBuffer();
    if(closed)return;
    const assets=new URL(import.meta.env.BASE_URL+'pdf/'+version+'/',document.baseURI).href;
    documentTask=getDocument({
      data,isEvalSupported:false,enableXfa:false,
      wasmUrl:assets+'wasm/',cMapUrl:assets+'cmaps/',cMapPacked:true,
      standardFontDataUrl:assets+'standard_fonts/',iccUrl:assets+'iccs/'
    });
    pdf=await documentTask.promise;
    if(!closed){pages.value=pdf.numPages;await render();}
  } catch {if(!closed)error.value='Preview unavailable';}
});
async function render(){
  const request=++revision;
  renderTask?.cancel();
  ready.value=false;
  error.value='';
  try {
    const sheet=await pdf.getPage(page.value);
    if(request!==revision)return;
    const natural=sheet.getViewport({scale:1});
    const viewport=sheet.getViewport({scale:Math.min(1600/natural.width,2000/natural.height,2)});
    const target=canvas.value;
    target.width=Math.ceil(viewport.width);
    target.height=Math.ceil(viewport.height);
    renderTask=sheet.render({canvas:target,viewport});
    await renderTask.promise;
    if(request===revision)ready.value=true;
  } catch {if(request===revision)error.value='Preview unavailable';}
}
watch(page,render);
onBeforeUnmount(()=>{closed=true;revision++;renderTask?.cancel();documentTask?.destroy().catch(()=>{});});
</script>
<style scoped>
.pdf-view {display:flex;flex-direction:column;align-items:center;min-height:0;height:100%;width:100%;gap:10px}
.sheet {display:grid;justify-items:center;align-content:start;width:100%;min-height:0;overflow:auto;}
canvas {max-width:100%;height:auto;background:white;}
nav {display:flex;align-items:center;gap:12px;background:#303134;border-radius:24px;padding:0 8px}
nav button {font-size:24px;color:inherit;width:40px;height:40px;cursor:pointer}
nav button:disabled {opacity:.35}
</style>
