import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import ConversationView from "../src/components/conversation-view/index.vue";
import { conversationMessages } from "../src/request/conversation";
import { useEmailStore } from "../src/store/email";
const state = vi.hoisted(() => ({
  save: vi.fn(async () => true),
  reply: vi.fn(),
  all: vi.fn(),
  draft: vi.fn(),
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
      '<article><button :aria-expanded="expanded" @click="$emit(\'toggle\')">Message {{message.emailId}}</button><button @click="$emit(\'reply\',false)">Reply to {{message.emailId}}</button><button @click="$emit(\'reply\',true)">Reply all to {{message.emailId}}</button><slot /></article>',
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
async function setup(query = "emailId=10") {
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
    useEmailStore().pendingReplyDraft = {
      emailId: 10,
      inlineReply: true,
      content: "Saved",
      draftId: 3,
    };
    conversationMessages
      .mockResolvedValueOnce(page([message(10)]))
      .mockResolvedValue(page([message(10), message(20)]));
    const { wrapper } = await setup("emailId=10&reply=replyAll");
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
