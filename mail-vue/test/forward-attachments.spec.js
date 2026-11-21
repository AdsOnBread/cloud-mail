import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { ElMessage } from "element-plus";
import http from "../src/axios";
import { useForwardAttachments } from "../src/services/forward-attachments";
import { useUserStore } from "../src/store/user";
import { useUiStore } from "../src/store/ui";
import { messageFile } from "../src/utils/message-file";

vi.mock("vue-router", () => ({useRoute:() => ({fullPath:"/trash"})}));
vi.mock("element-plus", () => ({ElMessage:Object.assign(vi.fn(), {error:vi.fn()})}));
vi.mock("../src/axios", () => ({default:{get:vi.fn()}}));
vi.mock("../src/utils/message-file", () => ({
  messageFilename: subject => subject + ".eml",
  messageFile: vi.fn(() => new Blob(["MIME-Version: 1.0"], {type:"message/rfc822"})),
}));

const source = {emailId:12, userId:5, accountId:8, mailboxEmail:"alias@example.test",
  mailboxName:"Alias", subject:"Original", trashedAt:"2026-11-20", type:1, bcc:["private@example.test"]};
const scope = {trash:true, mailbox:8, pinnedSender:8};
let app, action, view, open;
beforeEach(() => {
  vi.clearAllMocks();
  const pinia = createPinia();
  setActivePinia(pinia);
  const user = useUserStore();
  user.user = {userId:5, email:"main@example.test", permKeys:["email:send"]};
  user.authenticatedToken = "fixture-session";
  localStorage.setItem("token", user.authenticatedToken);
  open = vi.fn(); useUiStore().writerRef = {openAttachedMessages:open};
  http.get.mockResolvedValue(source);
  view = ref("list");
  app = createApp({setup() {
    action = useForwardAttachments(() => view.value);
    return () => null;
  }}).use(pinia);
  app.mount(document.createElement("div"));
});
afterEach(() => app.unmount());

describe("Forward as attachment", () => {
  it("uses the pinned alias from the fetched message even after the reader is closed", async () => {
    await action.forwardMessages([12], scope);
    expect(http.get).toHaveBeenCalledWith("/v1/messages/12", expect.objectContaining({headers:{Authorization:"fixture-session"}}));
    expect(messageFile).toHaveBeenCalledWith(source, null, expect.any(Function), expect.any(AbortSignal));
    expect(open).toHaveBeenCalledWith({sender:{accountId:8, email:"alias@example.test", name:"Alias"},
      attachments:[expect.objectContaining({filename:"Original.eml", contentType:"message/rfc822", content:btoa("MIME-Version: 1.0")})]});
  });
  it.each([{userId:6}, {emailId:20}, {accountId:1}, {trashedAt:null}, {scheduledDraftId:5}, {mailboxEmail:null}])(
    "keeps the whole selection out of a draft if a message is stale or outside its scope %o", async change => {
      http.get.mockResolvedValueOnce(source).mockResolvedValueOnce({...source, emailId:13, ...change});
      await action.forwardMessages([12,13], scope);
      expect(open).not.toHaveBeenCalled();
      expect(ElMessage.error).toHaveBeenCalled();
    });
  it("cancels a delayed read when the selection changes", async () => {
    let finish;
    http.get.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
    const result = action.forwardMessages([12], scope);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    view.value = "other selection";
    finish(source);
    await result;
    expect(messageFile).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(action.forwarding.value).toBe(false);
  });
  it("rejects a selection above the attachment count before fetching messages", async () => {
    await action.forwardMessages(Array.from({length:11}, (_,i) => i+1), scope);
    expect(http.get).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining("10"));
  });
});
