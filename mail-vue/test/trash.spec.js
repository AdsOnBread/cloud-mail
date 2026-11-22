import { beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import Trash from "../src/views/trash/index.vue";
import { useAccountStore } from "../src/store/account";
import { useUserStore } from "../src/store/user";
import { useMailSearchStore } from "../src/store/mail-search";
import http from "../src/axios";

vi.mock("../src/axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const message = (emailId) => ({
  emailId,
  accountId: 7,
  subject: "Message " + emailId,
  name: "Alex",
  createTime: "2026-11-01",
});
async function mountTrash(path="/trash") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/trash", component: Trash }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(Trash, {
    attachTo:document.body,
    global: { plugins: [router], stubs: { Icon: true } },
  });
  await flushPromises();
  return wrapper;
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function () { this.open=true; };
  HTMLDialogElement.prototype.close ??= function () { this.open=false; this.dispatchEvent(new Event("close")); };
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
  const dialog=wrapper.get('dialog[open]');
  expect(http.post).not.toHaveBeenCalled();
  expect(dialog.text()).toContain(
    "51 messages and any attachments from one@example.com",
  );
  await dialog.get(".confirm").trigger("click");
  await flushPromises();
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
  const wrapper = await mountTrash();
  await wrapper.get(".retention button").trigger("click");
  await flushPromises();
  expect(wrapper.find("dialog[open]").exists()).toBe(true);
  useAccountStore().select({ accountId: 8, email: "two@example.com" });
  await flushPromises();
  expect(wrapper.find("dialog[open]").exists()).toBe(false);
  expect(http.post).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("marks a row read without removing it and preserves the selection for another action", async()=>{
  http.get.mockResolvedValue({messages:[{...message(1),unread:0}],nextCursor:null});
  const wrapper=await mountTrash();
  await wrapper.get('.conversation-row input[type=checkbox]').setValue(true);
  await wrapper.get('.mail-toolbar [aria-label="Mark as read"]').trigger('click');
  await flushPromises();
  expect(http.post).toHaveBeenCalledWith('/v1/messages/trash-read',{emailIds:[1],read:true});
  expect(wrapper.get('.conversation-row').classes()).toContain('selected');
  expect(wrapper.find('.mail-toolbar [aria-label="Mark as unread"]').exists()).toBe(true);
  wrapper.unmount();
});

it("replaces filters within a pinned Trash window when finding a sender", async () => {
  const search=useMailSearchStore();
  search.filters={hasAttachment:true};
  http.get.mockResolvedValue({messages:[{...message(4),sendEmail:"alex@example.test"}],nextCursor:null});
  const wrapper=await mountTrash("/trash?window=1&sender=7");
  try {
    await wrapper.get(".conversation-row").trigger("contextmenu",{clientX:50,clientY:50});
    await flushPromises();
    const item=[...document.querySelectorAll(".row-context-menu button")].find(button=>button.textContent==="Find emails from Alex");
    item.click();
    await flushPromises();
    expect(search.filters).toEqual({from:"alex@example.test"});
    expect(http.get.mock.calls.at(-1)[1].params).toMatchObject({folder:"trash",accountId:7,from:"alex@example.test"});
  } finally { wrapper.unmount(); }
});

it("cancels selection deletion without changing the checked messages",async()=>{
  http.get.mockResolvedValue({messages:[message(2),message(1)],nextCursor:null});
  const wrapper=await mountTrash();
  try {
    await wrapper.get('[data-message-id="2"] input').setValue(true);
    const opener=wrapper.get(".mail-toolbar .toolbar-text");
    await opener.trigger("click");
    await flushPromises();
    const dialog=wrapper.get("dialog[open]");
    expect(dialog.text()).toContain("1 message and any attachments from one@example.com");
    await dialog.trigger("cancel");
    await flushPromises();
    expect(document.activeElement).toBe(opener.element);
    expect(wrapper.get('[data-message-id="2"] input').element.checked).toBe(true);
    expect(http.post).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); }
});
