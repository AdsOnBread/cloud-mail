<template>
  <dialog ref="help" class="shortcut-help" aria-labelledby="shortcut-heading" @click="backdrop" @keydown.esc.stop.prevent="help.close()" @close="restoreHelpFocus">
    <div class="help-content">
      <header><h2 id="shortcut-heading">Keyboard shortcuts</h2>
        <button autofocus aria-label="Close keyboard shortcuts" @click="help.close()"><Icon icon="material-symbols:close" width="20"/></button>
      </header>
      <div class="shortcut-content">
      <section><h3>Always available</h3>
        <dl><div><dt>Show keyboard shortcuts</dt><dd><kbd>?</kbd></dd></div>
          <div><dt>Next / previous message in a conversation</dt><dd><kbd>n</kbd> / <kbd>p</kbd></dd></div></dl>
      </section>
      <section v-if="hasPerm('email:send')"><h3>Compose and format</h3>
        <dl><div v-for="[label,keys] in composeActions" :key="label"><dt>{{label}}</dt><dd><kbd>{{keys}}</kbd></dd></div></dl>
      </section>
      <section><h3>Navigation</h3>
        <dl><div v-for="item in actions" :key="item.keys"><dt>{{item.label}}</dt><dd>
          <template v-for="(key,i) in item.keys.split(' ')" :key="i"><span v-if="i"> then </span><kbd>{{key}}</kbd></template>
        </dd></div></dl>
      </section>
      </div>
      <footer>
        <span>Keyboard shortcuts are {{enabled ? 'on' : 'off'}}.
          <button type="button" class="help-link" :disabled="saving" @click="toggle">{{enabled ? 'Disable' : 'Enable'}}</button>
        </span>
        <RouterLink :to="{name:'setting',hash:'#keyboard-shortcuts'}" @click="opener=null; help.close()">Keyboard shortcut settings</RouterLink>
        <p v-if="saveError" role="alert">{{saveError}}</p>
      </footer>
    </div>
  </dialog>
</template>
<script setup>
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {Icon} from '@iconify/vue';
import http from '@/axios';
import {useUserStore} from '@/store/user';
import {useUiStore} from '@/store/ui';
import {hasPerm} from '@/perm/perm';

