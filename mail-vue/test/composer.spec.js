import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import Composer from "../src/layout/write/index.vue";
import { useUserStore } from "../src/store/user.js";
import { useSettingStore } from "../src/store/setting.js";
import { useAccountStore } from "../src/store/account.js";
import { starInOpenEditor } from "../src/store/draft";
import {useMailFeedback} from "../src/store/mail-feedback";
import { useEmailStore } from "../src/store/email.js";
import db from "../src/db/db.js";
import { emailSend } from "../src/request/email.js";

const state = vi.hoisted(() => ({
  drafts: new Map(),
  attachments: new Map(),
  next: 1,
  editorReady: vi.fn(),
}));
vi.mock("../src/db/db.js", () => {
  const table = (map) => ({
    get:vi.fn(async id=>map.get(id)),
    add: vi.fn(async (value) => {
      const id = state.next++;
      map.set(id, structuredClone(value));
      return id;
    }),
    put: vi.fn(async (value) => {
      map.set(value.draftId, structuredClone(value));
    }),
    delete: vi.fn(async (id) => {
      map.delete(id);
    }),
  });
  return {
    default: {
      value: {
        draft: table(state.drafts),
        att: table(state.attachments),
        transaction: async (...args) => args.at(-1)(),
      },
    },
  };
});
vi.mock("../src/store/mail-signatures",()=>({useMailSignatures:()=>({
  load:async()=>({items:[],defaults:{},beforeQuote:false}),
})}));

