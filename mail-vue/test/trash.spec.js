import { beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import Trash from "../src/views/trash/index.vue";
import { useAccountStore } from "../src/store/account";
import { useUserStore } from "../src/store/user";
import http from "../src/axios";
import { ElMessageBox } from "element-plus";

vi.mock("../src/axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("element-plus", () => ({ ElMessageBox: { confirm: vi.fn() } }));
const message = (emailId) => ({
  emailId,
  accountId: 7,
  subject: "Message " + emailId,
  name: "Alex",
  createTime: "2026-11-01",
});
async function mountTrash() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/trash", component: Trash }],
  });
  await router.push("/trash");
  await router.isReady();
  const wrapper = mount(Trash, {
    global: { plugins: [router], stubs: { Icon: true } },
  });
  await flushPromises();
  return wrapper;
}
beforeEach(() => {
  setActivePinia(createPinia());
  useAccountStore().select({ accountId: 7, email: "one@example.com" });
  useUserStore().user.permKeys = ["email:delete"];
  vi.resetAllMocks();
});
it("paginates within the selected mailbox and confirms its full Trash before deleting in batches", async () => {
  const messages = Array.from({ length: 50 }, (_, i) => message(100 - i));
  http.get.mockImplementation(async (_url, { params }) =>
    params.cursor
      ? { messages: [message(49)], nextCursor: null }
      : { messages, nextCursor: 51 },
  );
  const wrapper = await mountTrash();
  await wrapper.get('[aria-label="Next page"]').trigger("click");
  await flushPromises();
  expect(wrapper.get(".conversation-row").text()).toContain("Message 49");
  await wrapper.get(".retention button").trigger("click");
  await flushPromises();
  expect(ElMessageBox.confirm.mock.calls[0][0]).toContain(
    "51 messages and any attachments from one@example.com",
  );
  expect(
    http.get.mock.calls.every(([, { params }]) => params.accountId === 7),
  ).toBe(true);
  expect(http.post.mock.calls.map(([, body]) => body.emailIds)).toEqual([
    messages.map((m) => m.emailId),
    [49],
  ]);
  wrapper.unmount();
});
it("leaves messages in Trash when the mailbox changes while confirmation is open", async () => {
  http.get.mockResolvedValue({ messages: [message(1)], nextCursor: null });
  let confirm;
  ElMessageBox.confirm.mockReturnValue(
    new Promise((resolve) => {
      confirm = resolve;
    }),
  );
  const wrapper = await mountTrash();
  await wrapper.get(".retention button").trigger("click");
  await flushPromises();
  useAccountStore().select({ accountId: 8, email: "two@example.com" });
  await flushPromises();
  confirm();
  await flushPromises();
  expect(http.post).not.toHaveBeenCalled();
  wrapper.unmount();
});
