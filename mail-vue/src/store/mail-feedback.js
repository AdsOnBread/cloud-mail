import { defineStore } from "pinia";
import { useEmailStore } from "./email";
import http from "@/axios";

export const useMailFeedback = defineStore("mail-feedback", {
  state: () => ({ notice:null, previousHolds:[], sequence:0, restored: 0, deliveredReply:null }),
  actions: {
    show(message, emailIds = []) {
      const old=this.notice;
      if (old?.holding && (old.undoFiling || old.busy)) {
        this.previousHolds.push(old);
        this.notice=null;
      } else this.dismiss();
      this.notice = { id:++this.sequence, message, emailIds: [...emailIds], busy: false };
    },
    dismissedDrafts(recovery, reopen) {
      this.show(recovery.count === 1 ? "Draft discarded." : recovery.count + " drafts discarded.");
      this.notice.recovery = recovery;
      this.notice.reopen = reopen;
    },
    dismiss(notice=this.notice) {
      if (this.notice===notice) this.notice=null;
      else this.previousHolds=this.previousHolds.filter(entry=>entry!==notice);
      if (notice?.recovery && !notice.busy) notice.recovery.dispose().catch(() => {});
    },
    muteChanged(action,result,token) {
      const count=result.conversationCount;
      this.show((count>1 ? count+" conversations " : "Conversation ")+(action==="mute" ? "muted." : "unmuted."));
      if (!result.undoToken) return;
      const notice=this.notice;
      notice.undoFiling=async()=>{
        if (localStorage.getItem("token")!==token) throw new Error("Reopen your mailbox to undo this action.");
        await http.post("/email/conversation/undo-move",{token:result.undoToken},{headers:{Authorization:token},noMsg:true});
        if (localStorage.getItem("token")===token) {this.restored++; useEmailStore().conversationRevision++;}
        return "Action undone.";
      };
    },
    trashed(emailIds, count = 1, noun = "conversation") {
      this.show(count === 1 ? (noun === "message" ? "Message" : "Conversation") + " moved to Trash." :
        count + " " + noun + "s moved to Trash.", emailIds);
    },
    async undo(notice=this.notice) {
      if (!notice || (!notice.recovery && !notice.undoFiling && !notice.emailIds.length) || notice.busy) return;
      const session = localStorage.getItem("token");
      notice.busy = true;
      try {
        if (notice.undoFiling) {
          const message=await notice.undoFiling();
          if (this.notice===notice) { delete notice.holding; this.show(message || 'Action undone.'); }
          else this.dismiss(notice);
          return;
        }
        if (notice.recovery) {
          const ids = await notice.recovery.restore();
          if (this.notice === notice) {
            this.show(ids.length === 1 ? "Draft restored." : "Drafts restored.");
            await notice.reopen?.(ids);
          }
          return;
        }
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
        if (notice.recovery && this.notice !== notice) notice.recovery.dispose().catch(() => {});
      }
    },
  },
});
