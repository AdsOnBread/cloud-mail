import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ConversationList from "../src/components/conversation-list/index.vue";
import {
  conversationList,
  conversationAction,
} from "../src/request/conversation";
import { useMailSearchStore } from "../src/store/mail-search";
import { useAccountStore } from "../src/store/account";
const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", async () => ({
  ...(await vi.importActual("vue-router")),
  useRouter: () => ({ push }),
  useRoute: () => ({ name: "email" }),
}));
vi.mock("../src/request/conversation", () => ({
  conversationList: vi.fn(),
  conversationAction: vi.fn(async () => ({})),
}));
vi.mock("@vueuse/core", async () => {
  const { computed, ref } = await import("vue");
  return {
    useWindowSize: () => ({ width: ref(1440) }),
    useVirtualList: (rows) => ({
      list: computed(() => rows.value.map((data, index) => ({ data, index }))),
      containerProps: { ref: ref() },
      wrapperProps: {},
    }),
  };
});
vi.mock("element-plus", () => ({
  ElMessageBox: { confirm: vi.fn(async () => {}) },
}));
const row = (id, subject) => ({
  threadId: "t-" + id,
  lastEmailId: id,
  messageCount: 4,
  subject,
  participants: "Sender, Me",
  preview: "Hello",
  lastDate: "2026-10-17 12:00:00",
  unreadCount: 1,
  starred: 0,
});
const page = (threads, more = {}) => ({
  threads,
  total: threads.length,
  hasMore: false,
  nextCursor: null,
  ...more,
});
const deferred = () => {
  let resolve;
  return {
    promise: new Promise((r) => {
      resolve = r;
    }),
    resolve: () => resolve,
  };
};
function mountList(folder = "inbox") {
  return mount(ConversationList, {
    props: { folder },
    global: {
      stubs: {
        Icon: true,
        ElDropdown: true,
        ElDropdownMenu: true,
        ElDropdownItem: true,
      },
      directives: { perm: () => {} },
    },
  });
}
beforeEach(() => {
  setActivePinia(createPinia());
  useAccountStore().currentAccountId = 1;
  useAccountStore().currentAccount = { allReceive: 0 };
  vi.mocked(conversationList).mockReset();
  vi.mocked(conversationAction).mockClear();
  push.mockClear();
});
describe("conversation lists", () => {
  it("rejects stale search responses and resets selection and pagination", async () => {
    let oldResolve, currentResolve;
    conversationList
      .mockReturnValueOnce(new Promise((r) => (oldResolve = r)))
      .mockReturnValueOnce(new Promise((r) => (currentResolve = r)));
    const wrapper = mountList();
    useMailSearchStore().query = "new";
    await flushPromises();
    currentResolve(page([row(2, "Current")]));
    await flushPromises();
    oldResolve(page([row(1, "Stale")]));
    await flushPromises();
    expect(wrapper.text()).toContain("Current");
    expect(wrapper.text()).not.toContain("Stale");
    await wrapper.get('[aria-label="Select Current"]').setValue(true);
    conversationList.mockResolvedValueOnce(page([row(3, "Third")]));
    useMailSearchStore().query = "third";
    await flushPromises();
    expect(wrapper.find('[aria-label="Delete conversations"]').exists()).toBe(
      false,
    );
    expect(conversationList.mock.calls.at(-1)[0].cursor).toBe(null);
    wrapper.unmount();
  });
  it("opens stable message anchors and sends only anchors for whole conversation actions", async () => {
    conversationList.mockResolvedValue(page([row(22, "Report")]));
    const wrapper = mountList();
    await flushPromises();
    await wrapper
      .get('[aria-label="Open Report, 4 messages"]')
      .trigger("click");
    expect(push).toHaveBeenCalledWith({
      path: "/mail",
      query: { emailId: 22, folder: "inbox" },
    });
    await wrapper.get('[aria-label="Select Report"]').setValue(true);
    await wrapper
      .get('[aria-label="Mark conversations read"]')
      .trigger("click");
    await flushPromises();
    expect(conversationAction).toHaveBeenCalledWith("read", [22], {});
    wrapper.unmount();
  });
  it("pages conversations, preserves user-wide Starred scope and aggregate stars", async () => {
    conversationList
      .mockResolvedValueOnce(
        page([row(22, "First")], { hasMore: true, nextCursor: 22, total: 2 }),
      )
      .mockResolvedValue(page([{ ...row(10, "Second"), starred: 1 }]));
    const wrapper = mountList("starred");
    await flushPromises();
    await wrapper.get(".load-more").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("First");
    expect(wrapper.text()).toContain("Second");
    expect(conversationList.mock.calls[1][0]).toMatchObject({
      folder: "starred",
      cursor: 22,
    });
    await wrapper.get('[aria-label="Unstar conversation"]').trigger("click");
    await flushPromises();
    expect(conversationAction).toHaveBeenCalledWith("star", [10], {
      starred: false,
    });
    wrapper.unmount();
  });
});
