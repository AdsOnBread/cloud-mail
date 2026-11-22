<template>
  <dialog ref="help" class="shortcut-help" aria-labelledby="shortcut-heading" @click="backdrop" @keydown.esc.stop.prevent="help.close()" @close="restoreHelpFocus">
    <header><h2 id="shortcut-heading">Keyboard shortcuts</h2>
      <nav aria-label="Shortcut reference">
        <a tabindex="0" href="https://support.google.com/mail/answer/6594" target="_blank" rel="noopener noreferrer" title="Gmail keyboard shortcut reference">Open in a new window</a>
        <span aria-hidden="true"> | </span>
        <button autofocus tabindex="0" type="button" aria-label="Close keyboard shortcuts" @click="help.close()">Close</button>
      </nav>
    </header>
    <div class="shortcut-content" tabindex="0" role="region" aria-label="Shortcut list">
      <div class="help-columns">
        <div><ShortcutGroup v-if="hasPerm('email:send')" title="Compose" :items="composeActions"/>
          <ShortcutGroup title="Navigation" :items="alwaysActions"/>
        </div>
        <ShortcutGroup v-if="hasPerm('email:send')" title="Formatting" :items="formatActions"/>
      </div>
      <div class="shortcut-status">
        The following keyboard shortcuts are currently {{enabled ? 'enabled' : 'disabled'}}.
        <button type="button" tabindex="0" :disabled="saving" @click="toggle">{{enabled ? 'Disable' : 'Enable'}}</button>
        <p v-if="saveError" role="alert">{{saveError}}</p>
      </div>
      <div class="help-columns">
        <div><ShortcutGroup title="Jumping" :items="jumpActions"/>
          <ShortcutGroup title="Threadlist selection" :items="selectionActions"/>
        </div>
        <div><ShortcutGroup title="Application" :items="appActions"/>
          <ShortcutGroup title="Actions" :items="actions.filter(item=>item.keys==='m')"/>
        </div>
      </div>
      <RouterLink tabindex="0" class="settings-link" :to="{name:'setting',hash:'#keyboard-shortcuts'}" @click="opener=null; help.close()">Keyboard shortcut settings</RouterLink>
    </div>
  </dialog>
