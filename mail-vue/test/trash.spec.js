import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  localStorage.setItem("token","trash-test");
  useUserStore().authenticatedToken="trash-test";
  vi.resetAllMocks();
});
afterEach(()=>localStorage.removeItem("token"));
it("paginates within the selected mailbox and confirms its full Trash before deleting in batches", async () => {
  const messages = Array.from({ length: 50 }, (_, i) => message(100 - i));
  http.get.mockImplementation(async (_url, { params }) =>
    params.cursor || params.page==="older"
      ? { messages: [message(49)], offset:50, total:51, nextCursor: null }
      : { messages, offset:0, total:51, nextCursor: 51 },
  );
  const wrapper = await mountTrash();
  await wrapper.get('[aria-label="Older"]').trigger("click");
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
  http.get.mockResolvedValue({ messages: [message(1)], total:1,offset:0,nextCursor: null });
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
  http.get.mockResolvedValue({messages:[{...message(1),unread:0}],nextCursor:null,total:1,offset:0});
  const wrapper=await mountTrash();
  await wrapper.get('.conversation-row input[type=checkbox]').setValue(true);
  await wrapper.get('.mail-toolbar [aria-label="Mark as read"]').trigger('click');
  await flushPromises();
  expect(http.post).toHaveBeenCalledWith('/v1/messages/trash-read',{emailIds:[1],read:true},{headers:{Authorization:'trash-test'}});
  expect(wrapper.get('.conversation-row').classes()).toContain('selected');
  expect(wrapper.find('.mail-toolbar [aria-label="Mark as unread"]').exists()).toBe(true);
  wrapper.unmount();
});

it("replaces filters within a pinned Trash window when finding a sender", async () => {
  const search=useMailSearchStore();
  search.filters={hasAttachment:true};
  http.get.mockResolvedValue({messages:[{...message(4),sendEmail:"alex@example.test"}],nextCursor:null,total:1,offset:0});
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
  http.get.mockResolvedValue({messages:[message(2),message(1)],nextCursor:null,total:2,offset:0});
  const wrapper=await mountTrash();
  try {
    await wrapper.get('[data-message-id="2"] input').setValue(true);
    const opener=wrapper.get(".mail-toolbar button.toolbar-text:not(.range-trigger)");
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

it("returns focus to the selected Delete forever action when the server declines deletion",async()=>{
  http.get.mockResolvedValue({messages:[message(3)],nextCursor:null,total:1,offset:0});
  http.post.mockRejectedValueOnce(new Error("Could not delete this message."));
  const wrapper=await mountTrash();
  try {
    await wrapper.get('[data-message-id="3"] input').setValue(true);
    const opener=wrapper.get(".mail-toolbar button.toolbar-text:not(.range-trigger)");
    await opener.trigger("click");
    await flushPromises();
    const cancel=wrapper.get("dialog button:first-child"), confirm=wrapper.get("dialog .confirm");
    await cancel.trigger("keydown",{key:"Tab",shiftKey:true});
    expect(document.activeElement).toBe(confirm.element);
    await confirm.trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Could not delete this message.");
    expect(document.activeElement).toBe(opener.element);
    expect(opener.element.disabled).toBe(false);
  } finally { wrapper.unmount(); }
});

it("marks only unread messages on the current Trash page and skips an already-read page", async()=>{
  const first=Array.from({length:50},(_,i)=>({...message(60-i),unread:0}));
  const second=[{...message(10),unread:0,scheduledDraftId:1},{...message(9),unread:1}];
  http.get.mockImplementation(async (_url,{params})=>params.page==="older" ? {messages:second,total:52,offset:50,nextCursor:null} : {messages:first,total:52,offset:0,nextCursor:11});
  const wrapper=await mountTrash("/trash?window=1&sender=7");
  try {
    await wrapper.get('[aria-label="Older"]').trigger('click');
    await flushPromises();
    const more=wrapper.getComponent({name:'MailPageActions'});
    more.vm.$emit('mark-read');
    await flushPromises();
    expect(http.post.mock.calls.map(([,body])=>body)).toEqual([{emailIds:[10],read:true}]);
    expect(wrapper.text()).toContain("Message marked as read.");
    more.vm.$emit('mark-read');
    await flushPromises();
    expect(wrapper.text()).toContain("No unread conversations.");
    expect(http.post).toHaveBeenCalledTimes(1);
  } finally {wrapper.unmount();}
});

it("ignores a Trash page from a previous session and does not read using a replacement credential",async()=>{
  let finish;
  http.get.mockResolvedValueOnce({total:51,offset:0,messages:[message(60)],nextCursor:60})
    .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const wrapper=await mountTrash();
  try {
    await wrapper.get('[aria-label="Older"]').trigger('click');
    expect(http.get.mock.calls.at(-1)[1]).toMatchObject({headers:{Authorization:'trash-test'},params:{page:"older",anchor:60}});
    localStorage.setItem('token','another-user');
    finish({total:51,offset:50,messages:[message(7)],nextCursor:null});
    await flushPromises();
    expect(wrapper.text()).toContain('Message 60');
    expect(wrapper.find('[data-message-id="7"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Older"]').trigger('click');
    expect(http.get).toHaveBeenCalledTimes(2);
  } finally {wrapper.unmount();}
});
