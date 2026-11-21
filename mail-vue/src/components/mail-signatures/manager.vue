<template>
  <el-dialog v-model="open" append-to-body destroy-on-close class="mail-dialog signature-dialog"
    title="Signatures" @closed="$emit('closed')" width="min(660px, calc(100% - 24px))" :before-close="closeDialog">
    <p v-if="error" role="alert">{{error}} <button type="button" class="text-action" :disabled="saving" @click="load">Reload saved settings</button></p>
    <p v-if="loading" role="status">Loading signatures…</p>
    <div v-if="form && !loading" :inert="saving || undefined" :aria-busy="saving">
      <div v-if="form.items.length" class="signature-grid">
        <div class="names" aria-label="Saved signatures">
          <div v-for="item in form.items" :key="item.id" :class="{chosen:item.id===selected}">
            <button class="signature-name" :aria-pressed="item.id===selected" @click="selected=item.id">{{item.name}}</button>
            <template v-if="item.id===selected">
              <button class="mail-icon" aria-label="Rename signature" data-tip="Rename" @click="askName(true)"><Icon icon="material-symbols:edit-outline" width="16"/></button>
              <button class="mail-icon" aria-label="Delete signature" data-tip="Delete" @click="remove"><Icon icon="material-symbols:delete-outline" width="16"/></button>
            </template>
          </div>
        </div>
        <div v-if="active" class="signature-editor">
          <TinyEditor :key="active.id" ref="editor" signature-editor :def-value="active.html" @change="changeHTML(active.id,$event)"/>
        </div>
      </div>
      <p v-else>No signatures</p>
      <button type="button" class="create" aria-label="Create a new signature" @click="askName(false)">
        <Icon icon="material-symbols:add" width="18"/>Create new
      </button>
      <section v-if="form.items.length && senderId" class="defaults">
        <h3>Signature defaults</h3>
        <label v-if="senders.length>1">Email address
          <select v-model="senderId"><option v-for="a in senders" :key="a.accountId" :value="a.accountId">{{a.email}}</option></select>
        </label>
        <div class="default-pair">
          <label v-for="[key,caption] in choices" :key="key">{{caption}}
            <select :value="form.defaults[senderId]?.[key] || ''" @change="setDefault(key,$event.target.value)">
              <option value="">No signature</option>
              <option v-for="item in form.items" :key="item.id" :value="item.id">{{item.name}}</option>
            </select>
          </label>
        </div>
        <label class="placement"><input type="checkbox" v-model="form.beforeQuote" />Insert signature before quoted text in replies and remove the “--” line that precedes it.</label>
      </section>
    </div>
    <template #footer>
      <button type="button" class="sig-button" :disabled="saving" @click="open=false">Cancel</button>
      <button type="button" class="sig-button primary" :disabled="saving || loading || !form || conflict" @click="save">Save changes</button>
    </template>
  </el-dialog>
  <el-dialog v-model="naming" append-to-body class="mail-dialog signature-name-dialog" :title="rename ? 'Rename signature' : 'Name new signature'"
    width="min(360px, calc(100% - 24px))" @opened="nameInput?.focus()">
    <form @submit.prevent="commitName">
      <input ref="nameInput" v-model="name" class="name-input" aria-label="Signature name" maxlength="320" />
      <div class="length">{{name.length}}/320</div>
    </form>
    <template #footer>
      <button type="button" class="sig-button" @click="naming=false">Cancel</button>
      <button type="button" class="sig-button primary" :disabled="!name.trim()" @click="commitName">{{rename?'Save':'Create'}}</button>
    </template>
  </el-dialog>
</template>
<script setup>
import {computed,ref,watch} from 'vue';
import {Icon} from '@iconify/vue';
import TinyEditor from '@/components/tiny-editor/index.vue';
import {useAccountStore} from '@/store/account';
import {useUserStore} from '@/store/user';
import {useMailSignatures} from '@/store/mail-signatures';
import {hasPerm} from '@/perm/perm';
defineEmits(["closed"]);
const open=defineModel({type:Boolean});
const props=defineProps({accountId:Number});
const store=useMailSignatures(),account=useAccountStore(),user=useUserStore();
const form=ref(null),selected=ref(''),senderId=ref(0),editor=ref(null),loading=ref(false),saving=ref(false),error=ref(''),conflict=ref(false);
const naming=ref(false),rename=ref(false),name=ref(''),nameInput=ref(null);
const active=computed(()=>form.value?.items.find(item=>item.id===selected.value));
const senders=computed(()=>[...new Map([user.user.account,account.currentAccount,...account.accounts]
  .filter(a=>a?.accountId && a.email).map(a=>[a.accountId,a])).values()]);
