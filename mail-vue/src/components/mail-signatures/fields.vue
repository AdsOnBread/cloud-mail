<template>
  <div class="signature-fields">
      <div v-if="form.items.length" class="signature-grid">
        <div class="names" role="group" aria-label="Saved signatures">
          <div v-for="item in form.items" :key="item.id" :class="{chosen:item.id===selected}">
            <button type="button" class="signature-name" :aria-pressed="item.id===selected" @click="selected=item.id">{{item.name}}</button>
            <template v-if="item.id===selected">
              <button type="button" class="mail-icon" aria-label="Rename signature" data-tip="Rename" @click="askName(true)"><Icon icon="material-symbols:edit-outline" width="16"/></button>
              <button type="button" class="mail-icon" aria-label="Delete signature" data-tip="Delete" @click="remove"><Icon icon="material-symbols:delete-outline" width="16"/></button>
            </template>
          </div>
        </div>
        <div v-if="active" class="signature-editor">
          <TinyEditor :key="active.id" signature-editor :def-value="active.html" @change="changeHTML(active.id,$event)"/>
        </div>
      </div>
      <p v-else class="empty">No signatures</p>
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
  <el-dialog v-model="naming" append-to-body class="mail-dialog signature-name-dialog" :title="rename ? 'Rename signature' : 'Name new signature'"
    width="min(463px, calc(100% - 32px))" :show-close="false" @opened="nameInput?.focus()">
    <form @submit.prevent="commitName">
      <input ref="nameInput" v-model="name" placeholder="Signature name" class="name-input" aria-label="Signature name" maxlength="320" />
      <div class="length" aria-live="polite">{{name.length}}/320</div>
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
import {hasPerm} from '@/perm/perm';

const props=defineProps({form:{type:Object,required:true},accountId:Number});
const user=useUserStore(),account=useAccountStore();
const selected=ref(''),senderId=ref(props.accountId || account.currentAccountId || user.user.account?.accountId);
const naming=ref(false),rename=ref(false),name=ref(''),nameInput=ref(null);
const active=computed(()=>props.form.items.find(item=>item.id===selected.value));
const senders=computed(()=>[...new Map([user.user.account,account.currentAccount,...account.accounts]
  .filter(a=>a?.accountId && a.email).map(a=>[a.accountId,a])).values()]);
const choices=[['newMail','For new emails use'],['reply','On reply/forward use']];
watch(()=>props.form,form=>{selected.value=form.items[0]?.id || '';naming.value=false;},{immediate:true});
if(hasPerm('account:query'))account.loadAll().catch(()=>{});
function changeHTML(id,html){const item=props.form?.items.find(item=>item.id===id);if(item)item.html=html;}
function askName(edit){rename.value=edit;name.value=edit?active.value.name:'';naming.value=true;}
function commitName(){
  if(!name.value.trim() || !props.form)return;
  if(rename.value)active.value.name=name.value.trim();
  else{
    const item={id:crypto.randomUUID(),name:name.value.trim(),html:''};
    props.form.items.push(item);selected.value=item.id;
  }
  naming.value=false;
}
function setDefault(key,value){
  const pair=props.form.defaults[senderId.value] ||= {newMail:null,reply:null};
  pair[key]=value || null;
}
function remove(){
  const id=selected.value;
  props.form.items=props.form.items.filter(item=>item.id!==id);
  for(const pair of Object.values(props.form.defaults)){
    for(const [key] of choices)if(pair[key]===id)pair[key]=null;
  }
  selected.value=props.form.items[0]?.id || '';
}
</script>
<style scoped>
.signature-grid { display:grid;grid-template-columns:minmax(150px,32%) minmax(0,1fr);border:1px solid var(--light-border-color); }
.names { min-width:0;border-right:1px solid var(--light-border-color);max-height:200px;overflow:auto; }
.names > div { display:flex;align-items:center;padding-right:4px; }
.names .chosen { background:var(--mail-selected); }
.names > div:not(.chosen):hover { background:var(--mail-hover); }
.signature-name { flex:1;min-width:0;text-align:left;padding:9px 12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:inherit; }
.names .mail-icon { width:26px;height:26px; }
.signature-editor { height:170px;min-width:0; }
.create,.sig-button,.text-action { cursor:pointer;color:var(--el-color-primary);font:500 14px/20px Arial,sans-serif; }
.create { margin-top:8px;height:36px;min-width:135px;display:inline-flex;justify-content:center;align-items:center;gap:8px;border:0;border-radius:4px;padding:0 16px; }
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
.length { text-align:right;font-size:12px;color:var(--regular-text-color);margin-top:4px; }
@media(max-width:520px){.signature-grid{grid-template-columns:1fr}.names{max-height:96px;border:0;border-bottom:1px solid var(--light-border-color)}.signature-editor{height:145px}}

.empty{padding:4px 0;line-height:20px}
.create:hover,.sig-button:not(.primary):hover{background:var(--mail-hover)}
.signature-name,.names .mail-icon{cursor:pointer}
.default-pair{flex-wrap:wrap}
:global(.signature-name-dialog.el-dialog){padding:24px;border-radius:28px;margin-top:0;top:50%;transform:translateY(-50%);max-height:calc(100dvh - 24px);overflow:auto}
:global(.signature-name-dialog .el-dialog__title){font:400 24px/32px Arial,sans-serif}
:global(.signature-name-dialog .el-dialog__header){padding:0 0 20px}
:global(.signature-name-dialog .el-dialog__body){padding:0}
:global(.signature-name-dialog .el-dialog__footer){padding:22px 0 0}
.name-input{height:52px;padding:12px 16px;font-size:16px}
.name-input:focus{outline:2px solid var(--el-color-primary);outline-offset:-2px}
.sig-button{min-height:40px}.sig-button.primary{padding-inline:24px}
</style>
