<template>
  <Teleport to="body">
    <dialog ref="dialog" class="photo-picker" :aria-labelledby="id+'-title'" @dragover="blockFileNavigation" @drop="blockFileNavigation" @cancel.prevent="cancel" @keydown.esc.stop.prevent="cancel">
      <header><h2 :id="id+'-title'">Insert Photo</h2>
        <button type="button" class="close" aria-label="Close picker" data-tip="Close" :disabled="busy" @click="cancel">
          <Icon icon="material-symbols:close" width="22"/>
        </button>
      </header>
      <div class="body">
        <nav aria-label="Photo source">
          <button v-for="source in sources" :key="source.name" :aria-pressed="tab===source.name" :disabled="busy"
            @click="tab=source.name; error=''"><Icon :icon="'material-symbols:'+source.icon" width="20"/>{{ source.name }}</button>
        </nav>
        <main v-if="tab==='Upload'" :class="{hovering}" @dragover.prevent="hovering=true" @dragleave="leave" @drop.prevent="drop">
          <input ref="fileInput" type="file" :accept="photoTypes.join(',')" multiple hidden @change="browse">
          <div v-if="!photos.length" class="drop">
            <Icon icon="material-symbols:add-photo-alternate-outline" width="52"/>
            <h3>Drag photos here</h3>
            <button type="button" class="outlined" @click="fileInput.click()">Browse</button>
          </div>
          <div v-else class="gallery">
            <div v-for="photo of photos" :key="photo.preview" class="tile">
              <img :src="photo.preview" :alt="photo.file.name">
              <span>{{ photo.file.name }}</span>
              <button type="button" :aria-label="'Remove '+photo.file.name" :disabled="busy" @click="remove(photo)"><Icon icon="material-symbols:close" width="18"/></button>
            </div>
            <button type="button" class="outlined" :disabled="busy" @click="fileInput.click()">Add photos</button>
          </div>
        </main>
        <main v-else class="web">
          <label :for="id+'-url'">Image URL</label>
          <input :id="id+'-url'" type="url" v-model="url" placeholder="Paste an image URL" autocomplete="off" spellcheck="false" :disabled="busy" @keydown.enter.prevent="insert">
          <img v-if="previewUrl" ref="previewImage" :key="previewUrl" :src="previewUrl" alt="Photo preview" referrerpolicy="no-referrer"
            @load="previewResult($event,'ready')" @error="previewResult($event,'failed')">
          <p v-if="url.trim() && !address" role="status">Enter an http or https image URL.</p>
          <p v-else-if="previewState==='failed'" role="status">Couldn’t load this image. Check the URL and try again.</p>
        </main>
      </div>
      <footer>
        <span role="alert">{{ error }}</span>
        <button type="button" class="cancel" :disabled="busy" @click="cancel">Cancel</button>
        <button type="button" class="primary" :disabled="busy || !canInsert" @click="insert">{{ busy ? 'Inserting…' : 'Insert' }}</button>
      </footer>
    </dialog>
  </Teleport>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { Icon } from "@iconify/vue";
