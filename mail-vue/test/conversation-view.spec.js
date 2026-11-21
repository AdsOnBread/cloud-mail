import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import ConversationView from "../src/components/conversation-view/index.vue";
import { conversationMessages, conversationAction } from "../src/request/conversation";
import { userDraftStore } from "../src/store/draft";
import {useUserStore} from "../src/store/user";
import { useEmailStore } from "../src/store/email";
const state = vi.hoisted(() => ({
  save: vi.fn(async () => true),
  reply: vi.fn(),
  all: vi.fn(),
  draft: vi.fn(),
  readSaved: vi.fn(),
}));
vi.mock("../src/services/draft-list", () => ({
  readSavedDraft: state.readSaved,
}));
vi.mock("../src/request/conversation", () => ({
  conversationMessages: vi.fn(),
  conversationAction: vi.fn(async () => ({})),
}));
vi.mock("../src/request/email", () => ({ emailDetail: vi.fn() }));
vi.mock("../src/components/message-composer/index.vue", async () => {
  const { defineComponent, ref } = await import("vue");
  return {
    default: defineComponent({
      setup(props, { expose, emit }) {
        const visible = ref(false);
        expose({
          openReply: (message) => {
            state.reply(message);
            visible.value = true;
          },
          openReplyAll: (message) => {
            state.all(message);
            visible.value = true;
          },
          openDraft: (draft) => {
            state.draft(draft);
            visible.value = true;
          },
          saveAndClose: async () => {
            if (!(await state.save())) return false;
            visible.value = false;
            emit("closed");
            return true;
          },
        });
        return { visible };
      },
      template:
        '<div v-if="visible" class="send inline"><input aria-label="Reply body" /><button @click="$emit(\'sent\',[{emailId:20}])">Send</button></div>',
    }),
  };
});
vi.mock("../src/components/conversation-message/index.vue", () => ({
  default: {
    props: ["message", "expanded"],
    template:
      '<article><button class="message-toggle" :aria-expanded="expanded" @click="$emit(\'toggle\')">Message {{message.emailId}}</button><button @click="$emit(\'reply\',false)">Reply to {{message.emailId}}</button><button @click="$emit(\'reply\',true)">Reply all to {{message.emailId}}</button><slot /></article>',
  },
}));
const message = (id, unread = 1) => ({
  emailId: id,
  unread,
  subject: "Project",
  sendEmail: "sender@example.net",
});
const page = (messages, extra = {}) => ({
  messages,
  total: messages.length,
  hasMore: false,
  nextCursor: null,
  ...extra,
});
async function setup(query = "emailId=10", attachTo) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/mail", component: ConversationView },
      { path: "/inbox", component: { template: "<p>Inbox</p>" } },
    ],
  });
  await router.push("/mail?" + query);
  await router.isReady();
  const wrapper = mount(
    { template: "<router-view />" },
    {
      attachTo,
      global: {
        plugins: [router],
        stubs: {
          Icon: true,
          ElButton: { template: "<button><slot /></button>" },
        },
        directives: { perm: () => {} },
      },
    },
  );
  await flushPromises();
  return { wrapper, router };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(conversationMessages).mockReset();
  state.save.mockReset().mockResolvedValue(true);
  state.reply.mockClear();
  state.all.mockClear();
  state.draft.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});