const props=defineProps({available:Boolean});
const emit=defineEmits(['search']);
const user=useUserStore(), ui=useUiStore(), router=useRouter(), route=useRoute();
const enabled=computed(()=>user.user.generalSettings?.keyboardShortcuts===true);
const actions=computed(()=>[
  {keys:'/',label:'Search mail'},
  {keys:'c',label:'Compose', permission:'email:send'},
  {keys:'g i',label:'Go to Inbox',route:'email'},
  {keys:'g s',label:'Go to Starred',route:'star'},
  {keys:'g b',label:'Go to Snoozed',route:'snoozed'},
  {keys:'g t',label:'Go to Sent',route:'send',permission:'email:send'},
  {keys:'g d',label:'Go to Drafts',route:'draft',permission:'email:send'},
  {keys:'g a',label:'Go to All mail',route:'all'},
  {keys:'g l',label:'Go to label'},
].filter(item=>!item.permission || hasPerm(item.permission)));
const modifier=/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const composeActions=[
  ['Send',modifier+' + Enter'],['Add Cc recipients',modifier+' + Shift + C'],['Add Bcc recipients',modifier+' + Shift + B'],
  ['Insert link',modifier+' + K'],['Bold',modifier+' + B'],['Italic',modifier+' + I'],['Underline',modifier+' + U'],
  ['Discard draft',modifier+' + Shift + D'],
];
const saving=ref(false),saveError=ref('');
let saveRun=0;
async function toggle(){
  if(saving.value) return;
  const token=user.authenticatedToken, owner=user.user.userId,run=++saveRun;
  const current=()=>run===saveRun && token===user.authenticatedToken && token===localStorage.getItem('token') && owner===user.user.userId;
  const value=!enabled.value;
  saving.value=true;
  saveError.value='';
  try {
    const config={headers:{Authorization:token},noMsg:true};
    const saved=await http.get('/v1/general-settings',config);
    if(!current()) return;
    const next=saved.keyboardShortcuts===value ? saved : await http.put('/v1/general-settings',{
      version:saved.version,undoSeconds:saved.undoSeconds ?? user.undoSeconds,replyAll:saved.replyAll,keyboardShortcuts:value,
    },config);
    if(current() && (user.user.generalSettings?.version ?? 0)<=next.version) user.user.generalSettings=next;
  } catch(error) {
    if(current()) saveError.value=error.message || 'Could not save keyboard shortcuts.';
  } finally {
    if(current()) saving.value=false;
  }
}
const help=ref(null);
let sequenceUntil=0, opener;
function reset(){sequenceUntil=0;}
function restoreHelpFocus(){
  if (document.activeElement===document.body && opener?.isConnected) opener.focus({preventScroll:true});
  opener=null;
}
function backdrop(event){
  if(event.target===help.value) help.value.close();
}
function inMailContext(event){
  if(!props.available || route.query.window==='1' || !user.authenticatedToken ||
     user.authenticatedToken!==localStorage.getItem('token') || event.defaultPrevented || event.isComposing ||
     event.keyCode===229 || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return false;
  if(event.composedPath().some(node=>node.isContentEditable || node.matches?.(
    'input,textarea,select,.send,[role="textbox"],[role="combobox"],[role="listbox"],[role="menu"],[role="dialog"]'))) return false;
  return ![...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[role="listbox"],.el-overlay,.el-dropdown__popper,.compose-format-popup,.nav-overlay,[aria-expanded="true"][aria-haspopup="menu"]')]
    .some(node=>node.getClientRects().length);
}
function keydown(event){
  const previous=sequenceUntil;
  reset();
  if(!(event.key==='?' || enabled.value) || !inMailContext(event)) return;
  if(event.key==='?'){
    event.preventDefault();opener=document.activeElement;saveError.value='';help.value.showModal();return;
  }
  if(event.shiftKey) return;
  if(event.key==='g'){
    event.preventDefault();sequenceUntil=performance.now()+1500;return;
  }
  const chord=previous>performance.now() ? 'g '+event.key : event.key;
  const action=actions.value.find(item=>item.keys===chord);
  if(!action) return;
  event.preventDefault();
  if(action.route) router.push({name:action.route});
  else if(action.keys==='c') ui.writerRef?.open();
  else emit('search',action.keys==='g l');
}
watch([()=>route.fullPath,enabled],reset);
watch([()=>user.authenticatedToken,()=>user.user.userId],()=>{
  saveRun++;saving.value=false;saveError.value='';reset();if(help.value?.open) help.value.close();
});
const resetEvents=['focusin','pointerdown','blur','compositionstart'];
onMounted(()=>{
  window.addEventListener('keydown',keydown);
  for(const name of resetEvents)window.addEventListener(name,reset,true);
});
onBeforeUnmount(()=>{
  window.removeEventListener('keydown',keydown);
  for(const name of resetEvents)window.removeEventListener(name,reset,true);
});
</script>
<style scoped>
.shortcut-help{box-sizing:border-box;width:min(600px,calc(100vw - 32px));max-height:calc(100dvh - 48px);margin:auto;padding:0;border:0;border-radius:16px;background:var(--mail-surface,var(--el-bg-color));color:var(--el-text-color-primary);box-shadow:0 8px 32px #0004;font:14px/20px Arial,sans-serif}
.shortcut-help::backdrop{background:#20212460}
.help-content{padding:20px 24px}.help-content header,.help-content dl div,.help-content footer{display:flex;align-items:center;justify-content:space-between;gap:12px}
h2{font-size:20px;font-weight:500;margin:0}h3{font-size:14px;margin:18px 0 4px}dl,dd{margin:0}dl div{min-height:28px}
dd{white-space:nowrap;color:var(--regular-text-color)}kbd{font:13px monospace;border:1px solid var(--light-border-color);border-radius:4px;display:inline-block;min-width:22px;text-align:center;padding:1px 3px}
header button{width:36px;height:36px;display:grid;place-items:center;border-radius:50%;cursor:pointer}header button:hover{background:var(--mail-hover)}
footer{border-top:1px solid var(--light-border-color);margin-top:14px;padding-top:14px;flex-wrap:wrap}
.help-content{display:flex;flex-direction:column;box-sizing:border-box;max-height:calc(100dvh - 48px)}
.shortcut-content{min-height:0;overflow:auto;overscroll-behavior:contain;padding-inline-end:4px}
header,footer{flex:none}footer p{width:100%;margin:0;color:var(--el-color-danger)}
.help-link{padding:0 3px;cursor:pointer}.help-link:disabled{opacity:.6}
.help-link,footer a{color:var(--el-color-primary);text-decoration:underline}
</style>