</template>
<script setup>
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import ShortcutGroup from './shortcut-group.vue';
import {selectionKeys} from './selection-keys';
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
  {keys:'m',label:'Mute conversation'},
  {keys:'c',label:'Compose', permission:'email:send'},
  {keys:'g i',label:'Go to Inbox',route:'email'},
  {keys:'g s',label:'Go to Starred',route:'star'},
  {keys:'g b',label:'Go to Snoozed',route:'snoozed'},
  {keys:'g t',label:'Go to Sent',route:'send',permission:'email:send'},
  {keys:'g d',label:'Go to Drafts',route:'draft',permission:'email:send'},
  {keys:'g a',label:'Go to All mail',route:'all'},
  {keys:'g l',label:'Go to Label'},
  {keys:'g f',label:'Go to search filters',route:'filter-settings'},
].filter(item=>!item.permission || hasPerm(item.permission)));
const modifier=/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const modified=(key,label)=>({keys:modifier+' + '+key,label});
const composeActions=[
  modified('Enter','Send'),modified('Shift + c','Add Cc recipients'),modified('Shift + b','Add Bcc recipients'),
  modified('Shift + d','Discard draft'),modified('k','Insert a link'),modified('Shift + 2','Insert emoji'),
];
const formatActions=[
  modified('z','Undo'),modified('y','Redo'),
  modified('Shift + 5','Previous font'),modified('Shift + 6','Next font'),
  modified('Shift + -','Decrease text size'),modified('Shift + +','Increase text size'),
  modified('b','Bold'),modified('i','Italics'),modified('u','Underline'),
  modified('Shift + 7','Numbered list'),modified('Shift + 8','Bulleted list'),modified('Shift + 9','Quote'),
  modified('[','Indent less'),modified(']','Indent more'),modified('Shift + l','Align left'),
  modified('Shift + e','Align center'),modified('Shift + r','Align right'),modified('Shift + x','Strikethrough'),
  modified('\\','Remove formatting'),
];
const jumpActions=computed(()=>actions.value.filter(action=>action.keys.startsWith('g ')).map(action=>({...action,keys:action.keys.replace(' ',' then ')})));
const selectionActions=Object.entries(selectionKeys).map(([key,group])=>({
  keys:'* then '+key,label:group==='None' ? 'Deselect all conversations' : 'Select '+group.toLowerCase()+' conversations',
}));
const alwaysActions=[{keys:'p / n',label:'Read previous/next message'},{keys:'?',label:'Open keyboard shortcut help'}];
const appActions=computed(()=>actions.value.filter(action=>['/','c'].includes(action.keys)));
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
let prefix='', sequenceUntil=0, opener;
function reset(){prefix='';sequenceUntil=0;}
function restoreHelpFocus(){
  if (document.activeElement===document.body && opener?.isConnected) opener.focus({preventScroll:true});
  opener=null;
}
function backdrop(event){
  if(event.target===help.value) help.value.close();
}
function inMailContext(event, allowSelection=false){
  if(!props.available || route.query.window==='1' || !user.authenticatedToken ||
     user.authenticatedToken!==localStorage.getItem('token') || event.defaultPrevented || event.isComposing ||
     event.keyCode===229 || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return false;
  if(event.composedPath().some(node=>(!allowSelection || !node.matches?.('.conversation-row .check-target input[type=checkbox],.mail-toolbar .check-target input[type=checkbox]')) && (node.isContentEditable || node.matches?.(
    'input,textarea,select,.send,[role="textbox"],[role="combobox"],[role="listbox"],[role="menu"],[role="dialog"]')))) return false;
  return ![...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[role="listbox"],.el-overlay,.el-dropdown__popper,.compose-format-popup,.nav-overlay,[aria-expanded="true"][aria-haspopup="menu"]')]
    .some(node=>node.getClientRects().length);
}
function keydown(event){
  const previous=sequenceUntil>performance.now() ? prefix : '';
  reset();
  const showingHelp=event.key==='?';
  const startsSequence=event.key==='g' || event.key==='*';
  if(!showingHelp && (!enabled.value || (event.shiftKey && event.key!=='*'))) return;
  const group=previous==='*' && selectionKeys[event.key];
  const chord=previous ? previous+' '+event.key : event.key;
  const action=actions.value.find(item=>item.keys===chord);
  if(!showingHelp && !startsSequence && !group && !action) return;
  if(!inMailContext(event, showingHelp || Boolean(group) || event.key==='*' || action?.keys==='m')) return;
  if(group) {
    const request=new CustomEvent('mail-select-group',{cancelable:true,detail:group});
    if(!window.dispatchEvent(request)) event.preventDefault();
    return;
  }
  if (action?.keys==='m') {
    if (!window.dispatchEvent(new Event("mail-mute-selection",{cancelable:true}))) event.preventDefault();
    return;
  }
  event.preventDefault();
  if(showingHelp){
    opener=document.activeElement;
    saveError.value='';
    help.value.showModal();
    help.value.querySelector('.shortcut-content').scrollTop=0;
    return;
  }
  if(startsSequence){prefix=event.key;sequenceUntil=performance.now()+1500;return;}
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
.shortcut-help{box-sizing:border-box;position:fixed;inset:5dvh auto auto 4vw;margin:0;width:92vw;max-width:none;max-height:90dvh;padding:16px;border:0;border-radius:10px;color:white;background:#222;opacity:.85;font:700 16px/normal Arial,sans-serif}
.shortcut-help[open]{display:flex;flex-direction:column}
.shortcut-help::backdrop{background:transparent}
header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding-bottom:.42em}
h2{margin:0;font:inherit;color:inherit}
nav{text-align:end}
.shortcut-help a,.shortcut-help button{padding:0;color:#dd0;background:none;font:inherit;text-decoration:underline;cursor:pointer}
.shortcut-help button:disabled{opacity:.6;cursor:wait}
.shortcut-help :is(a,button):focus-visible,.shortcut-content:focus-visible{outline:2px solid currentColor;outline-offset:-1px}
.shortcut-content{min-height:0;max-height:calc(90dvh - 60px);overflow:auto;scrollbar-gutter:stable;overscroll-behavior:contain}
.help-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border-top:1px solid #999;padding:3px 0 0;gap:12px}
@media(min-width:701px){.help-columns>.shortcut-group{justify-self:center;max-width:100%}}
.shortcut-status{text-align:center;margin-top:8px;border-top:1px solid #999;padding:8px 0}
.shortcut-status p{margin:4px 0;color:#ffc6c6}
.settings-link{display:block;margin:16px 0 2px;text-align:center}
@media(max-width:700px){.shortcut-help{padding:12px;opacity:.97}header{gap:8px}nav{font-size:14px}.help-columns{grid-template-columns:1fr;gap:0}}
@media(forced-colors:active){.shortcut-help{opacity:1;border:1px solid CanvasText}.shortcut-help button,.shortcut-help a{color:LinkText}}
</style>
