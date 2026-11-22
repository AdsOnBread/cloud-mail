<template>
  <dialog v-if="request" ref="dialog" class="mail-confirmation" role="alertdialog"
    :aria-labelledby="id+'-title'" :aria-describedby="id+'-message'"
    @keydown.tab="cycle" @cancel.prevent="cancel" @close="closed" @pointerdown="outsideDown=($event.target===dialog)"
    @click.self="outsideDown && cancel()">
    <div class="content">
      <h2 :id="id+'-title'">{{request.title}}</h2>
      <p :id="id+'-message'">{{request.message}}</p>
      <div class="actions">
        <button ref="cancelButton" autofocus type="button" @click="cancel">Cancel</button>
        <button ref="confirmButton" class="confirm" type="button" @click="finish(true)">{{request.confirmLabel}}</button>
      </div>
    </div>
  </dialog>
</template>
<script setup>
import {nextTick,onBeforeUnmount,ref,shallowRef,useId} from "vue";

const dialog=ref(), cancelButton=ref(), confirmButton=ref(), request=shallowRef(null), id=useId();
let outsideDown=false;
async function ask(title,message,confirmLabel) {
  if (request.value) return false;
  let resolve;
  const answer=new Promise(done=>{resolve=done;});
  const current={title,message,confirmLabel,resolve};
  request.value=current;
  outsideDown=false;
  await nextTick();
  if (request.value===current) {
    try { dialog.value.showModal(); }
    catch(error) { cancel(); throw error; }
  }
  return answer;
}
function finish(accepted) {
  const current=request.value;
  if (!current) return;
  request.value=null;
  if (dialog.value?.open) dialog.value.close();
  current.resolve(accepted);
}
function cancel() { finish(false); }
function cycle(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  const cancel=cancelButton.value, confirm=confirmButton.value;
  const target=event.target===cancel ? confirm : event.target===confirm ? cancel : event.shiftKey ? confirm : cancel;
  target.focus({preventScroll:true});
}
function closed(event) {
  if (event.target===dialog.value && !event.target.open) cancel();
}
onBeforeUnmount(cancel);
defineExpose({ask,cancel});
</script>
<style scoped>
.mail-confirmation {
  box-sizing:border-box; width:max-content; min-width:min(280px,calc(100vw - 32px));
  max-width:min(560px,calc(100vw - 32px)); max-height:calc(100dvh - 32px);
  overflow:auto; margin:auto; padding:0; border:0; border-radius:28px;
  background:var(--mail-surface); color:var(--el-text-color-primary);
  font:14px/20px Arial,sans-serif;
}
.mail-confirmation::backdrop { background:rgb(0 0 0 / 32%); }
.content {padding:24px;overflow-wrap:anywhere;}
h2 {margin:0 0 16px;font-size:24px;line-height:32px;font-weight:400;}
p {margin:0;color:var(--regular-text-color);}
.actions {display:flex;justify-content:flex-end;gap:8px;margin-top:24px;}
button {height:40px;min-width:64px;padding:0 12px;border:0;border-radius:20px;cursor:pointer;
  font:500 14px/20px Arial,sans-serif;background:transparent;color:var(--send-blue);}
button.confirm {min-width:68px;padding:0 24px;background:var(--send-blue);color:var(--send-ink);}
button:hover {background:color-mix(in srgb,var(--send-blue) 8%,transparent);}
button:active {background:color-mix(in srgb,var(--send-blue) 16%,transparent);}
button.confirm:hover {background:color-mix(in srgb,var(--send-blue),var(--send-ink) 8%);}
button.confirm:active {background:color-mix(in srgb,var(--send-blue),var(--send-ink) 16%);}
button:focus-visible {outline:2px solid var(--send-blue);outline-offset:2px;}
@media (forced-colors:active) {
  .mail-confirmation,button {border:1px solid ButtonText;}
  button:focus-visible {outline-color:Highlight;}
}
</style>
