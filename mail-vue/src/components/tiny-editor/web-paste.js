import { selectedWebUrl } from "./link-text";

// Native paste preserves the surrounding inline styles. On Chromium, the input event
// also distinguishes the context menu's Paste and Match Style from a regular paste.
export function observeWebPaste(ed) {
  const doc = ed.getDoc();
  let shortcut, pending;
  function key(event) {
    shortcut = event.type === "keydown" && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v"
      ? (event.shiftKey ? "plain" : "rich") : undefined;
  }
  function finish(event) {
    const paste = pending;
    pending = undefined;
    if (!paste || event.inputType !== "insertFromPaste" || paste.shortcut === "plain" ||
        (paste.shortcut !== "rich" && !event.dataTransfer)) return;
    const caret = ed.selection.getRng().cloneRange();
    const textRange = pastedRange(ed.getBody(), paste.offset, paste.text);
    if (!textRange) return;
    ed.selection.setRng(textRange);
    if (!doc.execCommand("createLink", false, paste.href)) {
      ed.selection.setRng(caret);
      return;
    }
    const link = ed.dom.getParent(ed.selection.getEnd(), "a[href]");
    if (link) {
      const after = doc.createRange();
      after.setStartAfter(link);
      after.collapse(true);
      ed.selection.setRng(after);
    } else ed.selection.collapse(false);
    ed.nodeChanged();
    ed.undoManager.add();
    ed.dispatch("change");
  }
  ed.on("keydown keyup blur", key, true);
  doc.addEventListener("input", finish, true);
  ed.on("remove", () => doc.removeEventListener("input", finish, true));
  return event => {
    pending = undefined;
    const types = Array.from(event.clipboardData?.types || []);
    if (types.length !== 1 || types[0] !== "text/plain") return;
    const text = event.clipboardData?.getData("text/plain");
    const href = selectedWebUrl(text);
    if (!href) return;
    ed.undoManager.add();
    const selection = ed.selection.getRng();
    const prefix = doc.createRange();
    prefix.selectNodeContents(ed.getBody());
    prefix.setEnd(selection.startContainer, selection.startOffset);
    const paste = {text, href, shortcut, offset:prefix.toString().length};
    pending = paste;
    setTimeout(() => { if (pending === paste) pending = undefined; }, 0);
    event.stopImmediatePropagation();
  };
}

// Chromium may position the caret after the rest of an existing link on paste.
function pastedRange(body, offset, text) {
  const doc = body.ownerDocument, range = doc.createRange();
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const end = offset + text.length;
  let position = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = position + node.length;
    if (position <= offset && offset < next) range.setStart(node, offset - position);
    if (end <= next) {
      range.setEnd(node, end - position);
      return range.toString() === text ? range : null;
    }
    position = next;
  }
  return null;
}
