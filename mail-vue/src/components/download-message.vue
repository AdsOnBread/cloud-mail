<template>
  <el-dropdown-item :disabled="!message || downloading" @click="download">
    <Icon icon="material-symbols:download" />Download message
  </el-dropdown-item>
</template>
<script setup>
import {onBeforeUnmount, ref, watch} from "vue";
import {Icon} from "@iconify/vue";
import {ElMessage} from "element-plus";
import {useUserStore} from "@/store/user";
import {useAccountStore} from "@/store/account";
import {attachmentBlob, saveAttachment} from "./mail-attachments/content";

const props = defineProps({message:Object});
const user = useUserStore(), account = useAccountStore();
const downloading = ref(false);
let pending;
function cancel() {
  pending?.abort();
  pending = null;
  downloading.value = false;
}
watch([() => props.message?.emailId, () => user.user.userId, () => user.authenticatedToken, () => account.currentAccountId], cancel, {flush:"sync"});
onBeforeUnmount(cancel);
async function download() {
  if (!props.message || downloading.value) return;
  const message = props.message, owner = user.user.userId, token = user.authenticatedToken;
  const sameSession = () => token && token === localStorage.getItem("token") && token === user.authenticatedToken &&
    owner != null && owner === message.userId && user.user.userId === owner;
  if (!sameSession()) {
    ElMessage.error("Reopen this message in your current mailbox to download it.");
    return;
  }
  const controller = pending = new AbortController();
  downloading.value = true;
  try {
    const {messageFile, messageFilename} = await import("@/utils/message-file");
    const read = (file, signal) => {
      if (!sameSession()) throw new Error("Mailbox changed.");
      return attachmentBlob(file, signal, false, token);
    };
    const blob = await messageFile(message, owner, read, controller.signal);
    if (!controller.signal.aborted && sameSession()) saveAttachment(blob, messageFilename(message.subject));
  } catch {
    if (!controller.signal.aborted) ElMessage.error("Couldn’t download this message. Try again.");
  } finally {
    if (pending === controller) {
      pending = null;
      downloading.value = false;
    }
  }
}
</script>
