<template>
  <section ref="card" role="dialog" aria-label="Person info" class="person-card compose-format-popup"
    :style="position" @pointerenter="$emit('hold')" @pointerleave="$emit('leave')"
    @focusin="$emit('hold')" @keydown.esc.stop.prevent="$emit('close',true)" @keydown.tab="tab">
    <div class="identity">
      <span class="photo" aria-hidden="true"><Icon icon="material-symbols:person" width="84"/></span>
      <div class="addresses">
        <strong :title="title">{{ title }}</strong>
        <div class="email-line">
          <a ref="emailLink" :href="'mailto:'+encodeURIComponent(email)" :aria-label="'Email '+email+' (opens in a new window)'"
            :title="email" @click.prevent="send">{{ email }}</a>
          <button aria-label="Copy email" data-tip="Copy email" @click="copy"><Icon icon="material-symbols:content-copy" width="18"/></button>
        </div>
      </div>
      <button class="save" :aria-label="saveLabel" :data-tip="saveLabel" :disabled="busy || !ready" @click="save">
        <Icon :icon="saved?'material-symbols:person-check-outline':'material-symbols:person-add-alt'" width="19"/>
      </button>
    </div>
    <div class="actions">
      <button class="send-mail" aria-label="Send Mail (opens in a new window)" @click="send">
        <Icon icon="material-symbols:mail-outline" width="20"/>Send Mail
      </button>
      <button disabled aria-label="Message"><Icon icon="material-symbols:chat-bubble-outline" width="19"/></button>
      <button disabled aria-label="Send a video meeting invite"><Icon icon="material-symbols:videocam-outline" width="20"/></button>
      <a :href="calendarLink" target="_blank" rel="noopener noreferrer" aria-label="Schedule 1:1 (opens in a new window)" data-tip="Schedule 1:1">
        <Icon icon="material-symbols:calendar-month-outline" width="20"/>
      </a>
    </div>
    <p v-if="notice" role="status">{{ notice }} <button v-if="!ready" @click="read">Retry</button></p>
  </section>
