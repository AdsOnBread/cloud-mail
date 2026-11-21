import { describe, it, expect, vi } from "vitest";
import {
  colorRows,
  fonts,
  formattingShortcut,
} from "../src/components/tiny-editor/format-options";

function editor(font = "arial,sans-serif", size = "13px") {
  return {
    queryCommandValue: vi.fn((command) =>
      command === "FontName" ? font : size,
    ),
    execCommand: vi.fn(),
    nodeChanged: vi.fn(),
  };
}
function press(ed, code, keys) {
  const event = {
    code,
    ctrlKey: true,
    shiftKey: true,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...keys,
  };
  formattingShortcut(ed, event);
  return event;
}
describe("compose formatting", () => {
  it("keeps font order and all eight rows of the reference color palette", () => {
    expect(fonts.map(([name]) => name)).toEqual([
      "Sans Serif",
      "Serif",
      "Fixed Width",
      "Wide",
      "Narrow",
      "Comic Sans MS",
      "Garamond",
      "Georgia",
      "Tahoma",
      "Trebuchet MS",
      "Verdana",
    ]);
    expect(colorRows.map((row) => row.length)).toEqual(Array(8).fill(8));
    expect(new Set(colorRows.flat()).size).toBe(64);
  });
  it("cycles font choices and bounds text size on Mac and Control keyboards", () => {
    const ed = editor("verdana,sans-serif", "32px");
    press(ed, "Digit6", { metaKey: true, ctrlKey: false });
    expect(ed.execCommand).toHaveBeenLastCalledWith(
      "FontName",
      false,
      fonts[0][1],
    );
    press(ed, "Equal");
    expect(ed.execCommand).toHaveBeenLastCalledWith("FontSize", false, "32px");
    press(ed, "Minus");
    expect(ed.execCommand).toHaveBeenLastCalledWith("FontSize", false, "18px");
    press(ed, "KeyR");
    expect(ed.execCommand).toHaveBeenLastCalledWith(
      "JustifyRight",
      false,
      undefined,
    );
  });
  it("leaves regular typing, composition and alternate keyboard input alone", () => {
    const ed = editor();
    for (const keys of [
      { ctrlKey: false },
      { altKey: true },
      { isComposing: true },
    ])
      expect(press(ed, "Digit8", keys).preventDefault).not.toHaveBeenCalled();
    expect(ed.execCommand).not.toHaveBeenCalled();
  });
});
