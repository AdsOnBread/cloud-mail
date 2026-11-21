<template>
  <div class="trash-responses">
    <SavedReplies :drafts="saved" @open="resume"/>
    <MessageComposer v-if="editing" ref="composer" inline @closed="closed" @sent="closed"/>
    <div v-if="message && !editing" class="response-buttons">
      <button v-for="choice in choices" :key="choice.command" type="button" @click="open(choice.command)">
        <Icon :icon="choice.icon" width="20"/>{{choice.title}}
      </button>
    </div>
  </div>
</template>
<script setup>
import {computed,nextTick,ref,onBeforeUnmount} from "vue";
import {onBeforeRouteLeave,onBeforeRouteUpdate} from "vue-router";
import {Icon} from "@iconify/vue";
import {ElMessage} from "element-plus";
import SavedReplies from "@/components/conversation-view/saved-replies.vue";
import MessageComposer from "@/components/message-composer/index.vue";
import {userDraftStore} from "@/store/draft";
import {useUserStore} from "@/store/user";
import {useUiStore} from "@/store/ui";
import {readSavedDraft} from "@/services/draft-list";

const props=defineProps({message:Object, sourceId:Number, choices:Array});
const drafts=userDraftStore(), user=useUserStore(), ui=useUiStore();
const composer=ref(), editing=ref(false), opening=ref(false), activeId=ref(null);
const saved=computed(()=>drafts.items.filter(d=>(d.trashSource===props.sourceId || d.reply && d.emailId===props.sourceId) &&
  d.draftId!==activeId.value));
let mounted=true;
onBeforeUnmount(()=>{mounted=false;});
async function save() {
  return !opening.value && ((await composer.value?.saveAndClose()) ?? true);
}
onBeforeRouteLeave(save);
onBeforeRouteUpdate(save);
function closed() {editing.value=false;activeId.value=null;}
async function open(command,summary) {
  if (opening.value) return;
  if (!summary && editing.value) {
    if (!(await save())) return;
  }
  if (!props.message || props.message.scheduledDraftId) return;
  const source=props.sourceId, owner=user.user.userId, token=user.authenticatedToken;
  const current=()=>mounted && props.sourceId===source && props.message?.userId===owner && token &&
    user.user.userId===owner && user.authenticatedToken===token && localStorage.getItem("token")===token;
  if (!current()) return;
  opening.value=true;
  try {
    let draft;
    if (summary) {
      if (await ui.writerRef?.focusDraft?.(summary.draftId) || !current()) return;
      draft=await readSavedDraft(summary.draftId);
      if (!current()) return;
      if ((draft.trashSource || draft.emailId)!==source || (draft.ownerEmail && draft.ownerEmail!==user.user.email) ||
          (summary.clientId && draft.clientId!==summary.clientId)) throw new Error("This draft is no longer available.");
      if (editing.value && !(await composer.value?.saveAndClose())) return;
    }
    if (!current()) return;
    activeId.value=draft?.draftId;
    editing.value=true;
    await nextTick();
    if (!current() || !composer.value) {closed();return;}
    if (draft) await composer.value.openDraft(draft);
    else if (!await composer.value[command](props.message)) {closed();return;}
    composer.value?.$el?.parentElement?.querySelector(".send.inline")?.scrollIntoView({block:"nearest"});
  } catch(error) {
    if (current()) {
      if (!composer.value?.visible) closed();
      ElMessage.error(error.message || "Could not open the draft.");
    }
  } finally {opening.value=false;}
}
function resume(summary) {return open(null,summary);}
defineExpose({open,save});
</script>
<style scoped>
.trash-responses {margin-inline-start:56px}
.response-buttons {display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}
.response-buttons button {display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 16px;border:1px solid var(--regular-text-color);border-radius:18px;color:var(--el-text-color-primary);font:500 14px/20px Arial,sans-serif;cursor:pointer}
.response-buttons button:is(:hover,:focus-visible) {background:var(--mail-hover)}
@media(max-width:767px){.trash-responses{margin-inline-start:0}}
</style>