// Composer tests isolate persistence/networking; synchronization has separate integration tests.
vi.mock("../src/services/cloud-drafts.js",()=>({
  saveLocalDraft:async input=>{
    const {default:database}=await import("../src/db/db.js");
    const {attachments,draftId,...data}=input;
    let id=draftId;
    await database.value.transaction("rw",database.value.draft,database.value.att,async()=>{
      if(id)await database.value.draft.put({...data,draftId:id});else id=await database.value.draft.add(data);
      await database.value.att.put({draftId:id,attachments});
    });
    return {...data,draftId:id,attachments};
  },
  discardDrafts:async ids=>{
    for (const id of ids) { await db.value.draft.delete(id); await db.value.att.delete(id); }
    return {dispose:async()=>{}};
  },
  removeLocalDraft:async id=>{await db.value.draft.delete(id);await db.value.att.delete(id);},
  syncCloudDrafts:async()=>{},
  sendCloudDraft:async id=>{
    const messages=await emailSend({...state.drafts.get(id),attachments:state.attachments.get(id)?.attachments||[]},()=>{});
    state.drafts.delete(id);state.attachments.delete(id);
    return messages;
  },
}));
vi.mock("../src/request/email.js", () => ({
  emailSend: vi.fn(),
  emailDetail: vi.fn(),
}));
vi.mock("../src/request/my.js", () => ({
  loginUserInfo: vi.fn(async () => ({
    userId: 1,
    email: "me@example.com",
    permKeys: ["*"],
    account: { accountId: 1, email: "me@example.com" },
  })),
}));
vi.mock("element-plus", () => ({
  ElMessage: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() }),
  ElNotification: { success: vi.fn(), warning: vi.fn() },
  ElMessageBox: { confirm: vi.fn(async () => {}) },
}));
vi.mock("../src/components/tiny-editor/index.vue", async () => {
  const { defineComponent, ref, watch } = await import("vue");
  return {
    default: defineComponent({
      props: ["defValue"],
      emits: ["change"],
      setup(props, { emit, expose }) {
        const body = ref(props.defValue || "");
        watch(
          () => props.defValue,
          (value) => {
            body.value = value;
          },
        );
        expose({
          ready: state.editorReady,
          clearEditor: () => {
            body.value = "";
          },
          getContent: () => body.value,
        });
        return { body, update: () => emit("change", body.value, body.value) };
      },
      template:
        '<textarea aria-label="Message body" v-model="body" @input="update" />',
    }),
  };
});
const button = {
  props: ["loading"],
  template: '<button type="button" :disabled="loading"><slot /></button>',
};
function composer(props = {}) {
  return mount(Composer, {
    attachTo: document.body,
    props,
    global: {
      components: { ElButton: button },
      stubs: {
        ElDialog: { template: "<div />" },
        Icon: true,
        ElTable: true,
        ElTableColumn: true,
      },
    },
  });
}
async function populate(wrapper) {
  wrapper.vm.open();
  await flushPromises();
  await wrapper
    .get('[aria-label="To recipients"]')
    .setValue("person@example.com");
  await wrapper.get('[aria-label="Subject"]').setValue("Report");
  await wrapper.get('[aria-label="Message body"]').setValue("<p>Hello</p>");
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Cc")
    .trigger("click");
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Bcc")
    .trigger("click");
  await wrapper
    .get('[aria-label="Cc recipients"]')
    .setValue("copy@example.com");
  await wrapper
    .get('[aria-label="Bcc recipients"]')
    .setValue("private@example.com");
}
beforeEach(() => {
  setActivePinia(createPinia());
  state.drafts.clear();
  state.attachments.clear();
  state.next = 1;
  useUserStore().user = {
    userId: 1,
    email: "me@example.com",
    name: "Me",
    permKeys: ["*"],
    account: { accountId: 1, email: "me@example.com" },
  };
  useAccountStore().currentAccount = {
    accountId: 1,
    email: "me@example.com",
    name: "Me",
  };
  useAccountStore().accounts = [
    { accountId: 1, email: "me@example.com", name: "Me" },
    { accountId: 3, email: "alias@example.com", name: "Alias" },
  ];
  useAccountStore().loaded = true;
  useAccountStore().owner = "me@example.com";
  vi.mocked(emailSend).mockReset();
});
describe("composer persistence and sending", () => {
  it("commits pending To/Cc/Bcc on Send, submits separate arrays, and removes the saved draft after success", async () => {
    vi.mocked(emailSend).mockResolvedValue([
      { emailId: 20, subject: "Report" },
    ]);
    const wrapper = composer();
    await populate(wrapper);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Send")
      .trigger("click");
    await flushPromises();
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        receiveEmail: ["person@example.com"],
        cc: ["copy@example.com"],
        bcc: ["private@example.com"],
      }),
      expect.any(Function),
    );
    expect(state.drafts.size).toBe(0);
    expect(state.attachments.size).toBe(0);
    wrapper.unmount();
  });
  it("sends once from a pending Bcc address and links the confirmed message", async()=>{
    vi.mocked(emailSend).mockResolvedValue([{emailId:47,subject:"Report"}]);
    const wrapper=composer();
    try {
      await populate(wrapper);
      const field=wrapper.get('[aria-label="Bcc recipients"]');
      const modifier=/Mac|iPhone|iPad/.test(navigator.platform) ? {metaKey:true} : {ctrlKey:true};
      await field.trigger("keydown",{key:"Enter",...modifier,isComposing:true});
      await field.trigger("keydown",{key:"Enter",...modifier,repeat:true});
      expect(emailSend).not.toHaveBeenCalled();
      await field.trigger("keydown",{key:"Enter",...modifier});
      await flushPromises();
      expect(emailSend).toHaveBeenCalledTimes(1);
      expect(emailSend.mock.calls[0][0].bcc).toEqual(["private@example.com"]);
      expect(useMailFeedback().notice).toMatchObject({message:"Message sent",sentEmailId:47});
    } finally {wrapper.unmount();}
  });
  it("keeps recipient fields and a saved draft after a network failure", async () => {
    vi.mocked(emailSend).mockRejectedValue(new Error("Network failed"));
    const wrapper = composer();
    await populate(wrapper);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Send")
      .trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Network failed");
    expect(wrapper.text()).toContain("private@example.com");
    expect([...state.drafts.values()][0]).toMatchObject({
      cc: ["copy@example.com"],
      bcc: ["private@example.com"],
    });
    expect(wrapper.get('[aria-label="Subject"]').element.value).toBe("Report");
    wrapper.unmount();
  });
  it("writes a forwarded attachment once in a separate window, then saves the next user edit", async () => {
    const wrapper = composer({separateWindow:"test-window"});
    const file = {filename:"original.eml", contentType:"message/rfc822", content:"VGVzdA==", size:4};
    const writes = db.value.att.put.mock.calls.length;
    try {
      wrapper.vm.openAttachedMessages({attachments:[file]});
      await flushPromises();
      expect([...state.attachments.values()][0]?.attachments).toEqual([file]);
      expect(db.value.att.put.mock.calls.length - writes).toBe(1);
      await wrapper.get('[aria-label="Subject"]').setValue("For your review");
      await flushPromises();
      expect(db.value.att.put.mock.calls.length - writes).toBe(2);
    } finally { wrapper.unmount(); }
  });
  it("autosaves a separate window’s unfinished Bcc before native close", async () => {
    const wrapper = composer({separateWindow:"test-window"});
    try {
      wrapper.vm.open();
      await flushPromises();
      await wrapper.findAll("button").find(button => button.text() === "Bcc").trigger("click");
      const input = wrapper.get('[aria-label="Bcc recipients"]');
      await input.setValue("Private Person <private@example.com>");
      await vi.waitFor(() => expect([...state.drafts.values()][0]).toMatchObject({
        cc:[], receiveEmail:[], bcc:["private@example.com"],
        replyRecipientNames:{"private@example.com":"Private Person"},
      }));
      expect(input.element.value).toBe("Private Person <private@example.com>");
      await input.setValue("");
      await vi.waitFor(() => expect(state.drafts.size).toBe(0));
      await input.setValue("new@example.com");
      await vi.waitFor(() => expect([...state.drafts.values()][0]?.bcc).toEqual(["new@example.com"]));
    } finally { wrapper.unmount(); }
  });
  it("saves a Bcc-only draft without requiring the Drafts screen to be mounted", async () => {
    const wrapper = composer();
    wrapper.vm.open();
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Bcc")
      .trigger("click");
    await wrapper
      .get('[aria-label="Bcc recipients"]')
      .setValue("private@example.com");
    await wrapper.get('[aria-label="Close and save draft"]').trigger("click");
    await flushPromises();
    expect([...state.drafts.values()][0]).toMatchObject({
      receiveEmail: [],
      cc: [],
      bcc: ["private@example.com"],
    });
    wrapper.unmount();
  });
  it("opens a cloud text draft read-only during editor initialization and keeps its revision on close", async () => {
    let ready;
    state.editorReady.mockReturnValueOnce(new Promise(resolve => { ready = resolve; }));
    const wrapper = composer({inline: true});
    const original = {draftId: 18, cloudDraftId: 54, cloudVersion: 3, accountId: 1,
      receiveEmail: ["person@example.com"], subject: "Project", text: "Hello <Alex>\nThanks!", content: ""};
    state.drafts.set(18, original);
    const opening = wrapper.vm.openDraft(original);
    await flushPromises();
    expect(wrapper.get(".write-box").attributes()).toHaveProperty("inert");
    ready();
    await opening;
    expect(wrapper.get(".write-box").attributes()).not.toHaveProperty("inert");
    expect(wrapper.get('[aria-label="Message body"]').element.value).toBe("Hello &lt;Alex&gt;<br>Thanks!");
    await wrapper.get(".send.inline").trigger("keydown",{key:"Escape"});
    await flushPromises();
    expect(state.drafts.get(18)).toEqual(original);
    wrapper.unmount();
  });
  it("removes an emptied existing draft when it is closed", async () => {
    state.drafts.set(5, { subject: "Old" });
    state.attachments.set(5, { draftId: 5, attachments: [] });
    const wrapper = composer();
    wrapper.vm.openDraft({
      draftId: 5,
      receiveEmail: [],
      cc: [],
      bcc: [],
      subject: "",
      content: "",
    });
    await flushPromises();
    await wrapper.get('[aria-label="Close and save draft"]').trigger("click");
    await flushPromises();
    expect(state.drafts.size).toBe(0);
    expect(state.attachments.size).toBe(0);
    wrapper.unmount();
  });
  it("shows the sender for aliases and hides it when only the primary address is available", async () => {
    const accounts = useAccountStore();
    accounts.loaded = false;
    useSettingStore().settings.manyEmail = 1;
    const wrapper = composer();
    wrapper.vm.open();
    await flushPromises();
    expect(wrapper.find(".from-row").exists()).toBe(false);
    useSettingStore().settings.manyEmail = 0;
    await flushPromises();
    expect(wrapper.find(".from-row").exists()).toBe(true);
    wrapper.unmount();
    accounts.currentAccount = accounts.accounts[1];
    useSettingStore().settings.manyEmail = 1;
    const alias = composer();
    alias.vm.open();
    await flushPromises();
    expect(alias.get(".from-row").text()).toContain("alias@example.com");
    alias.unmount();
  });
  it("asks once before sending an empty blind-copy message and preserves it on cancel", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.mocked(emailSend).mockResolvedValue([{emailId: 2}]);
    const wrapper = composer();
    try {
      wrapper.vm.open();
      await flushPromises();
      await wrapper.findAll("button").find(item => item.text() === "Bcc").trigger("click");
      await wrapper.get('[aria-label="Bcc recipients"]').setValue("private@example.com");
      const send = wrapper.findAll("button").find(item => item.text() === "Send");
      await send.trigger("click");
      expect(confirm).toHaveBeenCalledWith("Send this message without a subject or text in the body?");
      expect(emailSend).not.toHaveBeenCalled();
      await send.trigger("click");
      await flushPromises();
      expect(emailSend).toHaveBeenCalledTimes(1);
      expect(emailSend.mock.calls[0][0]).toMatchObject({subject:"", receiveEmail:[], bcc:["private@example.com"]});
    } finally {
      wrapper.unmount();
      confirm.mockRestore();
    }
  });
  it("asks before sending when a reopened draft only retains a removed inline file", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = composer();
    try {
      await wrapper.vm.openDraft({ subject:"", content:"", text:"", receiveEmail:["person@example.net"],
        accountId:1, attachments:[{filename:"removed.png",contentId:"removed-photo"}] });
      await flushPromises();
      expect(wrapper.find(".attachment-chip").exists()).toBe(false);
      await wrapper.findAll("button").find(button => button.text() === "Send").trigger("click");
      expect(confirm).toHaveBeenCalledWith("Send this message without a subject or text in the body?");
      expect(emailSend).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
      confirm.mockRestore();
    }
  });
  it("persists removing the last star from an otherwise empty open draft", async () => {
    const wrapper=composer();
    try {
      await wrapper.vm.openDraft({draftId:24,cloudDraftId:31,mailboxStarred:true});
      await starInOpenEditor(24,"me@example.com",false);
      await flushPromises();
      expect(state.drafts.get(24)).toMatchObject({mailboxStarred:false});
    } finally {wrapper.unmount();}
  });
  it.each([false,true])("keeps row star changes when typing in an open composer (inline %s)", async inline => {
    const wrapper=composer({inline});
    try {
      await wrapper.vm.openDraft({draftId:25,subject:"Shared",content:"Original",receiveEmail:["contact@example.com"],sendType:inline?"reply":""});
      await flushPromises();
      await starInOpenEditor(25,"me@example.com",true);
      await wrapper.get('[aria-label="Message body"]').setValue("Original continued");
      await flushPromises();
      expect(state.drafts.get(25)).toMatchObject({mailboxStarred:true,content:"Original continued"});
    } finally {wrapper.unmount();}
  });
  it("restores a subject selection from the minimized caption", async () => {
    const wrapper = composer();
    wrapper.vm.open();
    await flushPromises();
    const subject = wrapper.get('[aria-label="Subject"]');
    subject.element.focus();
    await subject.setValue("Subject line");
    subject.element.setSelectionRange(1, 5);
    await wrapper.get('[aria-label="Minimize compose"]').trigger("click");
    await wrapper.get(".compose-caption").trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(subject.element);
    expect([subject.element.selectionStart, subject.element.selectionEnd]).toEqual([1, 5]);
    wrapper.unmount();
  });
  it("updates the docked caption on blur and keeps recipient shortcuts usable from a collapsed header", async () => {
    const wrapper = composer();
    wrapper.vm.open();
    await flushPromises();
    const subject = wrapper.get('[aria-label="Subject"]');
    const caption = wrapper.get(".compose-caption");
    await subject.trigger("focus");
    expect(wrapper.get('[aria-label="Edit recipients"]').text()).toBe("Recipients");
    await subject.setValue("Meeting notes");
    expect(caption.text()).toBe("New Message");
    await subject.trigger("blur");
    expect(caption.text()).toBe("Meeting notes");
    await subject.trigger("keydown", { key: "B", ctrlKey: true, shiftKey: true });
    await flushPromises();
    const blindCopy = wrapper.get('[aria-label="Bcc recipients"]');
    expect(document.activeElement).toBe(blindCopy.element);
    await blindCopy.setValue("private@example.com");
    await blindCopy.trigger("blur");
    await subject.trigger("focus");
    expect(wrapper.get('[aria-label="Edit recipients"]').text()).toBe("private@example.com");
    await wrapper.get('[aria-label="Minimize compose"]').trigger("click");
    expect(caption.text()).toBe("Meeting notes");
    expect(caption.attributes("aria-expanded")).toBe("false");
    await caption.trigger("click");
    expect(caption.attributes("aria-expanded")).toBe("true");
    await subject.setValue("");
    await subject.trigger("blur");
    expect(caption.text()).toBe("New Message");
    wrapper.unmount();
  });
  it("opens older drafts with empty Cc/Bcc and opens populated rows for new drafts", async () => {
    const wrapper = composer();
    wrapper.vm.openDraft({
      draftId: 12,
      subject: "Old",
      receiveEmail: ["one@example.com"],
      content: "Hello",
    });
    await flushPromises();
    expect(wrapper.find('[aria-label="Cc recipients"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Bcc recipients"]').exists()).toBe(false);
    wrapper.unmount();
    const another = composer();
    another.vm.openDraft({
      draftId: 13,
      subject: null,
      receiveEmail: ["one@example.com"],
      cc: ["copy@example.com"],
      bcc: ["private@example.com"],
    });
    await flushPromises();
    expect(another.find('[aria-label="Cc recipients"]').exists()).toBe(true);
    expect(another.find('[aria-label="Bcc recipients"]').exists()).toBe(true);
    another.unmount();
  });
});

