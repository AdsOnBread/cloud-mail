<template>
  <el-dialog v-model="open" append-to-body destroy-on-close class="mail-dialog signature-dialog"
    title="Signatures" @closed="$emit('closed')" width="min(660px, calc(100% - 24px))" :before-close="closeDialog">
    <p v-if="error" role="alert">{{error}} <button type="button" class="text-action" :disabled="saving" @click="load">Reload saved settings</button></p>
    <p v-if="loading" role="status">Loading signatures…</p>
    <div v-if="form && !loading" :inert="saving || undefined" :aria-busy="saving">
      <SignatureFields :form="form" :account-id="accountId"/>
    </div>
    <template #footer>
      <button type="button" class="sig-button" :disabled="saving" @click="open=false">Cancel</button>
      <button type="button" class="sig-button primary" :disabled="saving || loading || !form || conflict" @click="save">Save changes</button>
    </template>
  </el-dialog>
</template>
<script setup>
import {ref,watch} from 'vue';
import SignatureFields from './fields.vue';
import {useUserStore} from '@/store/user';
import {useMailSignatures} from '@/store/mail-signatures';
defineEmits(["closed"]);
const open=defineModel({type:Boolean});
defineProps({accountId:Number});
const store=useMailSignatures(),user=useUserStore();
const form=ref(null),loading=ref(false),saving=ref(false),error=ref(''),conflict=ref(false);
let request=0;
watch(open,visible=>{
  if(visible)load();
  else {request++;form.value=null;}
},{immediate:true});
watch([()=>user.user.email,()=>user.authenticatedToken],()=>{if(open.value)open.value=false;});
async function load(){
  const revision=++request;
  loading.value=true;error.value='';conflict.value=false;form.value=null;
  try{
    const data=await store.load(true);
    if(data && revision===request)form.value=JSON.parse(JSON.stringify(data));
  }catch(e){if(revision===request)error.value=e.message||'Could not load signatures.';}
  finally{if(revision===request)loading.value=false;}
}
async function save(){
  if(saving.value || !form.value)return;
  saving.value=true;error.value='';
  try{
    await store.save(form.value);open.value=false;
  }catch(e){error.value=e.message || 'Could not save signatures.';conflict.value=Number(e.code || e.response?.status)===409;}
  finally{saving.value=false;}
}
function closeDialog(done){if(!saving.value)done();}
</script>
<style scoped>
.sig-button,.text-action{cursor:pointer;color:var(--el-color-primary);font:500 14px/20px Arial,sans-serif}
.sig-button{padding:8px 16px;border-radius:20px}
.sig-button.primary{background:var(--el-color-primary);color:var(--mail-surface)}
.sig-button:disabled{opacity:.5;cursor:default}
:global(.signature-dialog){max-height:90dvh;overflow:auto;margin:5dvh auto}
</style>
