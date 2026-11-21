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
        <strong id="keyboard-shortcuts">Keyboard shortcuts:</strong>
        <div role="radiogroup" aria-labelledby="keyboard-shortcuts">
          <label v-for="enabled in [false,true]" :key="String(enabled)" class="radio-choice">
            <input v-model="form.keyboardShortcuts" type="radio" name="keyboard-shortcuts" :value="enabled" :disabled="!ready || busy">
            Keyboard shortcuts {{enabled ? 'on' : 'off'}}
          </label>
        </div>
      </div>
      <div class="setting-row signature-row">
        <div class="signature-caption"><strong>Signature:</strong>
          <div>(appended at the end of all outgoing messages)</div>
          <a href="https://support.google.com/mail/answer/8395" target="_blank" rel="noopener" aria-label="Learn more about signatures">Learn more</a>
        </div>
        <div :inert="busy || undefined">
          <SignatureFields v-if="signatureForm" :key="signatureRevision" :form="signatureForm" :account-id="account.currentAccountId"/>
          <p v-else-if="signatureError" role="alert">{{signatureError}} <button type="button" @click="load('signatures')">Retry</button></p>
          <p v-else role="status">Loading signatures…</p>
        </div>
      </div>
      <p v-if="preferencesError" role="alert">{{preferencesError}} <button type="button" :disabled="busy" @click="load('preferences')">Retry preferences</button></p>
      <p v-if="error" role="alert">{{error}} <button v-if="conflict" type="button" :disabled="busy" @click="load(conflict,true)">Reload saved settings</button></p>
      <footer>
        <button type="submit" :disabled="!dirty || busy || Boolean(conflict)">Save Changes</button>
        <button type="button" :disabled="busy" @click="cancel">Cancel</button>
      </footer>
    </form>
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
import SignatureFields from '@/components/mail-signatures/fields.vue';
import {useMailSignatures} from '@/store/mail-signatures';

