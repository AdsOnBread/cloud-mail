<template>
  <section class="general-settings" aria-label="General settings">
    <SettingsTabs/>
    <form @submit.prevent="save">
      <div class="setting-row">
        <strong>Undo Send:</strong>
        <div><label for="undo-send-period">Send cancellation period:</label>
          <select id="undo-send-period" v-model.number="form.undoSeconds" :disabled="!ready || busy">
            <option v-for="seconds in [5,10,20,30]" :key="seconds" :value="seconds">{{seconds}}</option>
          </select> seconds</div>
      </div>
      <div class="setting-row">
        <strong id="reply-behavior">Default reply behavior:</strong>
        <div role="radiogroup" aria-labelledby="reply-behavior">
          <label v-for="all in [false,true]" :key="String(all)" class="radio-choice">
            <input v-model="form.replyAll" type="radio" name="default-reply" :value="all" :disabled="!ready || busy">{{all ? 'Reply all' : 'Reply'}}
          </label>
        </div>
      </div>
      <div class="setting-row">
        <strong>Signature:</strong>
        <div><button type="button" @click="manageSignatures=true">Manage signatures</button></div>
      </div>
      <p v-if="error" role="alert">{{error}} <button v-if="!ready || conflict" type="button" @click="load">Reload saved settings</button></p>
      <footer>
        <button type="submit" :disabled="!dirty || busy || conflict">Save Changes</button>
        <button type="button" :disabled="busy" @click="cancel">Cancel</button>
      </footer>
    </form>
    <SignatureManager v-if="manageSignatures" v-model="manageSignatures" :account-id="account.currentAccountId"/>
  </section>
</template>
<script setup>
import {computed, onBeforeUnmount, reactive, ref, watch} from 'vue';
import {onBeforeRouteLeave, useRouter} from 'vue-router';
import {ElMessageBox} from 'element-plus';
import http from '@/axios';
import {useUserStore} from '@/store/user';
import {useAccountStore} from '@/store/account';
import SettingsTabs from './tabs.vue';
import SignatureManager from '@/components/mail-signatures/manager.vue';

const user=useUserStore(), account=useAccountStore(), router=useRouter();
const form=reactive({undoSeconds:5,replyAll:false});
const baseline=ref(null), busy=ref(false), conflict=ref(false), error=ref(''), manageSignatures=ref(false);
const ready=computed(()=>Boolean(baseline.value));
const dirty=computed(()=>ready.value && (baseline.value.undoSeconds!==form.undoSeconds || baseline.value.replyAll!==form.replyAll));
let generation=0;
function session() {
  const run=++generation, token=user.authenticatedToken, id=user.user.userId;
  return {current:()=>run===generation && token===localStorage.getItem('token') && token===user.authenticatedToken && id===user.user.userId,
    config:{headers:{Authorization:token},noMsg:true}};
}
function accept(saved) {
  if ((user.user.generalSettings?.version ?? 0) > saved.version) saved=user.user.generalSettings;
  user.user.generalSettings=saved;
  baseline.value={...saved,undoSeconds:user.undoSeconds};
  Object.assign(form,{undoSeconds:user.undoSeconds,replyAll:saved.replyAll});
}
async function load() {
  const request=session();
  error.value=''; conflict.value=false; busy.value=true;
  try {
    const saved=await http.get('/v1/general-settings',request.config);
    if (request.current()) accept(saved);
  } catch (e) {
    if (request.current()) {error.value=e.message || 'Could not load settings.'; conflict.value=true;}
  } finally { if (request.current()) busy.value=false; }
}
async function save() {
  if (busy.value || conflict.value || !dirty.value) return;
  const request=session();
  error.value=''; busy.value=true;
  try {
    const saved=await http.put('/v1/general-settings',{version:baseline.value.version,...form},request.config);
    if (!request.current()) return;
    accept(saved);
    busy.value=false;
    await router.push('/inbox');
  } catch (e) {
    if (request.current()) {error.value=e.message || 'Could not save settings.'; conflict.value=e.code===409;}
  } finally { if (request.current()) busy.value=false; }
}
function cancel() {
  if (ready.value) Object.assign(form,{undoSeconds:baseline.value.undoSeconds,replyAll:baseline.value.replyAll});
  router.push('/inbox');
}
function beforeUnload(event) { event.preventDefault(); event.returnValue=''; }
watch(dirty, changed=>{
  if (changed) window.addEventListener('beforeunload',beforeUnload);
  else window.removeEventListener('beforeunload',beforeUnload);
});
watch(()=>[user.user.userId,user.authenticatedToken],()=>{
  baseline.value=null; manageSignatures.value=false;
  if (user.user.userId && user.authenticatedToken) load();
},{immediate:true});
onBeforeRouteLeave(async to=>{
  if (to.path==='/login' || !dirty.value) return true;
  if (busy.value) return false;
  try {
    await ElMessageBox.confirm('Your changes have not been saved. Discard them?', 'Unsaved changes', {
      confirmButtonText:'Discard changes',cancelButtonText:'Keep editing',autofocus:false,
    });
    return true;
  } catch { return false; }
});
onBeforeUnmount(()=>{generation++; window.removeEventListener('beforeunload',beforeUnload);});
</script>
<style scoped>
.general-settings{color:var(--el-text-color-primary);font:14px/1.5 Arial,sans-serif}
form{padding:0 20px 24px}
.setting-row{display:grid;grid-template-columns:20% minmax(0,1fr);padding:10px 0;border-bottom:1px solid #e5e5e5;align-items:start}
:global(.dark) .setting-row{border-color:var(--light-border-color)}
.setting-row strong{padding-right:12px}
select{font:inherit;height:22px;margin-inline:4px 0}
.radio-choice{display:flex;align-items:center;gap:5px;width:fit-content;cursor:pointer}
.radio-choice input{margin:0;accent-color:var(--el-color-primary)}
footer{display:flex;justify-content:center;gap:6px;padding:14px 0}
button{font:inherit;color:inherit;cursor:pointer}button:disabled{color:GrayText;cursor:default}
p[role=alert]{color:var(--el-color-danger)}
@media(max-width:600px){form{padding-inline:12px}.setting-row{grid-template-columns:36% minmax(0,1fr)}}
</style>
