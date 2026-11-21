import { beforeEach, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import Message from "../src/components/conversation-message/index.vue";
import { useEmailStore } from "../src/store/email";
import { useUserStore } from "../src/store/user";
import { emailRead, emailDelete } from "../src/request/email";
vi.mock("../src/request/email", () => ({
  emailDetail: vi.fn(),
  emailRead: vi.fn(async () => {}),
  emailDelete: vi.fn(async () => {}),
}));
vi.mock("../src/request/star", () => ({
  starAdd: vi.fn(async () => {}),
  starCancel: vi.fn(async () => {}),
}));
vi.mock("../src/components/shadow-html/index.vue", () => ({
  default: {
    props: ["html"],
    template: '<div class="message-html">{{html}}</div>',
  },
}));
vi.mock("element-plus", () => ({
  ElMessage: { error: vi.fn() },
  ElMessageBox: { confirm: vi.fn(async () => {}) },
}));
const message = {
  emailId: 1,
  userId: 1,
  accountId: 1,
  name: "Sender",
  sendEmail: "person@example.net",
  recipient: '[{"address":"me@example.com"}]',
  cc: '[{"address":"copy@example.net"}]',
  bcc: '[{"address":"secret@example.net"}]',
  subject: "Project",
  unread: 0,
  type: 0,
  createTime: "2026-10-17 10:00:00",
};
const card = (props = {}) =>
  mount(Message, {
    props: { message: { ...message }, expanded: false, ...props },
    global: {
      stubs: { Icon: true, ElImageViewer: true,
        ElPopover:{template:'<div><slot name="reference"/><slot/></div>'},
        ElDropdown:{template:'<div><slot/><slot name="dropdown"/></div>'},
        ElDropdownMenu:{template:'<div><slot/></div>'}, ElDropdownItem:{template:'<button><slot/></button>'} },
      directives: { perm: () => {} },
    },
  });
beforeEach(() => {
  setActivePinia(createPinia());
  useUserStore().user = { userId: 1, email: "me@example.com" };
  vi.mocked(emailRead).mockClear();
  vi.mocked(emailDelete).mockClear();
});
it("loads full bodies only on expansion, marks that message read, and shows attachments", async () => {
  const load = vi
    .spyOn(useEmailStore(), "ensureDetail")
    .mockResolvedValue({
      ...message,
      content: "Complete body",
      attList: [
        {
          attId: 4,
          filename: "report.pdf",
          size: 123,
          key: "attachments/report.pdf",
        },
      ],
    });
  const wrapper = card();
  expect(load).not.toHaveBeenCalled();
  await wrapper.setProps({ expanded: true });
  await flushPromises();
  expect(load).toHaveBeenCalledTimes(1);
  expect(wrapper.get(".message-html").text()).toBe("Complete body");
  expect(wrapper.get('[aria-label="Download report.pdf"]').exists()).toBe(true);
  expect(emailRead).toHaveBeenCalledWith([1]);
  wrapper.unmount();
});
it("shows Cc on received messages and Bcc only on owned sent copies", async () => {
  vi.spyOn(useEmailStore(), "ensureDetail").mockImplementation(async (m) => m);
  const wrapper = card({ expanded: true });
  await flushPromises();
  await wrapper.get(".recipient-toggle").trigger("click");
  expect(wrapper.get(".recipient-details").text()).toContain(
    "copy@example.net",
  );
  expect(wrapper.get(".recipient-details").text()).not.toContain(
    "secret@example.net",
  );
  wrapper.unmount();
  const sent = card({ expanded: true, message: { ...message, type: 1 } });
  await flushPromises();
  await sent.get(".recipient-toggle").trigger("click");
  expect(sent.get(".recipient-details").text()).toContain("secret@example.net");
  sent.unmount();
});
it("does not delete a reply target if its draft cannot be saved", async () => {
  const beforeDelete = vi.fn(async () => false);
  vi.spyOn(useEmailStore(), "ensureDetail").mockResolvedValue(message);
  const wrapper = card({ expanded: true, beforeDelete });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "Delete")
    .trigger("click");
  await flushPromises();
  expect(beforeDelete).toHaveBeenCalledOnce();
  expect(emailDelete).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("describes the recipient summary and keeps Bcc private on a different sender's copy",async()=>{
  vi.spyOn(useEmailStore(),"ensureDetail").mockImplementation(async m=>m);
  const wrapper=card({expanded:true,message:{...message,type:1,userId:2,
    recipient:JSON.stringify([{address:"me@example.com"},{name:"Project team",address:"team@example.net"}])}});
  await flushPromises();
  const toggle=wrapper.get(".recipient-toggle");
  expect(toggle.attributes("aria-description")).toBe("to me, Project team");
  expect(wrapper.get(".recipient-details").text()).toContain("Project team <team@example.net>");
  expect(wrapper.get(".recipient-details").text()).toContain("subject:Project");
  expect(wrapper.get(".recipient-details").text()).not.toContain("secret@example.net");
  wrapper.unmount();
});

it('shows the snippet when collapsed and the sender address and recipient control when expanded',async()=>{
  vi.spyOn(useEmailStore(),"ensureDetail").mockImplementation(async m=>m);
  const wrapper=card({message:{...message,listText:'See the revised copy.'}});
  expect(wrapper.get('.snippet').text()).toBe('See the revised copy.');
  expect(wrapper.find('.address').exists()).toBe(false);
  await wrapper.get('.message-toggle').trigger('click');
  await wrapper.get('time').trigger('click');
  expect(wrapper.emitted('toggle')).toHaveLength(2);
  await wrapper.setProps({expanded:true});await flushPromises();
  expect(wrapper.find('.snippet').exists()).toBe(false);
  expect(wrapper.get('.address').text()).toContain('person@example.net');
  expect(wrapper.get('.recipient-toggle').attributes('aria-description')).toBe('to me');
  wrapper.unmount();
});

it("keeps named and empty groups in message details and the printed headers", async () => {
  const incoming = {...message, recipient:JSON.stringify([{name:"Project Team",group:[{name:"Bea",address:"bea@example.net"}]}]),
    cc:JSON.stringify([{name:"Undisclosed recipients",group:[]}]), toEmail:"delivered@example.net", text:"Notes", unread:1};
  vi.spyOn(useEmailStore(),"ensureDetail").mockResolvedValue(incoming);
  const wrapper = card({message:incoming, expanded:true});
  await flushPromises();
  expect(wrapper.get(".recipient-details").text()).toContain("Project Team: Bea <bea@example.net>;");
  expect(wrapper.get(".recipient-details").text()).toContain("Undisclosed recipients:;");
  expect(wrapper.get(".recipient-toggle").text()).toContain("to Project Team");
  const doc = document.implementation.createHTMLDocument();
  const {appendPrintedMessage} = await import("../src/components/conversation-view/print");
  await appendPrintedMessage(doc,incoming,1,()=>true,new AbortController().signal);
  expect(doc.body.textContent).toContain("To: Project Team: Bea <bea@example.net>;");
  expect(doc.body.textContent).toContain("Cc: Undisclosed recipients:;");
  expect(doc.body.textContent).not.toContain("Delivered to:");
  expect(doc.body.textContent).not.toContain("secret@example.net");
  wrapper.unmount();
});
it("gives owned expanded senders a contact trigger and removes it for another owner", async () => {
  vi.spyOn(useEmailStore(), "ensureDetail").mockImplementation(async (m) => m);
  useUserStore().authenticatedToken = "reader-session";
  const wrapper = card({expanded: true});
  await flushPromises();
  expect(wrapper.get("button.sender-person").attributes("aria-label")).toBe("Contact info for Sender");
  expect(wrapper.get("button.sender-photo").attributes("tabindex")).toBe("-1");
  await wrapper.get(".sender-person").trigger("click");
  expect(wrapper.emitted("toggle")).toBeUndefined();

  await wrapper.setProps({message: {...message, userId: 2}});
  expect(wrapper.find("button.sender-person").exists()).toBe(false);
  expect(wrapper.get("span.sender-person").text()).toBe("Sender");
  await wrapper.get(".message-toggle").trigger("click");
  expect(wrapper.emitted("toggle")).toHaveLength(1);
  wrapper.unmount();
});
