import {fonts,sizes} from "../../../../shared/mail-text-style";
export {fonts,sizes,colorRows} from "../../../../shared/mail-text-style";

export function currentFont(ed) {
  const first = String(ed.queryCommandValue("FontName") || "")
    .split(",")[0]
    .replace(/["']/g, "")
    .trim()
    .toLowerCase();
  return (
    fonts.find(([, family]) => family.split(",")[0] === first)?.[0] ||
    "Sans Serif"
  );
}
export function currentSize(ed) {
  const value = ed.queryCommandValue("FontSize");
  const pixels =
    typeof value === "string" && value.endsWith("px")
      ? parseFloat(value)
      : parseFloat(
          ed.dom.getStyle(ed.selection.getStart(true), "font-size", true),
        );
  if (!Number.isFinite(pixels)) return 1;
  return sizes.reduce(
    (best, [, size], i) =>
      Math.abs(parseInt(size) - pixels) <
      Math.abs(parseInt(sizes[best][1]) - pixels)
        ? i
        : best,
    1,
  );
}

const shifted = {
  KeyL: "JustifyLeft",
  KeyE: "JustifyCenter",
  KeyR: "JustifyRight",
  Digit7: "InsertOrderedList",
  Digit8: "InsertUnorderedList",
  Digit9: "mceBlockQuote",
  KeyX: "Strikethrough",
};
const unshifted = {
  BracketLeft: "Outdent",
  BracketRight: "Indent",
  Backslash: "RemoveFormat",
};

// Attach to the editor so shortcuts also work while its formatting bar is hidden.
export function formattingShortcut(ed, event, requestFormat) {
  if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey))
    return;
  let command = (event.shiftKey ? shifted : unshifted)[event.code],
    value;
  if (event.shiftKey && ["Digit5", "Digit6"].includes(event.code)) {
    const step = event.code === "Digit5" ? -1 : 1;
    const index = fonts.findIndex(([name]) => name === currentFont(ed));
    command = "FontName";
    value = fonts[(index + step + fonts.length) % fonts.length][1];
  } else if (event.shiftKey && ["Minus", "Equal"].includes(event.code)) {
    const step = event.code === "Minus" ? -1 : 1;
    command = "FontSize";
    value =
      sizes[Math.max(0, Math.min(sizes.length - 1, currentSize(ed) + step))][1];
  }
  if (!command) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (requestFormat) return requestFormat(command, value);
  ed.execCommand(command, false, value);
  ed.nodeChanged();
}
