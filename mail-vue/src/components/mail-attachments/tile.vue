<template>
  <div ref="tile" class="attachment-tile" :class="'file-'+kind">
    <button type="button" class="attachment-open" :aria-label="'Preview '+filename" @click="$emit('preview',file)">
      <span class="thumbnail" aria-hidden="true">
        <img v-if="image" :src="image" alt="" @error="clearImage">
        <span v-else-if="sample" class="sample">{{sample}}</span>
        <Icon v-else :icon="icon" width="36"/>
      </span>
      <span class="file-caption"><Icon :icon="icon" width="16" aria-hidden="true"/><span>{{filename}}</span></span>
      <span class="file-info" aria-hidden="true"><strong>{{filename}}</strong><small v-if="file.size!=null">{{formatBytes(file.size)}}</small></span>
    </button>
    <button type="button" class="tile-download" :aria-label="'Download '+filename" data-tip="Download" @click="download">
      <Icon icon="material-symbols:download" width="18"/>
    </button>
  </div>
</template>
<script setup>
import {computed,ref,onMounted,onBeforeUnmount} from "vue";
import {Icon} from "@iconify/vue";
import {formatBytes} from "@/utils/file-utils";
import {attachmentBlob,previewKind,previewMime,saveAttachment} from "./content";
const props=defineProps({file:{type:Object,required:true}});
const emit=defineEmits(["preview","error"]);
const tile=ref(),image=ref(""),sample=ref("");
const filename=computed(()=>props.file.filename || "Attachment");
const kind=computed(()=>previewKind(props.file.mimeType || props.file.contentType || "",filename.value));
const icon=computed(()=>kind.value==="image" ? "material-symbols:image-outline" : "material-symbols:description-outline");
const controller=new AbortController();
let observer;
function clearImage(){if(image.value) URL.revokeObjectURL(image.value);image.value="";}
async function thumbnail(){
  const {signal}=controller;
  try {
    const data=await attachmentBlob(props.file,signal);
    const mime=await previewMime(data);
    const type=previewKind(mime,filename.value);
    signal.throwIfAborted();
    let picture;
    if (type==="image") picture=data.slice(0,data.size,mime);
    else if (type==="pdf") {
      const {firstPageThumbnail}=await import("./pdf-document");
      picture=await firstPageThumbnail(data,signal);
    } else if(type==="text") {
      const text=await data.slice(0,1024).text();
      if (!signal.aborted) sample.value=text;
    }
    if (picture && !signal.aborted) image.value=URL.createObjectURL(picture);
  } catch { /* The file remains available through Preview and Download. */ }
}
onMounted(()=>{
  const file=props.file;
  if (!window.IntersectionObserver || file.size==null || file.size>5*1024*1024 ||
      (kind.value==="other" && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(filename.value))) return;
  observer=new IntersectionObserver(entries=>{
    if (!entries.some(entry=>entry.isIntersecting)) return;
    observer.disconnect();
    thumbnail();
  });
  observer.observe(tile.value);
});
onBeforeUnmount(()=>{controller.abort();observer?.disconnect();clearImage();});
async function download() {
  try {saveAttachment(await attachmentBlob(props.file),filename.value);}
  catch(e){emit("error",e.message || "Could not download attachment.");}
}
</script>
<style scoped>
.attachment-tile {position:relative;width:180px;height:120px;max-width:100%;flex:none;--file-accent:#4285f4;color:var(--el-text-color-primary)}
.file-pdf {--file-accent:#d93025}.file-image {--file-accent:#188038}
.attachment-open {position:relative;display:block;width:100%;height:100%;border:1px solid var(--light-border-color);background:var(--mail-surface);overflow:hidden;color:inherit;text-align:left;cursor:pointer}
.thumbnail {position:absolute;inset:0;display:grid;align-content:start;justify-items:center;color:var(--file-accent);overflow:hidden}
.thumbnail>svg {align-self:center;margin-top:22px}
.thumbnail img {width:100%;height:100%;object-fit:cover;object-position:top;min-width:0;display:block}
.sample {display:block;box-sizing:border-box;width:100%;padding:10px;white-space:pre-wrap;overflow-wrap:anywhere;font:8px/12px monospace;color:var(--regular-text-color)}
.file-caption {position:absolute;inset:auto 0 0;height:33px;display:flex;align-items:center;gap:8px;padding:0 8px;background:var(--mail-read);border-top:1px solid var(--light-border-color);font:600 12px/16px Arial,sans-serif}
.file-caption svg {color:var(--file-accent);flex:none}
.file-caption span {overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.file-info {position:absolute;inset:0;display:flex;flex-direction:column;padding:10px 12px;gap:3px;background:var(--mail-read);opacity:0;pointer-events:none}
.file-info strong {font:600 13px/18px Arial,sans-serif;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.file-info small {font:12px/16px Arial,sans-serif;color:var(--secondary-text-color)}
.tile-download {position:absolute;bottom:9px;left:12px;display:grid;place-items:center;width:24px;height:24px;border-radius:3px;background:var(--mail-surface);color:var(--regular-text-color);cursor:pointer;opacity:0}
.attachment-tile:is(:hover,:focus-within) :is(.file-info,.tile-download) {opacity:1}
.tile-download:hover,.tile-download:focus-visible {background:var(--mail-hover)}
@media(hover:none) { .tile-download {opacity:1;bottom:38px;left:auto;right:6px;width:32px;height:32px} }
</style>