const choices=[['newMail','For new emails use'],['reply','On reply/forward use']];
let request=0;
watch(open,visible=>{
  if(visible){
    senderId.value=props.accountId || account.currentAccountId || user.user.account?.accountId;
    if(hasPerm('account:query'))account.loadAll().catch(()=>{});
    load();
  } else {request++;naming.value=false;form.value=null;}
},{immediate:true});
watch(()=>user.user.email,()=>{if(open.value)open.value=false;});
async function load(){
  const revision=++request;
  loading.value=true;error.value='';conflict.value=false;form.value=null;
  try{
    const data=await store.load(true);
    if(!data || revision!==request)return;
    form.value=JSON.parse(JSON.stringify(data));selected.value=form.value.items[0]?.id || '';
  }catch(e){if(revision===request)error.value=e.message||'Could not load signatures.';}
  finally{if(revision===request)loading.value=false;}
}
function changeHTML(id,html){const item=form.value?.items.find(item=>item.id===id);if(item)item.html=html;}
function askName(edit){rename.value=edit;name.value=edit?active.value.name:'';naming.value=true;}
function commitName(){
  if(!name.value.trim() || !form.value)return;
  if(rename.value)active.value.name=name.value.trim();
  else{
    const item={id:crypto.randomUUID(),name:name.value.trim(),html:''};
    form.value.items.push(item);selected.value=item.id;
  }
  naming.value=false;
}
function setDefault(key,value){
  const pair=form.value.defaults[senderId.value] ||= {newMail:null,reply:null};
  pair[key]=value || null;
}
function remove(){
  const id=selected.value;
  form.value.items=form.value.items.filter(item=>item.id!==id);
  for(const pair of Object.values(form.value.defaults)){
    for(const [key] of choices)if(pair[key]===id)pair[key]=null;
  }
  selected.value=form.value.items[0]?.id || '';
}
async function save(){
  if(saving.value || !form.value)return;
  saving.value=true;error.value='';
  try{
    await editor.value?.ready();
    if(active.value && editor.value)active.value.html=editor.value.getContent();
    await store.save(form.value);open.value=false;
  }catch(e){error.value=e.message || 'Could not save signatures.';conflict.value=Number(e.code || e.response?.status)===409;}
  finally{saving.value=false;}
}
function closeDialog(done){if(!saving.value)done();}
</script>
<style scoped>
.signature-grid { display:grid;grid-template-columns:minmax(150px,32%) minmax(0,1fr);border:1px solid var(--light-border-color); }
.names { min-width:0;border-right:1px solid var(--light-border-color);max-height:200px;overflow:auto; }
.names > div { display:flex;align-items:center;padding-right:4px; }
.names .chosen { background:var(--mail-selected); }
.signature-name { flex:1;min-width:0;text-align:left;padding:9px 12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:inherit; }
.names .mail-icon { width:26px;height:26px; }
.signature-editor { height:170px;min-width:0; }
.create,.sig-button,.text-action { cursor:pointer;color:var(--el-color-primary);font:500 14px/20px Arial,sans-serif; }
.create { margin-top:10px;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--light-border-color);border-radius:4px;padding:6px 12px; }
.defaults { margin-top:20px; }
h3 { margin:0 0 12px;font-size:14px;color:var(--el-text-color-primary); }
.defaults label { display:grid;gap:4px;min-width:0;font-size:12px; }
select,.name-input { max-width:100%;background:var(--mail-surface);color:inherit;border:1px solid var(--secondary-text-color);border-radius:4px;padding:6px;font:14px Arial,sans-serif; }
.default-pair { display:flex;gap:16px;margin:10px 0; }
.defaults .placement { display:flex;align-items:flex-start;gap:6px;font-size:13px; }
.sig-button { padding:8px 16px;border-radius:20px; }
.sig-button.primary { background:var(--el-color-primary);color:var(--mail-surface); }
.sig-button:disabled { opacity:.5;cursor:default; }
.name-input { width:100%;box-sizing:border-box; }
.length { text-align:right;font-size:12px; }
@media(max-width:520px){.signature-grid{grid-template-columns:1fr}.names{max-height:96px;border:0;border-bottom:1px solid var(--light-border-color)}.signature-editor{height:145px}}
:global(.signature-dialog) { max-height:90dvh;overflow:auto;margin:5dvh auto; }
</style>