describe("conversation navigation and inline targets", () => {
  it("initially expands unread/latest cards and prepends older pages chronologically", async () => {
    conversationMessages
      .mockResolvedValueOnce(
        page([message(9, 0), message(10)], {
          total: 4,
          hasMore: true,
          nextCursor: 9,
        }),
      )
      .mockResolvedValueOnce(page([message(7), message(8)], { total: 4 }));
    const { wrapper } = await setup();
    expect(wrapper.get('button[aria-expanded="true"]').text()).toContain(
      "Message 9",
    );
    expect(wrapper.findAll('button[aria-expanded="true"]')).toHaveLength(2);
    await wrapper.get(".older").trigger("click");
    await flushPromises();
    expect(conversationMessages.mock.calls[1][0]).toEqual({
      emailId: 10,
      before: 9,
      limit: 30,
    });
    expect(
      wrapper.findAll("article").map((a) => a.text().match(/Message \d+/)[0]),
    ).toEqual(["Message 7", "Message 8", "Message 9", "Message 10"]);
    wrapper.unmount();
  });
  it("keeps a saved importance choice when an older-page response arrives late", async () => {
    let finishMark, finishPage;
    conversationAction.mockReturnValueOnce(new Promise(resolve => { finishMark = resolve; }));
    conversationMessages
      .mockResolvedValueOnce(page([message(10)], {hasMore: true, nextCursor: 10, importanceReason: null}))
      .mockReturnValueOnce(new Promise(resolve => { finishPage = resolve; }));
    const { wrapper } = await setup();
    const marker = wrapper.get('[role="switch"][aria-label="Important"]');
    await marker.trigger("click");
    await wrapper.get(".older").trigger("click");
    finishMark({});
    await flushPromises();
    finishPage(page([message(9)], {importanceReason: null}));
    await flushPromises();
    expect(marker.attributes("aria-checked")).toBe("true");
    expect(wrapper.findAll("article")).toHaveLength(2);
    wrapper.unmount();
  });
  it("saves before changing targets and blocks navigation when saving fails", async () => {
    conversationMessages.mockResolvedValue(page([message(9), message(10)]));
    const { wrapper, router } = await setup();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Reply to 9")
      .trigger("click");
    await flushPromises();
    expect(state.reply).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: 9 }),
    );
    state.save.mockResolvedValueOnce(false);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Reply all to 10")
      .trigger("click");
    await flushPromises();
    expect(state.all).not.toHaveBeenCalled();
    state.save.mockResolvedValueOnce(false);
    await router.push("/inbox");
    expect(router.currentRoute.value.path).toBe("/mail");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Reply all to 10")
      .trigger("click");
    await flushPromises();
    expect(state.all).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: 10 }),
    );
    await router.push("/inbox");
    expect(router.currentRoute.value.path).toBe("/inbox");
    wrapper.unmount();
  });
  it("restores a saved inline draft into its anchor and refreshes sent replies without reopening context-menu reply", async () => {
    state.readSaved.mockResolvedValue({
      emailId: 10,
      inlineReply: true,
      content: "Saved",
      cloudDraftId:5,
      draftId: 3,
    });
    userDraftStore().items = [
      {
        emailId: 10,
        draftId: 3,
        cloudDraftId: 5,
        reply: true,
        preview: "Saved",
      },
    ];
    conversationMessages
      .mockResolvedValueOnce(page([message(10)]))
      .mockResolvedValue(page([message(10), message(20)]));
    const { wrapper } = await setup("emailId=10&draft=cloud-5&reply=replyAll");
    expect(state.draft).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 3 }),
    );
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Send")
      .trigger("click");
    await flushPromises();
    expect(state.all).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Message 20");
    expect(wrapper.find('button[aria-expanded="true"]').text()).toContain(
      "Message 10",
    );
    wrapper.unmount();
  });
  it("opens late-synced drafts and drops a previous thread's delayed draft anchor", async () => {
    conversationMessages
      .mockResolvedValueOnce(page([message(11)]))
      .mockResolvedValue(page([message(22)]));
    state.readSaved.mockImplementation(async (id) => ({
      draftId: id,
      cloudDraftId:id===1 ? 7 : 8,
      emailId: id === 1 ? 10 : 22,
    }));
    let finishDetail;
    vi.spyOn(useEmailStore(), "ensureDetail").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDetail = resolve;
        }),
    );
    const { wrapper, router } = await setup("emailId=10&draft=cloud-7");
    userDraftStore().items = [
      { emailId: 10, draftId: 1, cloudDraftId: 7, reply: true },
      { emailId: 22, draftId: 2, cloudDraftId: 8, reply: true },
    ];
    await flushPromises();
    expect(finishDetail).toBeTypeOf("function");
    await router.push("/mail?emailId=22&draft=cloud-8");
    await flushPromises();
    finishDetail(message(10));
    await flushPromises();
    expect(state.draft.mock.calls.map(([draft]) => draft.draftId)).toEqual([2]);
    expect(wrapper.text()).not.toContain("Message 10");
    wrapper.unmount();
  });
  it("opens a context reply once and ignores stale pages after the anchor changes", async () => {
    let oldResolve;
    conversationMessages
      .mockReturnValueOnce(new Promise((resolve) => (oldResolve = resolve)))
      .mockResolvedValue(page([message(22)]));
    const { wrapper, router } = await setup("emailId=10");
    await router.push("/mail?emailId=22&reply=replyAll");
    await flushPromises();
    expect(state.all).toHaveBeenCalledTimes(1);
    oldResolve(page([message(10)]));
    await flushPromises();
    expect(wrapper.text()).not.toContain("Message 10");
    expect(wrapper.text()).toContain("Message 22");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Send")
      .trigger("click");
    await flushPromises();
    expect(state.all).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});

