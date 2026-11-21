import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ColorChoices from "../src/components/mail-labels/color-choices.vue";
import {
  customColors,
  customPalette,
  presetColors,
  presetText,
} from "../src/components/mail-labels/colors";

describe("label colors", () => {
  it("offers unique custom colors and includes the starting text and background for every preset", () => {
    expect(new Set(customColors).size).toBe(customColors.length);
    expect(customColors).toHaveLength(64);
    expect(customPalette(null)).toBe(customColors);
    presetColors.forEach((background, index) => {
      expect(customPalette(background)).toContain(background);
      expect(customPalette(presetText(index))).toContain(presetText(index));
    });
  });

  it("selects the matching color pair when a custom pair shares a preset background", async () => {
    const custom = { background: "#c2185b", foreground: "#202124" };
    const wrapper = mount(ColorChoices, {
      props: { label: custom, recent: [custom] },
    });
    const preset = wrapper.get('button[aria-label="Label color #c2185b"]');
    const recent = wrapper.get('button[aria-label^="Custom label color"]');
    expect(preset.attributes("aria-pressed")).toBe("false");
    expect(recent.attributes("aria-pressed")).toBe("true");
    await preset.trigger("click");
    expect(wrapper.emitted("choose")).toEqual([["#c2185b", "#ffffff"]]);
    await recent.trigger("click");
    expect(wrapper.emitted("choose").at(-1)).toEqual(["#c2185b", "#202124", true]);
    await wrapper.setProps({
      label: { background: "#c2185b", foreground: "#ffffff" },
    });
    expect(preset.attributes("aria-pressed")).toBe("true");
    expect(recent.attributes("aria-pressed")).toBe("false");
    wrapper.unmount();
  });
});
