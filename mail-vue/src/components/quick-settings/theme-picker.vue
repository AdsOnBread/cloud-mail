<template>
  <dialog ref="dialog" class="theme-dialog" aria-labelledby="theme-dialog-title" @cancel.prevent="close" @close="clean">
    <header><h2 id="theme-dialog-title">Pick your theme</h2><button class="mail-icon" aria-label="Close theme picker" @click="close"><Icon icon="material-symbols:close" width="20"/></button></header>
    <div class="gallery" role="radiogroup" aria-label="Themes">
      <label v-for="item in options" :key="item.id" class="tile">
        <input type="radio" name="mail-theme" v-model="choice" :value="item.id"/>
        <span class="swatch" :style="{backgroundColor:item.color, backgroundImage:item.image?'url('+item.image+')':undefined}">
          <span v-if="!item.image" class="sample" :class="{night:item.id==='dark'}"></span>
        </span>
        <span>{{item.name}}</span>
      </label>
    </div>
    <footer><input ref="file" hidden type="file" accept="image/jpeg,image/png,image/webp" @change="choosePhoto"/>
      <button class="text-action" :disabled="busy" @click="file.click()">My photos</button>
      <div class="actions"><button :disabled="busy" @click="close">Cancel</button><button class="save" :disabled="busy" @click="save">Save</button></div>
    </footer>
    <p v-if="error" role="alert">{{error}}</p>
  </dialog>
</template>
<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { Icon } from '@iconify/vue';
import db from '@/db/db';
import { themes, useMailTheme } from '@/store/mail-theme';
const theme=useMailTheme(), dialog=ref(), file=ref(), choice=ref(''), error=ref(''), busy=ref(false), preview=ref('');
let photo,request=0;
const options=computed(()=>preview.value || theme.photoURL ? [...themes,{id:'photo',name:'My photo',image:preview.value||theme.photoURL}] : themes);
function clean(){request++;if(preview.value)URL.revokeObjectURL(preview.value);preview.value='';photo=null;busy.value=false;error.value='';if(file.value)file.value.value='';}
function open(){clean();choice.value=theme.active.id;dialog.value.showModal();}
function close(){dialog.value?.close();}
async function choosePhoto(event){
  const input=event.target.files?.[0]; if(!input)return;
  const token=++request;busy.value=true;error.value='';
  let image;
  try{
    if(!['image/jpeg','image/png','image/webp'].includes(input.type))throw new Error('Choose a JPG, PNG or WebP image.');
    image=await createImageBitmap(input);
    const scale=Math.min(1,1920/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
    if(token!==request)return;
    if(!blob)throw new Error('Could not read this photo.');
    if(preview.value)URL.revokeObjectURL(preview.value);
    photo=blob;preview.value=URL.createObjectURL(blob);choice.value='photo';
  }catch(e){if(token===request)error.value=e.message||'Could not read this photo.';}
  finally{image?.close();if(token===request){busy.value=false;event.target.value='';}}
}
async function save(){
  busy.value=true;error.value='';
  try{await theme.apply(choice.value,choice.value==='photo'?photo:null);close();}
  catch(e){error.value=e.message||'Could not save your theme.';}
  finally{busy.value=false;}
}
watch(db,close,{flush:'sync'});onBeforeUnmount(clean);defineExpose({open});
</script>
<style scoped>
.theme-dialog{width:min(784px,calc(100vw - 32px));max-height:calc(100dvh - 48px);border:0;border-radius:16px;background:var(--mail-surface);color:var(--el-text-color-primary);padding:0;box-shadow:0 8px 28px #0004}
.theme-dialog[open]{display:flex;flex-direction:column}.theme-dialog::backdrop{background:#20212480}
header,footer,.actions{display:flex;align-items:center;justify-content:space-between}header{padding:16px 20px 12px 24px}h2{font-size:20px;font-weight:500;margin:0}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:15px 12px;padding:4px 24px 18px;overflow:auto}
.tile{position:relative;cursor:pointer;min-width:0;display:grid;gap:5px;font-size:13px}.tile input{position:absolute;opacity:0}.swatch{height:86px;border:1px solid var(--light-border-color);border-radius:6px;background-size:cover;background-position:center;display:flex;padding:19px 5px 5px 22px}.sample{width:100%;border-radius:4px;background:repeating-linear-gradient(to bottom,#fff 0 8px,#e8ebee 8px 9px)}.sample.night{filter:invert(.86)}.tile input:checked+.swatch{outline:2px solid var(--el-color-primary);outline-offset:1px}.tile input:focus-visible+.swatch{outline:3px solid var(--el-color-primary);outline-offset:3px}
footer{border-top:1px solid var(--light-border-color);padding:12px 24px;gap:8px}.actions{gap:8px}footer button{cursor:pointer;border-radius:20px;padding:9px 18px;color:var(--el-color-primary);font-weight:500}.actions .save{background:var(--el-color-primary);color:var(--mail-surface)}button:hover{box-shadow:inset 0 0 0 40px #7771}p{color:var(--mail-draft);margin:0 24px 12px}
@media(max-width:479px){.gallery{grid-template-columns:repeat(2,minmax(0,1fr));padding-inline:16px}footer{padding:10px}}
</style>