</template>
<script setup>
import {computed,nextTick,onMounted,onBeforeUnmount,ref} from "vue";
import {Icon} from "@iconify/vue";
import http from "@/axios";
import {useUserStore} from "@/store/user";
import {useWriterStore} from "@/store/writer";
import {positionMailboxPopup} from "../mail-popup-position";
const props=defineProps({email:String,name:String,accountId:Number,owner:String,anchor:Object,focused:Boolean});
const emit=defineEmits(["close","send","hold","leave"]);
const user=useUserStore(),writer=useWriterStore(),token=user.authenticatedToken;
const card=ref(),emailLink=ref(),position=ref({}),ready=ref(false),saved=ref(null),busy=ref(false),notice=ref("");
const title=computed(()=>saved.value?.name || props.name || props.email);
const calendarLink=computed(()=>"https://calendar.google.com/calendar/render?"+new URLSearchParams({action:"TEMPLATE",add:props.email}));
const saveLabel=computed(()=>saved.value ? "Remove from contacts" : "Add to contacts");
const controller=new AbortController();
const current=()=>!controller.signal.aborted && props.owner && user.user.email===props.owner && token && token===user.authenticatedToken && token===localStorage.getItem("token");
const config=()=>({signal:controller.signal,headers:{Authorization:token},noMsg:true});
async function read() {
  if (!current()) return emit("close");
  notice.value="";
  try {
    const value=await http.get("/v1/contacts",{...config(),params:{email:props.email,accountId:props.accountId}});
    if (current()) {saved.value=value;ready.value=true;}
  } catch { if (current()) notice.value="Couldn’t load contact."; }
}
async function save() {
  if (!current() || !ready.value || busy.value) return;
  busy.value=true;
  try {
    const value=await http.put("/v1/contacts",{email:props.email,name:title.value,accountId:props.accountId,saved:!saved.value},config());
    if (!current()) return;
    saved.value=value;
    if (value) writer.rememberAddresses(props.owner,props.accountId,[props.email]);
    writer.contactRevision++;
    notice.value=value ? "Added to contacts" : "Removed from contacts";
  } catch { if (current()) notice.value="Couldn’t update this contact. Try again."; }
  finally { busy.value=false; }
}
async function copy() {
  try {await navigator.clipboard.writeText(props.email);if (current()) notice.value="Email copied";}
  catch {if (current()) notice.value="Couldn’t copy the email address.";}
}
function send() {
  if (current()) emit("send",{email:props.email,name:title.value,accountId:props.accountId});
}
function place() {
  if (!props.anchor?.isConnected || !props.anchor.getClientRects().length) return emit("close");
  if (card.value) position.value=positionMailboxPopup(card.value,props.anchor,340);
}
function outside(event) {
  if (!card.value?.contains(event.target) && !props.anchor.contains(event.target)) emit("close");
}
function tab(event) {
  const actions=[...card.value.querySelectorAll("a,button:not(:disabled)")];
  if (event.shiftKey ? document.activeElement!==actions[0] : document.activeElement!==actions.at(-1)) return;
  event.preventDefault();emit("close",true);
}
function focus() {emailLink.value?.focus({preventScroll:true});}
defineExpose({focus});
let observer;
onMounted(async()=>{
  place();read();
  observer=new ResizeObserver(place);
  observer.observe(card.value);observer.observe(props.anchor);
  window.addEventListener("scroll",place,true);window.addEventListener("resize",place);
  window.visualViewport?.addEventListener("resize",place);
  document.addEventListener("pointerdown",outside,true);document.addEventListener("focusin",outside,true);
  // Editor bodies are iframes and don't bubble their pointer events.
  window.addEventListener("blur",windowBlur);
  if (props.focused) { await nextTick();focus(); }
});
function windowBlur(){ if (document.activeElement?.tagName==="IFRAME") emit("close"); }
onBeforeUnmount(()=>{
  controller.abort();observer?.disconnect();
  window.removeEventListener("scroll",place,true);window.removeEventListener("resize",place);
  window.visualViewport?.removeEventListener("resize",place);
  document.removeEventListener("pointerdown",outside,true);document.removeEventListener("focusin",outside,true);window.removeEventListener("blur",windowBlur);
});
</script>
<style scoped>
.person-card {position:fixed;z-index:10000;box-sizing:border-box;padding:12px 12px 20px;width:340px;
  border-radius:12px;color:#1f1f1f;background:#f8fafd;box-shadow:0 4px 8px 3px #0002,0 1px 3px #0003;
  font:14px/20px Arial,sans-serif;overflow:auto;}
.identity,.email-line,.actions {display:flex;align-items:center;}
.identity {gap:12px;position:relative;min-height:80px;}
.photo {display:grid;place-items:end center;overflow:hidden;flex:none;width:80px;height:80px;border-radius:50%;background:#adc6ff;color:#5276cf;}
.photo svg {transform:translateY(9px);}
.addresses {min-width:0;flex:1;}
.addresses strong,.email-line a {overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.addresses strong {display:block;font:400 22px/28px Arial,sans-serif;padding-right:32px;}
.email-line {gap:3px;}
.email-line a,.email-line button {color:#315da8;}
.email-line button,.save {width:24px;height:24px;border-radius:50%;flex:none;display:grid;place-items:center;cursor:pointer;}
.save {position:absolute;top:8px;right:4px;width:32px;height:32px;}
.email-line button:hover,.save:hover {background:var(--mail-hover);}
.actions {gap:4px;margin-top:8px;}
.actions button,.actions a {height:40px;width:40px;flex:none;box-sizing:border-box;border:1px solid #747775;border-radius:24px;display:flex;align-items:center;justify-content:center;color:inherit;cursor:pointer;}
.actions .send-mail {flex:1;gap:8px;width:auto;border:0;background:#c2e7ff;color:#001d35;font:500 14px/20px Arial,sans-serif;}
.actions button:disabled {opacity:.4;cursor:default;}
.actions :is(a,button:enabled):hover {box-shadow:inset 0 0 0 48px #1f1f1f0d;}
.person-card p {margin:8px 0 0;text-align:center;font:12px/16px Arial,sans-serif;}
.person-card p button {text-decoration:underline;cursor:pointer;}
html.dark .person-card {background:#303134;color:#e3e3e3;}
html.dark .email-line :is(a,button) {color:#a8c7fa;}
html.dark .actions .send-mail {background:#004a77;color:#c2e7ff;}
@media(forced-colors:active){.person-card,.actions .send-mail{border:1px solid ButtonText;}}
</style>
