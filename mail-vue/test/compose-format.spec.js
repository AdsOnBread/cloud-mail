import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import FormatToolbar from "../src/components/tiny-editor/compose-format.vue";
import FormatPicker from "../src/components/tiny-editor/format-picker.vue";
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

it("updates toggle and overflow states when the selection changes within the same editor node",async()=>{
  let command="Bold";
  const events=new Map();
  const ed={
    ...editor(), initialized:true,
    queryCommandState:key=>key===command,
    undoManager:{hasUndo:()=>false,hasRedo:()=>false},
    on:(names,fn)=>names.split(" ").forEach(name=>events.set(name,fn)),
    off:(names,fn)=>names.split(" ").forEach(name=>{if(events.get(name)===fn)events.delete(name);}),
  };
  const wrapper=mount(FormatToolbar,{props:{editor:ed},global:{stubs:{Icon:true,FormatPicker:true,FormatPopup:true}}});
  try {
    expect(wrapper.get('button[aria-label=Bold]').attributes("aria-pressed")).toBe("true");
    command="Strikethrough";
    events.get("SelectionChange")();
    await nextTick();
    expect(wrapper.get('button[aria-label=Bold]').attributes("aria-pressed")).toBe("false");
    const more=wrapper.findAllComponents(FormatPicker).find(p=>p.props("label")==="More formatting options");
    const choices=more.props("choices");
    expect(choices.slice(0,5).map(c=>c.name)).toEqual(["Remove formatting","Strikethrough","Quote","Indent more","Indent less"]);
    expect(choices.find(c=>c.value==="Strikethrough").checked).toBe(true);
    expect(choices.find(c=>c.value==="mceBlockQuote").checked).toBe(false);
    expect(choices.find(c=>c.value==="RemoveFormat").checked).toBeUndefined();
  } finally { wrapper.unmount(); }
  expect(events.has("SelectionChange")).toBe(false);
});
