import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import Editor from "../src/components/tiny-editor/index.vue";
import { useUiStore } from "../src/store/ui";
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  delete window.tinymce;
});
function fakeEditor() {
  const handlers = {};
  let initialized = false,
    content = "";
  const ed = {
    on: (name, callback) => {
      handlers[name] = callback;
    },
    setContent: vi.fn((value) => {
      if (!initialized) throw new Error("Editor not initialized");
      content = value;
    }),
    getContent: vi.fn(() => {
      if (!initialized) throw new Error("Editor not initialized");
      return content;
    }),
    getBody: () => document.createElement("div"),
    dom: { toggleClass: vi.fn() },
    remove: vi.fn(),
    focus: vi.fn(),
  };
  return {
    ed,
    initialize: () => {
      initialized = true;
      handlers.init();
    },
    edit: (value) => {
      content = value;
    },
    handlers,
  };
}
it("allows a newly mounted inline composer to reset and set a quote before TinyMCE initializes", async () => {
  const fake = fakeEditor();
  window.tinymce = { init: vi.fn((options) => options.setup(fake.ed)) };
  const wrapper = mount(Editor, { props: { defValue: "" } });
  expect(() => wrapper.vm.clearEditor()).not.toThrow();
  await wrapper.setProps({ defValue: "<p>Reply with original quote</p>" });
  fake.initialize();
  expect(fake.ed.setContent).toHaveBeenLastCalledWith(
    "<p>Reply with original quote</p>",
  );
  wrapper.unmount();
});
it("preserves unsent content when switching themes", async () => {
  const first = fakeEditor(),
    second = fakeEditor();
  const settings = [];
  window.tinymce = {
    init: vi.fn((options) => {
      settings.push(options);
      options.setup(settings.length === 1 ? first.ed : second.ed);
    }),
  };
  const wrapper = mount(Editor, { props: { defValue: "<p>Original</p>" } });
  first.initialize();
  first.edit("<p>Unsent edit</p>");
  useUiStore().dark = true;
  await flushPromises();
  second.initialize();
  expect(first.ed.remove).toHaveBeenCalledOnce();
  expect(second.ed.setContent).toHaveBeenLastCalledWith("<p>Unsent edit</p>");
  expect(settings[1].content_style).toContain("#242529");
  wrapper.unmount();
});

it("waits for a replacement editor to finish before allowing its composer to close", async () => {
  const first = fakeEditor(),
    second = fakeEditor();
  let finishFirst,
    finishSecond,
    calls = 0;
  window.tinymce = {
    init: vi.fn((options) => {
      calls++;
      options.setup(calls === 1 ? first.ed : second.ed);
      return new Promise((resolve) => {
        if (calls === 1) finishFirst = resolve;
        else finishSecond = resolve;
      });
    }),
  };
  const wrapper = mount(Editor);
  first.initialize();
  finishFirst([first.ed]);
  await wrapper.vm.ready();
  useUiStore().dark = true;
  await flushPromises();
  let finished = false;
  const closing = wrapper.vm.ready().then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  second.initialize();
  finishSecond([second.ed]);
  await closing;
  expect(finished).toBe(true);
  wrapper.unmount();
});

it("serializes theme changes while the initial editor is still loading", async () => {
  const first = fakeEditor(),
    second = fakeEditor();
  let finishFirst,
    calls = 0;
  const settings = [];
  window.tinymce = {
    init: vi.fn((options) => {
      calls++;
      settings.push(options);
      options.setup(calls === 1 ? first.ed : second.ed);
      return calls === 1
        ? new Promise((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve([second.ed]);
    }),
  };
  const wrapper = mount(Editor, { props: { defValue: "<p>Draft</p>" } });
  useUiStore().dark = true;
  await wrapper.vm.$nextTick();
  useUiStore().dark = false;
  await wrapper.vm.$nextTick();
  expect(first.ed.remove).not.toHaveBeenCalled();
  expect(calls).toBe(1);
  first.initialize();
  finishFirst([first.ed]);
  await flushPromises();
  expect(calls).toBe(2);
  expect(settings[1].skin).toBe("oxide");
  second.initialize();
  wrapper.unmount();
});

it("folds quoted text without removing it from the message and toggles it independently of the toolbar", async () => {
  const fake = fakeEditor(),
    settings = [];
  window.tinymce = {
    init: vi.fn((options) => {
      settings.push(options);
      options.setup(fake.ed);
    }),
  };
  const html =
    '<p>My reply</p><div class="cloudmail-reply-quote"><p>Original message</p></div>';
  const wrapper = mount(Editor, {
    props: { defValue: html, collapseQuote: true, showToolbar: false },
  });
  fake.initialize();
  expect(wrapper.classes()).toContain("hide-toolbar");
  expect(fake.ed.getContent()).toBe(html);
  await wrapper.setProps({ showQuote: true });
  expect(fake.ed.dom.toggleClass).toHaveBeenLastCalledWith(
    expect.anything(),
    "show-reply-quote",
    true,
  );
  await wrapper.setProps({ showToolbar: true });
  expect(wrapper.classes()).not.toContain("hide-toolbar");
  expect(fake.ed.getContent()).toBe(html);
  wrapper.unmount();
});
