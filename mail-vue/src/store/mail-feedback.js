import { defineStore } from "pinia";
import { useEmailStore } from "./email";
import http from "@/axios";

export const useMailFeedback = defineStore("mail-feedback", {
  state: () => ({ notice: null, restored: 0 }),
  actions: {
    show(message, emailIds = []) {
      this.notice = { message, emailIds: [...emailIds], busy: false };
    },
    trashed(emailIds, count = 1, noun = "conversation") {
      this.show(count === 1 ? (noun === "message" ? "Message" : "Conversation") + " moved to Trash." :
        count + " " + noun + "s moved to Trash.", emailIds);
    },
    async undo() {
      const notice = this.notice;
      if (!notice?.emailIds.length || notice.busy) return;
      const session = localStorage.getItem("token");
      notice.busy = true;
      try {
        while (notice.emailIds.length) {
          if (localStorage.getItem("token") !== session) return;
          const batch = notice.emailIds.slice(0, 50);
          await http.post("/v1/messages/restore", { emailIds: batch });
          notice.emailIds.splice(0, batch.length);
          this.restored++;
          useEmailStore().conversationRevision++;
        }
        if (this.notice === notice) this.show("Action undone.");
      } catch (error) {
        notice.message = error.message || "Could not restore the messages. Try Undo again.";
      } finally {
        notice.busy = false;
      }
    },
  },
});
