import { describe, expect, it } from "vitest";
import { dockLayout } from "../src/layout/write/dock";

const draft = (key, options = {}) => ({ key, used:key, minimized:false, expanded:false, ...options });

describe("compose dock", () => {
  it("keeps two editors side by side and promotes a selected overflowed editor", () => {
    const drafts = [draft(1), draft(2), draft(3)];
    const before = dockLayout(drafts, 1440, 3);
    expect([...before.positions.keys()]).toEqual([2,3]);
    expect(before.positions.get(3).right).toBeGreaterThan(before.positions.get(2).width);
    const after = dockLayout(drafts, 1440, 1);
    expect([...after.positions.keys()]).toEqual([1,3]);
    expect(after.right + 40).toBeLessThan(1440);
  });

  it("leaves space for the switcher on a phone and isolates an expanded draft", () => {
    const drafts = [draft(1,{minimized:true}), draft(2,{minimized:true})];
    const phone = dockLayout(drafts, 320, 1);
    expect([...phone.positions.keys()]).toEqual([1]);
    expect(phone.right + 40).toBeLessThanOrEqual(320);
    const full = dockLayout([draft(1),draft(2,{expanded:true})], 1440, 2);
    expect([...full.positions.keys()]).toEqual([2]);
    expect(full.exclusive).toBe(true);
  });
});
