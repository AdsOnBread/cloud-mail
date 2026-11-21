import { it, expect } from "vitest";
import { renameLink } from "../src/components/tiny-editor/link-text";

it.each([
  ["Read <b>these</b> <i>notes</i>", "Read those notes", "Read <b>those</b> <i>notes</i>"],
  ["<b>First</b> <i>Second</i>", "First third", "<b>First</b> <i>third</i>"],
  ["<strong>Notes</strong>", "Notes from <May>", "<strong>Notes from &lt;May&gt;</strong>"],
  ["<b>Some</b> <i>notes</i>", "Review", "<b>Review</b><i></i>"],
  ["<b>First</b> <i>middle</i> <u>last</u>", "first middle LAST", "<b>first</b> <i>middle</i> <u>LAST</u>"],
  ["<i>be</i><b>gin</b>", "began", "<i>be</i><b>gan</b>"],
  ['<img alt="Map">', "Map", "Map"],
])("retains formatted text when renaming %s", (html, label, expected) => {
  const link = document.createElement("a");
  link.innerHTML = html;
  renameLink(link, label);
  expect(link.innerHTML).toBe(expected);
});
