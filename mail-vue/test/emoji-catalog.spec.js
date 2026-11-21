import { afterEach, expect, it, vi } from "vitest";
import { loadEmoji, searchEmoji } from "../src/components/message-composer/emoji-catalog";

afterEach(() => vi.unstubAllGlobals());

it("retries a failed download, then searches complete emoji and their skin tones", async () => {
  const hand = { unicode: "👍️", label: "thumbs up", tags: ["good", "hand"], order: 4, group: 1,
    skins: [{ unicode: "👍🏽", label: "thumbs up: medium skin tone" }] };
  const face = { unicode: "😀", label: "grinning face", tags: ["happy"], order: 1, group: 0 };
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, json: async () => [hand, { group: 2, order: 2 }, {}, face] });
  vi.stubGlobal("fetch", fetch);
  await expect(loadEmoji()).rejects.toThrow();
  const [items, cached] = await Promise.all([loadEmoji(), loadEmoji()]);
  expect(cached).toBe(items);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(items.map(item => item.unicode)).toEqual(["😀", "👍️"]);
  expect(searchEmoji(items, "HaPpY face")).toEqual([items[0]]);
  expect(searchEmoji(items, "👍")).toEqual([items[1]]);
  expect(searchEmoji(items, "good hand")).toEqual([items[1]]);
  expect(searchEmoji(items, "thumbs medium tone")).toEqual(hand.skins);
  expect(searchEmoji(items, "👍🏽")).toEqual(hand.skins);
  expect(searchEmoji(items, "nothing matches")).toEqual([]);
});