it('serializes older-page loading and Expand all and keeps the latest message open on collapse',async()=>{
 const {emailDetail}=await import('../src/request/email');
 vi.mocked(emailDetail).mockImplementation(async id=>({...message(id),attList:[]}));
 let resolveOld;
 conversationMessages.mockResolvedValueOnce(page([message(9),message(10)],{total:4,hasMore:true,nextCursor:9}))
   .mockReturnValueOnce(new Promise(resolve=>{resolveOld=resolve;}));
 const {wrapper}=await setup();
 await wrapper.get('.older').trigger('click');
 const expand=wrapper.get('button[aria-label="Expand all"]');
 expect(expand.element.disabled).toBe(true);
 resolveOld(page([message(7),message(8)],{total:4}));await flushPromises();
 await expand.trigger('click');await flushPromises();
 expect(wrapper.findAll('button[aria-expanded="true"]')).toHaveLength(4);
 await wrapper.get('button[aria-label="Collapse all"]').trigger('click');
 expect(wrapper.findAll('button[aria-expanded="true"]')).toHaveLength(1);
 expect(wrapper.get('button[aria-expanded="true"]').text()).toContain('Message 10');
 wrapper.unmount();
});

it('lets Retry open the original saved reply after a temporary read failure',async()=>{
  const summary={emailId:10,draftId:3,cloudDraftId:5,reply:true,preview:'A saved reply'};
  userDraftStore().items=[summary];
  state.readSaved.mockRejectedValueOnce(new Error('Temporarily unavailable')).mockResolvedValueOnce({...summary,content:'Saved'});
  conversationMessages.mockResolvedValue(page([message(10)]));
  const {wrapper}=await setup('emailId=10&draft=cloud-5');
  expect(wrapper.get('[role=alert]').text()).toContain('Temporarily unavailable');
  await wrapper.get('[role=alert] button').trigger('click');await flushPromises();
  expect(state.draft).toHaveBeenCalledTimes(1);
  expect(wrapper.find('[role=alert]').exists()).toBe(false);
  expect(wrapper.find('.thread-drafts').exists()).toBe(false);
  expect(wrapper.get('a[aria-label="In new window"]').attributes('href')).toContain('draft=cloud-5');
  wrapper.unmount();
});
it('keeps a late keyboard page out of a changed session',async()=>{
  let finish;
  conversationMessages.mockResolvedValueOnce(page([message(10),message(11)],{hasMore:true,nextCursor:10,total:3}))
    .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
  const {wrapper}=await setup('emailId=10',document.body);
  const first=wrapper.get('.message-toggle');first.element.focus();
  await first.trigger('keydown',{key:'p'});expect(finish).toBeTypeOf('function');
  useUserStore().authenticatedToken='different';
  finish(page([message(7)]));await flushPromises();
  expect(wrapper.text()).not.toContain('Message 7');
  wrapper.unmount();
});
it('places the saved row after its source and opens it directly from the toolbar',async()=>{
  const summary={emailId:10,draftId:3,reply:true,preview:'A saved reply'};
  userDraftStore().items=[summary];state.readSaved.mockResolvedValueOnce(summary);
  conversationMessages.mockResolvedValue(page([message(10),message(12)]));
  const {wrapper}=await setup();
  expect(wrapper.get('[data-reader-message="10"]').element.nextElementSibling.className).toBe('thread-drafts');
  await wrapper.get('button[aria-label="Open saved reply"]').trigger('click');await flushPromises();
  expect(state.draft).toHaveBeenCalledWith(summary);
  wrapper.unmount();
});

it("fills a gap before moving keyboard focus past a deep-linked draft", async () => {
  const draft = { emailId: 1, draftId: 3, cloudDraftId: 7, reply: true };
  userDraftStore().items = [draft];
  state.readSaved.mockResolvedValueOnce(draft);
  vi.spyOn(useEmailStore(), "ensureDetail").mockResolvedValue(message(1));
  conversationMessages
    .mockResolvedValueOnce(page([message(71), message(72)], { total: 5, hasMore: true, nextCursor: 71 }))
    .mockResolvedValueOnce(page([message(69), message(70)], { total: 5 }));
  const { wrapper } = await setup("emailId=1&draft=cloud-7", document.body);
  const header = wrapper.get('[data-reader-message="71"] .message-toggle');
  header.element.focus();
  await header.trigger("keydown", { key: "p" });
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.get('[data-reader-message="70"] .message-toggle').element);
  expect(wrapper.findAll("[data-reader-message]").map(card => Number(card.attributes("data-reader-message"))))
    .toEqual([1, 69, 70, 71, 72]);
  wrapper.unmount();
});