const user=useUserStore(), account=useAccountStore(), router=useRouter();
const form=reactive({undoSeconds:5,replyAll:false,keyboardShortcuts:false});
const baseline=ref(null), busy=ref(false), conflict=ref(''), error=ref(''), preferencesError=ref('');
const signatures=useMailSignatures(), signatureForm=ref(null), signatureRevision=ref(0), savedSignatures=ref(''), signatureError=ref('');
const ready=computed(()=>Boolean(baseline.value));
const preferencesChanged=computed(()=>ready.value && (baseline.value.undoSeconds!==form.undoSeconds || baseline.value.replyAll!==form.replyAll || baseline.value.keyboardShortcuts!==form.keyboardShortcuts));
const signaturesChanged=computed(()=>signatureForm.value && JSON.stringify(signatureForm.value)!==savedSignatures.value);
const dirty=computed(()=>preferencesChanged.value || signaturesChanged.value);
let generation=0;
function session() {
  const run=++generation, token=user.authenticatedToken, id=user.user.userId;
  return {current:()=>run===generation && token===localStorage.getItem('token') && token===user.authenticatedToken && id===user.user.userId,
    config:{headers:{Authorization:token},noMsg:true}};
}
function accept(saved) {
  if ((user.user.generalSettings?.version ?? 0) > saved.version) saved=user.user.generalSettings;
  user.user.generalSettings=saved;
  baseline.value={...saved,undoSeconds:user.undoSeconds,keyboardShortcuts:saved.keyboardShortcuts===true};
  Object.assign(form,{undoSeconds:user.undoSeconds,replyAll:saved.replyAll,keyboardShortcuts:baseline.value.keyboardShortcuts});
}
function acceptSignatures(data) {
  signatureRevision.value++;
  savedSignatures.value=JSON.stringify(data);
  signatureForm.value=JSON.parse(savedSignatures.value);
}
async function load(section='both', recovering=false) {
  const request=session();
  busy.value=true;
  const wantsPreferences=section!=='signatures', wantsSignatures=section!=='preferences';
  const [prefs,sigs]=await Promise.allSettled([
    wantsPreferences ? http.get('/v1/general-settings',request.config) : null,
    wantsSignatures ? signatures.load(true) : null,
  ]);
  if (!request.current()) return;
  busy.value=false;
  const prefsFailure=prefs.status==='rejected' && (prefs.reason?.message || 'Could not load settings.');
  const sigsFailure=sigs.status==='rejected' ? sigs.reason?.message || 'Could not load signatures.' :
    wantsSignatures && !sigs.value && 'Could not load signatures.';
  if (recovering && (prefsFailure || sigsFailure)) {
    error.value=prefsFailure || sigsFailure;
    return;
  }
  if (wantsPreferences) {
    preferencesError.value=prefsFailure || '';
    if (!prefsFailure) accept(prefs.value);
  }
  if (wantsSignatures) {
    signatureError.value=sigsFailure || '';
    if (!sigsFailure) acceptSignatures(sigs.value);
  }
  if (recovering) {conflict.value='';error.value='';}
}
async function save() {
  if (busy.value || conflict.value || !dirty.value) return;
  const request=session();
  const section=preferencesChanged.value ? (signaturesChanged.value ? 'both' : 'preferences') : 'signatures';
  error.value=''; busy.value=true;
  try {
    if (preferencesChanged.value) {
      const update={version:baseline.value.version,...form};
      if (signaturesChanged.value) update.signatures=signatureForm.value;
      const {signatures:savedSignatures,...saved}=await http.put('/v1/general-settings',update,request.config);
      if (!request.current()) return;
      accept(saved);
      if (savedSignatures) {
        signatures.rememberSaved(savedSignatures);
        acceptSignatures(savedSignatures);
      }
    } else {
      const saved=await signatures.save(signatureForm.value);
      if (!request.current()) return;
      acceptSignatures(saved);
    }
    busy.value=false;
    await router.push('/inbox');
  } catch (e) {
    if (request.current()) {error.value=e.message || 'Could not save settings.'; conflict.value=Number(e.code)===409 ? section : '';}
  } finally { if (request.current()) busy.value=false; }
}
function cancel() {
  if (ready.value) Object.assign(form,{undoSeconds:baseline.value.undoSeconds,replyAll:baseline.value.replyAll,keyboardShortcuts:baseline.value.keyboardShortcuts});
  if (savedSignatures.value) acceptSignatures(JSON.parse(savedSignatures.value));
  router.push('/inbox');
}
function beforeUnload(event) { event.preventDefault(); event.returnValue=''; }
watch(dirty, changed=>{
  if (changed) window.addEventListener('beforeunload',beforeUnload);
  else window.removeEventListener('beforeunload',beforeUnload);
});
watch([()=>user.user.userId,()=>user.authenticatedToken],()=>{
  baseline.value=null; signatureForm.value=null; savedSignatures.value=''; conflict.value=''; error.value=''; signatureError.value=''; preferencesError.value='';
  if (user.user.userId && user.authenticatedToken) load();
},{immediate:true});
onBeforeRouteLeave(async to=>{
  if (to.path==='/login' || !dirty.value) return true;
  if (busy.value) return false;
  try {
    await ElMessageBox.confirm('Your changes have not been saved. Discard them?', 'Unsaved changes', {
      confirmButtonText:'Discard changes',cancelButtonText:'Keep editing',customClass:'mail-confirm',autofocus:false,
    });
    return true;
  } catch { return false; }
});
onBeforeUnmount(()=>{generation++; window.removeEventListener('beforeunload',beforeUnload);});
</script>
<style scoped>
.general-settings{height:100%;overflow:auto;color:var(--el-text-color-primary);font:14px/1.5 Arial,sans-serif}
form{padding:0 20px 24px}
.setting-row{display:grid;grid-template-columns:20% minmax(0,1fr);padding:10px 0;border-bottom:1px solid #e5e5e5;align-items:start}
.signature-caption{padding-right:12px;line-height:20px}
.signature-caption a{color:var(--el-color-primary);text-decoration:underline}
.signature-row{min-height:102px}
html.dark .setting-row{border-color:var(--light-border-color)}
.setting-row strong{padding-right:12px}
form :is(select,button){border:revert;background:revert;padding:revert}
html.dark form{color-scheme:dark}
#undo-send-period{font:inherit;width:35px;height:22px;margin-inline:4px 0}
.radio-choice{display:flex;align-items:center;gap:5px;width:fit-content;cursor:pointer}
.radio-choice input{margin:0;accent-color:var(--el-color-primary)}
footer{display:flex;justify-content:center;gap:6px;padding:14px 0}
button{font:inherit;color:inherit;cursor:pointer}button:disabled{color:GrayText;cursor:default}
p[role=alert]{color:var(--el-color-danger)}
@media(max-width:600px){.setting-row.signature-row{grid-template-columns:minmax(0,1fr);gap:10px}form{padding-inline:12px}.setting-row{grid-template-columns:36% minmax(0,1fr)}}
</style>