describe("shared inline replies", () => {
  const original = {
    emailId: 10,
    userId: 1,
    accountId: 3,
    sendEmail: "sender@example.net",
    name: "Sender",
    subject: "Report",
    recipient:
      '[{"address":"alias@example.com"},{"address":"other@example.net"}]',
    cc: '[{"address":"copy@example.net"},{"address":"me@example.com"}]',
    bcc: '[{"address":"secret@example.net"}]',
    content: "<p>Original</p>",
    text: "Original",
    createTime: "2026-10-17 10:00:00",
    type: 0,
  };
  it("replies from the original mailbox, shares reply headers, and never copies Bcc", async () => {
    vi.spyOn(useEmailStore(), "ensureDetail").mockResolvedValue(original);
    vi.mocked(emailSend).mockResolvedValue([{ emailId: 21 }]);
    const wrapper = composer({ inline: true });
    await wrapper.vm.openReplyAll(original);
    await flushPromises();
    expect(
      wrapper.get('[aria-label="Edit reply recipients"]').text(),
    ).toContain("Sender (sender@example.net) +2");
    expect(wrapper.find(".from-row").exists()).toBe(false);
    expect(wrapper.find('[aria-label="Subject"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("sender@example.net");
    expect(wrapper.text()).toContain("other@example.net");
    expect(wrapper.find('[aria-label="Bcc recipients"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Message body"]').setValue("<p>Reply</p>");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Send")
      .trigger("click");
    await flushPromises();
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 3,
        sendType: "reply",
        emailId: 10,
        receiveEmail: ["sender@example.net", "other@example.net"],
        cc: ["copy@example.net"],
        bcc: [],
      }),
      expect.any(Function),
    );
    expect(wrapper.emitted("sent")).toHaveLength(1);
    wrapper.unmount();
  });
  it("shows recipient editing only when the name is clicked and commits pending Cc/Bcc", async () => {
    vi.spyOn(useEmailStore(), "ensureDetail").mockResolvedValue(original);
    vi.mocked(emailSend).mockResolvedValue([{ emailId: 22 }]);
    const wrapper = composer({ inline: true });
    await wrapper.vm.openReply(original);
    await flushPromises();
    expect(wrapper.get('[aria-label="To recipients"]').isVisible()).toBe(false);
    await wrapper.get('[aria-label="Edit reply recipients"]').trigger("click");
    expect(wrapper.get('[aria-label="To recipients"]').isVisible()).toBe(true);
    expect(wrapper.find('[aria-label="Subject"]').exists()).toBe(false);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Cc")
      .trigger("click");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Bcc")
      .trigger("click");
    await wrapper
      .get('[aria-label="Cc recipients"]')
      .setValue("extra@example.net");
    await wrapper
      .get('[aria-label="Bcc recipients"]')
      .setValue("private@example.net");
    await wrapper.get('[aria-label="Edit reply recipients"]').trigger("click");
    expect(wrapper.get('[aria-label="To recipients"]').isVisible()).toBe(false);
    expect(
      wrapper.get('[aria-label="Edit reply recipients"]').text(),
    ).toContain("+2");
    await wrapper
      .get('[aria-label="Message body"]')
      .setValue("<p>My reply</p>");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Send")
      .trigger("click");
    await flushPromises();
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: ["extra@example.net"],
        bcc: ["private@example.net"],
        subject: "Re: Report",
      }),
      expect.any(Function),
    );
    wrapper.unmount();
  });
  it("keeps older reply drafts compatible while folding their original quote", async () => {
    const wrapper = composer({ inline: true });
    wrapper.vm.openDraft({
      draftId: 15,
      sendType: "reply",
      emailId: 10,
      subject: "Re: Report",
      receiveEmail: ["sender@example.net"],
      content:
        "<p>My saved reply</p><div>Yesterday Sender wrote:</div><blockquote><p>Original</p></blockquote>",
    });
    await flushPromises();
    expect(wrapper.get('[aria-label="Message body"]').element.value).toContain(
      "My saved reply",
    );
    expect(wrapper.get('[aria-label="Show quoted text"]').exists()).toBe(true);
    await wrapper.vm.saveAndClose();
    expect(state.drafts.get(15).content).toContain("Original");
    expect(state.drafts.get(15).content).toContain("cloudmail-reply-quote");
    wrapper.unmount();
  });
  it("identifies an invalid recipient and selects it for correction after the dialog closes", async () => {
    // jsdom has no native top layer; browser checks cover Escape and OK.
    HTMLDialogElement.prototype.showModal ??= function(){this.open=true;};
    const wrapper = composer({ inline: true });
    wrapper.vm.openDraft({
      draftId: 2,
      sendType: "reply",
      emailId: 10,
      subject: "Re: Report",
      receiveEmail: ["invalid"],
      content: "Reply",
    });
    await flushPromises();
    expect(wrapper.get('[aria-label="To recipients"]').isVisible()).toBe(false);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Send")
      .trigger("click");
    await flushPromises();
    const dialog=wrapper.get('dialog[open]');
    expect(dialog.text()).toContain('The address "invalid" in the "To" field was not recognized.');
    await dialog.trigger("close");
    await flushPromises();
    const input=wrapper.get('[aria-label="To recipients"]').element;
    expect(input.value.slice(input.selectionStart,input.selectionEnd)).toBe('invalid');
    expect(wrapper.get('[aria-label="To recipients"]').isVisible()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain("Invalid email");
    expect(emailSend).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("keeps quoted content and compact recipient names through draft restoration and sending", async () => {
    vi.spyOn(useEmailStore(), "ensureDetail").mockResolvedValue(original);
    const wrapper = composer({ inline: true });
    await wrapper.vm.openReply(original);
    await flushPromises();
    expect(
      wrapper
        .get('[aria-label="Show quoted text"]')
        .attributes("aria-expanded"),
    ).toBe("false");
    await wrapper.get('[aria-label="Show quoted text"]').trigger("click");
    expect(
      wrapper
        .get('[aria-label="Hide quoted text"]')
        .attributes("aria-expanded"),
    ).toBe("true");
    const body = wrapper.get('[aria-label="Message body"]');
    await body.setValue("<p>My reply</p>" + body.element.value);
    expect(await wrapper.vm.saveAndClose()).toBe(true);
    const draft = [...state.drafts.entries()][0];
    wrapper.unmount();
    const restored = composer({ inline: true });
    restored.vm.openDraft({ ...draft[1], draftId: draft[0] });
    await flushPromises();
    expect(
      restored.get('[aria-label="Edit reply recipients"]').text(),
    ).toContain("Sender (sender@example.net)");
    expect(restored.get('[aria-label="To recipients"]').isVisible()).toBe(
      false,
    );
    expect(restored.get('[aria-label="Message body"]').element.value).toContain(
      "Original",
    );
    expect(
      restored
        .get('[aria-label="Show quoted text"]')
        .attributes("aria-expanded"),
    ).toBe("false");
    vi.mocked(emailSend).mockResolvedValue([{ emailId: 22 }]);
    await restored
      .findAll("button")
      .find((b) => b.text() === "Send")
      .trigger("click");
    await flushPromises();
    expect(emailSend.mock.calls[0][0].content).toContain(
      "cloudmail-reply-quote",
    );
    expect(emailSend.mock.calls[0][0].content).toContain("Original");
    expect(emailSend.mock.calls[0][0].content).not.toContain("display:none");
    restored.unmount();
  });
  it("uses owned mailbox metadata and excludes every owned address without mailbox-list permission", async () => {
    useUserStore().user.permKeys = ["email:send"];
    useAccountStore().accounts = [];
    useAccountStore().recipientOwnAddresses = [
      "alias@example.com",
      "other@example.net",
    ];
    vi.spyOn(useEmailStore(), "ensureDetail").mockResolvedValue({
      ...original,
      mailboxEmail: "alias@example.com",
      mailboxName: "Alias",
    });
    vi.mocked(emailSend).mockResolvedValue([{ emailId: 21 }]);
    const wrapper = composer({ inline: true });
    await wrapper.vm.openReplyAll(original);
    await flushPromises();
    await wrapper.get('[aria-label="Message body"]').setValue("<p>Reply</p>");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Send")
      .trigger("click");
    await flushPromises();
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 3,
        sendEmail: "alias@example.com",
        receiveEmail: ["sender@example.net"],
        cc: ["copy@example.net"],
      }),
      expect.any(Function),
    );
    wrapper.unmount();
  });
  it("replies to the original To recipients of sent messages", async () => {
    const sent = {
      ...original,
      type: 1,
      sendEmail: "alias@example.com",
      recipient: '[{"address":"person@example.net"}]',
    };
    vi.spyOn(useEmailStore(), "ensureDetail").mockResolvedValue(sent);
    const wrapper = composer({ inline: true });
    await wrapper.vm.openReply(sent);
    await flushPromises();
    expect(wrapper.text()).toContain("person@example.net");
    await wrapper
      .get('[aria-label="Message body"]')
      .setValue("<p>Follow up</p>");
    expect(await wrapper.vm.saveAndClose()).toBe(true);
    expect([...state.drafts.values()][0]).toMatchObject({
      receiveEmail: ["person@example.net"],
      inlineReply: true,
      emailId: 10,
      accountId: 3,
    });
    wrapper.unmount();
  });
  it("keeps inline reply open when draft saving fails", async () => {
    vi.spyOn(useEmailStore(), "ensureDetail").mockResolvedValue(original);
    const wrapper = composer({ inline: true });
    await wrapper.vm.openReply(original);
    await flushPromises();
    await wrapper
      .get('[aria-label="Message body"]')
      .setValue("<p>Unsaved reply</p>");
    const storageFailure=vi.spyOn(db.value, "transaction").mockRejectedValue(new Error("Storage full"));
    expect(await wrapper.vm.saveAndClose()).toBe(false);
    storageFailure.mockRestore();
    expect(wrapper.get('[role="alert"]').text()).toContain("Could not save");
    expect(wrapper.get('[aria-label="Message body"]').element.value).toBe(
      "<p>Unsaved reply</p>",
    );
    wrapper.unmount();
  });
  it("shows a modal backdrop only for expanded desktop compose, removes it on minimize", async () => {
    const wrapper = composer();
    wrapper.vm.open();
    await flushPromises();
    expect(wrapper.find(".compose-backdrop").exists()).toBe(false);
    await wrapper.get('[aria-label="Expand compose"]').trigger("click");
    expect(wrapper.get('[role="dialog"]').attributes("aria-modal")).toBe(
      "true",
    );
    expect(wrapper.find(".compose-backdrop").exists()).toBe(true);
    await wrapper.get(".compose-backdrop").trigger("click");
    expect(wrapper.find(".compose-backdrop").exists()).toBe(true);
    await wrapper.get('[aria-label="Minimize compose"]').trigger("click");
    expect(wrapper.find(".compose-backdrop").exists()).toBe(false);
    wrapper.unmount();
  });
  it("prevents duplicate submissions and preserves an inline reply draft after failure", async () => {
    vi.spyOn(useEmailStore(), "ensureDetail").mockResolvedValue(original);
    let reject;
    vi.mocked(emailSend).mockImplementation(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    const wrapper = composer({ inline: true });
    await wrapper.vm.openReply(original);
    await flushPromises();
    await wrapper.get('[aria-label="Message body"]').setValue("<p>Reply</p>");
    const send = wrapper.findAll("button").find((b) => b.text() === "Send");
    await send.trigger("click");
    await flushPromises();
    await send.trigger("click");
    expect(emailSend).toHaveBeenCalledTimes(1);
    reject(new Error("Offline"));
    await flushPromises();
    expect([...state.drafts.values()][0]).toMatchObject({
      inlineReply: true,
      emailId: 10,
    });
    expect(wrapper.text()).toContain("Offline");
    wrapper.unmount();
  });
});

it("wraps keyboard focus at the expanded composer boundary", async () => {
  const wrapper = mount(Composer, {
    attachTo: document.body,
    global: {
      components: { ElButton: button },
      stubs: {
        ElDialog: { template: "<div />" },
        Icon: true,
        ElTable: true,
        ElTableColumn: true,
      },
    },
  });
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    { width: 10, height: 10 },
  ]);
  wrapper.vm.open();
  await flushPromises();
  await wrapper.get('[aria-label="Expand compose"]').trigger("click");
  const last = wrapper.get('[aria-label="Discard draft"]');
  last.element.focus();
  await last.trigger("keydown", { key: "Tab" });
  expect(document.activeElement).toBe(wrapper.get(".compose-caption").element);
  await wrapper
    .get(".compose-caption")
    .trigger("keydown", { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last.element);
  wrapper.unmount();
});