import { photoTypes, transferFiles, hasFiles } from "./files";
const props = defineProps({ submit: { type: Function, required: true } });
const emit = defineEmits(["close"]);
const id = useId(), dialog = ref(), fileInput = ref();
const sources = [{name:"Web Address (URL)",icon:"link"}, {name:"Upload",icon:"upload"}];
const tab = ref("Upload"), photos = ref([]), hovering = ref(false), error = ref(""), busy = ref(false);
const previewImage = ref();
const url = ref(""), previewUrl = ref(""), previewState = ref("");
const address = computed(() => {
  try {
    const parsed = new URL(url.value.trim());
    return ["http:","https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : "";
  } catch { return ""; }
});
watch([address, tab], ([value, source], _, cleanup) => {
  previewState.value = "";
  previewUrl.value = "";
  if (value && source !== "Upload") {
    const timer = setTimeout(() => { previewUrl.value=value; }, 350);
    cleanup(() => clearTimeout(timer));
  }
}, {flush:"sync"});
const canInsert = computed(() => tab.value==="Upload" ? photos.value.length>0 :
  Boolean(address.value && address.value===previewUrl.value && previewState.value==="ready"));
function add(files) {
  if (busy.value || !files.length) return;
  error.value="";
  if (files.some(file => !photoTypes.includes(file.type) || !file.size)) {
    error.value="Choose a nonempty PNG, JPEG, GIF, WebP, HEIC or AVIF image.";
    return;
  }
  if (files.length+photos.value.length>10) { error.value="A message can contain up to 10 inline photos."; return; }
  if ([...photos.value.map(photo=>photo.file),...files].reduce((sum,file)=>sum+4*Math.ceil(file.size/3),0)>5*1024*1024) {
    error.value="These photos would exceed the 5 MiB message limit."; return;
  }
  photos.value.push(...files.map(file => ({file,preview:URL.createObjectURL(file)})));
}
function blockFileNavigation(event) {
  if (hasFiles(event.dataTransfer)) event.preventDefault();
}
function previewResult(event, result) {
  if (tab.value !== "Upload" && event.target === previewImage.value &&
      event.target.getAttribute("src") === address.value && previewUrl.value === address.value)
    previewState.value = result;
}
function browse(event) { add(Array.from(event.target.files)); event.target.value=""; }
function drop(event) {
  hovering.value=false;
  try { add(transferFiles(event.dataTransfer)); } catch (e) { error.value=e.message; }
}
function leave(event) { if (!event.currentTarget.contains(event.relatedTarget)) hovering.value=false; }
function remove(photo) {
  URL.revokeObjectURL(photo.preview);
  photos.value=photos.value.filter(other=>other!==photo);
  error.value="";
}
function close(inserted = false) { dialog.value?.close(); emit("close", inserted); }
function cancel() { if (!busy.value) close(); }
async function insert() {
  if (!canInsert.value || busy.value) return;
  busy.value=true;
  try {
    await props.submit(tab.value==="Upload" ? {files:photos.value.map(photo=>photo.file)} : {url:address.value},close);
  } catch (e) { error.value=e.message || "Could not insert the photo."; }
  finally { busy.value=false; }
}
onMounted(()=>dialog.value.showModal());
onBeforeUnmount(()=>{ dialog.value?.close(); for (const photo of photos.value) URL.revokeObjectURL(photo.preview); });
</script>
<style scoped>
.photo-picker {position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(990px,calc(100vw - 32px));height:min(85dvh,680px);max-width:none;max-height:none;padding:0;overflow:hidden;border:0;border-radius:16px;background:var(--mail-surface);color:var(--el-text-color-primary);box-shadow:0 12px 48px #0004;font:14px Arial,sans-serif}
.photo-picker[open] {display:flex;flex-direction:column}
.photo-picker::backdrop {background:rgb(0 0 0 / 38%)}
header,footer {display:flex;align-items:center;flex:none;gap:12px;padding:12px 20px}
header {height:64px;box-sizing:border-box;border-bottom:1px solid var(--light-border-color);justify-content:space-between}
h2,h3 {margin:0;font-weight:400}
h2 {font-size:22px}
h3 {font-size:20px}
button {cursor:pointer;color:inherit}
.close,.tile button {display:grid;place-items:center;border-radius:50%;width:36px;height:36px}
.close:hover,.cancel:hover,nav button:hover {background:var(--base-fill)}
.body {display:flex;flex:1;min-height:0}
nav {width:196px;flex:none;box-sizing:border-box;padding:12px 8px;border-right:1px solid var(--light-border-color)}
nav button {display:flex;width:100%;align-items:center;gap:16px;height:40px;padding:0 16px;border-radius:22px;text-align:left}
nav button[aria-pressed="true"] {background:var(--mail-selected,#d3e3fd);color:var(--el-text-color-primary)}
main {flex:1;min-width:0;overflow:auto;padding:20px;display:flex}
main.hovering {background:var(--base-fill);outline:2px dashed var(--el-color-primary);outline-offset:-8px}
.drop {display:flex;flex-direction:column;align-items:center;gap:16px;margin:auto}
.drop>svg {color:var(--regular-text-color)}
.outlined,.cancel,.primary {height:36px;padding:0 18px;border-radius:22px;font-weight:500}
.outlined {border:1px solid var(--el-border-color);color:var(--el-color-primary)}
.outlined:hover {background:var(--base-fill)}
.gallery {display:flex;align-content:flex-start;align-items:center;flex-wrap:wrap;gap:12px}
.tile {position:relative;display:grid;width:132px;gap:6px}
.tile img {width:100%;height:96px;object-fit:contain;background:var(--base-fill);border-radius:8px}
.tile span {overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile button {position:absolute;top:3px;right:3px;width:26px;height:26px;background:var(--mail-surface)}
.web {display:flex;flex-direction:column;gap:12px}
.web input {border:1px solid var(--el-border-color);background:transparent;border-radius:4px;padding:10px 12px;color:inherit}
.web img {min-height:0;max-height:75%;max-width:100%;align-self:center;object-fit:contain}
footer {border-top:1px solid var(--light-border-color);justify-content:flex-end}
footer span {margin-right:auto;color:var(--el-color-danger)}
.primary {background:var(--el-color-primary);color:white}
button:disabled {opacity:.5;cursor:default}
button:focus-visible,input:focus-visible {outline:2px solid var(--el-color-primary);outline-offset:-2px}
@media(max-width:620px){.photo-picker{width:calc(100vw - 16px)}.body{flex-direction:column}nav{width:100%;display:flex;border:0;padding:6px;gap:4px}nav button{width:auto}.web,.gallery{padding:10px}header,footer{padding:10px 14px}}
</style>
