import { onBeforeUnmount, onDeactivated, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import http from "@/axios";
import { useAccountStore } from "@/store/account";
import { useUserStore } from "@/store/user";
import { useUiStore } from "@/store/ui";
import { hasPerm } from "@/perm/perm";
import { attachmentBlob } from "@/components/mail-attachments/content";
import { fileToBase64 } from "@/utils/file-utils";
import { MAX_MESSAGE_BYTES, messageSize } from "../../../shared/message-size";

export function useForwardAttachments(view) {
  const account = useAccountStore(), user = useUserStore(), ui = useUiStore(), route = useRoute();
  const forwarding = ref(false);
  let pending;
  function cancel() {
    pending?.abort();
    pending = null;
    forwarding.value = false;
  }
  watch([view, () => route.fullPath, () => user.authenticatedToken, () => user.user.userId,
    () => account.currentAccountId, () => account.currentAccount.allReceive], cancel, { flush: "sync" });
  onBeforeUnmount(cancel);
  onDeactivated(cancel);

  async function forwardMessages(ids, { trash = false, mailbox, sender } = {}) {
    if (pending || !ids.length || !hasPerm("email:send")) return;
    if (ids.length > 10) {
      ElMessage.error("Choose up to 10 messages to forward as attachments.");
      return;
    }
    const token = user.authenticatedToken, owner = user.user.userId;
    if (!token || token !== localStorage.getItem("token") || owner == null) {
      ElMessage.error("Reopen this mailbox to forward the selected messages.");
      return;
    }
    const controller = pending = new AbortController();
    const { signal } = controller;
    const current = () => !signal.aborted && token && token === localStorage.getItem("token")
      && token === user.authenticatedToken && owner != null && owner === user.user.userId;
    forwarding.value = true;
    let notice;
    const timer = setTimeout(() => {
      if (current()) notice = ElMessage({message:"Preparing attached messages…", duration:0});
    }, 400);
    try {
      const { messageFile, messageFilename } = await import("@/utils/message-file");
      const attachments = [], sizes = [];
      const checkSize = bytes => {
        if (bytes > MAX_MESSAGE_BYTES) throw new Error("These messages exceed the 5 MiB message limit, including encoding overhead.");
      };
      for (const id of ids) {
        if (!current()) return;
        const message = await http.get("/v1/messages/" + id, { signal, noMsg:true, headers:{ Authorization:token } });
        if (!current()) return;
        if (!message || message.emailId !== id || message.userId !== owner || Boolean(message.trashedAt) !== trash ||
            message.scheduledDraftId || (mailbox && message.accountId !== mailbox))
          throw new Error("A selected message is no longer available here.");
        // Reject oversized originals before downloading or encoding their contents.
        let sourceBytes = (message.text?.length || 0) + (message.content?.length || 0);
        checkSize(sourceBytes);
        const read = async file => {
          if (!current()) throw new Error("Mailbox changed.");
          checkSize(sourceBytes + (Number(file.size) || 0));
          const blob = await attachmentBlob(file, signal, false, token);
          sourceBytes += blob.size;
          checkSize(sourceBytes);
          return blob;
        };
        // The sender's Bcc header belongs to their private copy of the original.
        const blob = await messageFile(message, null, read, signal);
        if (!current()) return;
        const filename = messageFilename(message.subject);
        sizes.push({filename, type:blob.type, size:blob.size});
        checkSize(messageSize({ attachments:sizes }));
        attachments.push({filename, size:blob.size, contentType:blob.type, content:await fileToBase64(blob)});
      }
      if (current() && hasPerm("email:send"))
        await ui.writerRef.openAttachedMessages({ attachments, sender, signal });
    } catch (error) {
      if (current()) ElMessage.error(error.message || "Couldn’t attach the selected messages. Try again.");
    } finally {
      clearTimeout(timer);
      notice?.close();
      if (pending === controller) cancel();
    }
  }
  return { forwarding, forwardMessages };
}
