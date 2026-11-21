import { afterEach, expect, it, vi } from "vitest";
import { observeWebPaste } from "../src/components/tiny-editor/web-paste";

afterEach(() => vi.restoreAllMocks());

function pasteFixture() {
  const body = document.createElement("div");
  body.innerHTML = "<b>Before</b> word after";
  const cursor = document.createRange();
  cursor.setStart(body.lastChild, 1);
  cursor.setEnd(body.lastChild, 5);
  const handlers = {};
  const selection = {getRng:() => cursor, setRng:vi.fn(), collapse:vi.fn(), getEnd:() => body};
  const editor = {
    getDoc:() => document, getBody:() => body, selection, dom:{getParent:() => null},
    on:(events, handler) => events.split(" ").forEach(name => { handlers[name] = handler; }),
    nodeChanged:vi.fn(), dispatch:vi.fn(), undoManager:{add:vi.fn()},
  };
  const paste = observeWebPaste(editor);
  const createLink = vi.fn(() => true);
  const original = Object.getOwnPropertyDescriptor(document, "execCommand");
  Object.defineProperty(document, "execCommand", {configurable:true, value:createLink});
  const text = "https://example.org/?to=person@example.org";
  return {
    createLink, selection, text, editor,
    begin(types = ["text/plain"]) {
      const event = {clipboardData:{types, getData:type => type === "text/plain" ? text : ""}, stopImmediatePropagation:vi.fn()};
      paste(event);
      return event;
    },
    finish(dataTransfer) {
      const split = 15;
      body.lastChild.replaceWith(document.createTextNode(" " + text.slice(0, split)),
        document.createTextNode(text.slice(split) + " after"));
      const input = new InputEvent("input", {inputType:"insertFromPaste"});
      Object.defineProperty(input, "dataTransfer", {value:dataTransfer});
      document.dispatchEvent(input);
    },
    close() {
      handlers.remove();
      if (original) Object.defineProperty(document, "execCommand", original);
      else delete document.execCommand;
    },
  };
}

it("links exactly the pasted address even across text nodes", () => {
  const field = pasteFixture();
  try {
    expect(field.begin().stopImmediatePropagation).toHaveBeenCalledOnce();
    field.finish({});
    expect(field.selection.setRng.mock.calls[0][0].toString()).toBe(field.text);
    expect(field.createLink).toHaveBeenCalledWith("createLink", false, field.text);
  } finally { field.close(); }
});

it("preserves the native match-style command and leaves rich clipboard formats to the editor", () => {
  const field = pasteFixture();
  try {
    expect(field.begin(["text/html", "text/plain"]).stopImmediatePropagation).not.toHaveBeenCalled();
    field.begin();
    field.finish(null);
    expect(field.createLink).not.toHaveBeenCalled();
  } finally { field.close(); }
});
