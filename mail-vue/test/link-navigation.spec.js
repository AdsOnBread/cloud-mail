import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, flushPromises} from "@vue/test-utils";
import ComposeLink from "../src/components/tiny-editor/compose-link.vue";

// Use a real iframe selection. Deliver the native movements and TinyMCE events
// independently so a test can cover platform-specific keys on any test host.
describe("link options while writing", () => {
  let wrapper, frame, doc, link, beforeText, afterText, emit, caret, selection;
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {observe() {} disconnect() {}});
    frame = document.body.appendChild(document.createElement("iframe"));
    doc = frame.contentDocument;
    doc.body.innerHTML = 'Before <a href="https://example.org/notes">Design <b>notes</b></a> after';
    link = doc.querySelector("a");
    beforeText = link.previousSibling;
    afterText = link.nextSibling;
    selection = doc.getSelection();
    caret = (node, offset) => selection.setBaseAndExtent(node, offset, node, offset);
    caret(beforeText, 0);
    const handlers = new Map();
    const editor = {
      initialized:true, iframeElement:frame, hasFocus:() => true,
      getDoc:() => doc, getWin:() => frame.contentWindow,
      dom:{
        getParent:(node, selector) => (node.closest ? node : node.parentElement).closest(selector),
        createRng:() => Object.assign(doc.createRange(), {getBoundingClientRect:() => ({left:0, top:0, height:16})}),
      },
      selection:{getRng:() => selection.getRangeAt(0), getBookmark:() => ({})},
      on(names, callback) {
        for (const name of names.split(" ")) handlers.set(name,[...(handlers.get(name) || []),callback]);
      },
      off(names, callback) {
        for (const name of names.split(" ")) handlers.set(name,(handlers.get(name)||[]).filter(fn=>fn!==callback));
      },
    };
    emit = (name, event={}) => { for (const fn of [...(handlers.get(name) || [])]) fn(event); };
    wrapper = mount(ComposeLink, {props:{editor}, attachTo:document.body, global:{stubs:{Icon:true}}});
  });
  afterEach(() => { wrapper.unmount(); frame.remove(); vi.unstubAllGlobals(); });

  async function enterLink() {
    emit("keydown",{key:"ArrowRight"});
    caret(link.firstChild,2);
    emit("keyup",{key:"ArrowRight"});
    await flushPromises();
    return wrapper.get('[aria-label="Link options"]');
  }

  it("opens on keyboard entry and closes when a native line command leaves the link", async () => {
    await enterLink();
    emit("keydown",{key:"e",ctrlKey:true});
    caret(afterText,afterText.length);
    emit("SelectionChange");
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
  it("follows a backwards selection inside the link and dismisses a selection across it", async () => {
    const preview = await enterLink();
    emit("keydown",{key:"ArrowLeft",shiftKey:true});
    selection.setBaseAndExtent(link.lastChild.firstChild,2,link.firstChild,0);
    emit("keyup",{key:"ArrowLeft"});
    await flushPromises();
    expect(wrapper.get('[role="dialog"]').element).toBe(preview.element);
    emit("keydown",{key:"a",metaKey:true});
    selection.selectAllChildren(doc.body);
    emit("keyup",{key:"a"});
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
  it("keeps the same controls after a paste and edits the current label without the caret marker", async () => {
    const preview = await enterLink();
    link.setAttribute("data-mce-selected","inline-boundary");
    link.firstChild.data = "\uFEFFPasted ";
    caret(link.firstChild,4);
    emit("SetContent",{paste:true});
    await flushPromises();
    expect(wrapper.get('[role="dialog"]').element).toBe(preview.element);
    await wrapper.findAll("button").find(b=>b.text()==="Change").trigger("click");
    expect(wrapper.get('[aria-label="Anchor Text"]').element.value).toBe("Pasted notes");
  });
});
