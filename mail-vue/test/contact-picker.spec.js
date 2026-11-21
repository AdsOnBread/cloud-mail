import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import Picker from "../src/components/message-composer/contact-picker.vue";
import { useUserStore } from "../src/store/user";
import http from "../src/axios";
vi.mock("../src/axios", () => ({ default: { get: vi.fn() } }));
const maya = { name: "Maya Chen", email: "maya@example.net" };
let wrapper;
beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  const user = useUserStore();
  user.authenticatedToken = "picker-token";
  user.user = { email: "owner@example.net", userId: 1 };
  localStorage.setItem("token", "picker-token");
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
  vi.resetAllMocks();
});
function open(props = {}) {
  wrapper = mount(Picker, {
    props: {
      addresses: [],
      recent: [],
      removed: [],
      owner: "owner@example.net",
      accountId: 1,
      ...props,
    },
  });
  return wrapper;
}
it("retains selections and their names without moving a row when it is checked", async () => {
  const john = { name: "John Doe", email: "john@example.net" },
    ali = { name: "Ali Lane", email: "ali@example.net" };
  http.get.mockImplementation(async (_, { params }) =>
    params.q === "ali" ? [ali] : [john, maya],
  );
  open({ addresses: ["constructor"], names: {}, recent: [] });
  await vi.advanceTimersByTimeAsync(1);
  const rows = () =>
    wrapper
      .findAll(".person input")
      .map((node) => node.attributes("aria-label"));
  const before = rows();
  await wrapper.get('input[aria-label="maya@example.net"]').setValue(true);
  expect(rows()).toEqual(before);
  await wrapper.get("input[type=search]").setValue("ali");
  await vi.advanceTimersByTimeAsync(150);
  await wrapper.get('input[aria-label="ali@example.net"]').setValue(true);
  await wrapper.get("button.insert").trigger("click");
  expect(wrapper.emitted("insert")[0][0]).toEqual([
    { email: "constructor", name: "constructor" },
    maya,
    ali,
  ]);
});
it("ignores an earlier lookup that arrives after a newer one and enriches preselected addresses", async () => {
  let release;
  http.get.mockImplementation(async (_, { params }) =>
    params.q
      ? [maya]
      : new Promise((r) => {
          release = r;
        }),
  );
  open({ addresses: [maya.email] });
  await vi.advanceTimersByTimeAsync(1);
  await wrapper.get("input[type=search]").setValue("maya");
  await vi.advanceTimersByTimeAsync(150);
  release([{ name: "Maya elsewhere", email: "late@example.net" }]);
  await flushPromises();
  expect(wrapper.find('[aria-label="late@example.net"]').exists()).toBe(false);
  await wrapper.get("button.insert").trigger("click");
  expect(wrapper.emitted("insert")[0][0]).toEqual([maya]);
});
