import { it, expect } from "vitest";
import { editableLinkUrl, normalizeLinkUrl, selectedWebUrl, shortenLinkDestination, renameLink } from "../src/components/tiny-editor/link-text";

it.each([
  ["Read <b>these</b> <i>notes</i>", "Read those notes", "Read <b>those</b> <i>notes</i>"],
  ["<b>First</b> <i>Second</i>", "First third", "<b>First</b> <i>third</i>"],
  ["<strong>Notes</strong>", "Notes from <May>", "<strong>Notes from &lt;May&gt;</strong>"],
  ["<b>Some</b> <i>notes</i>", "Review", "<b>Review</b><i></i>"],
  ["<b>First</b> <i>middle</i> <u>last</u>", "first middle LAST", "<b>first</b> <i>middle</i> <u>LAST</u>"],
  ["<i>be</i><b>gin</b>", "began", "<i>be</i><b>gan</b>"],
  ['<img alt="Map"><b>Old caption</b>', "New caption", '<img alt="Map"><b>New caption</b>'],
  ['<i>First</i> <img alt="Map"> <b>last</b>', "First  word", '<i>First</i> <img alt="Map"> <b>word</b>'],
  ['<img alt="Map">', "Map", "Map"],
])("retains formatted text when renaming %s", (html, label, expected) => {
  const link = document.createElement("a");
  link.innerHTML = html;
  renameLink(link, label);
  expect(link.innerHTML).toBe(expected);
});


it("only links an entire explicit web address immediately", () => {
  expect(selectedWebUrl("https://example.org")).toBe("https://example.org/");
  expect(selectedWebUrl("https://example.org/?contact=person@example.org")).toBe("https://example.org/?contact=person@example.org");
  expect(normalizeLinkUrl("mailto:person@example.org")).toBe("mailto:person@example.org");
  expect(selectedWebUrl("http://example.org/a?x=1&y=2")).toBe("http://example.org/a?x=1&y=2");
  for (const text of [undefined, "", "example.org", "person@example.org", "mailto:person@example.org",
    "read https://example.org", "https://example.org/a b", "https://example.org\n",
    "https://example.org/\u0000", "https://", "javascript:alert(1)"]) {
    expect(selectedWebUrl(text)).toBe("");
  }
  expect(normalizeLinkUrl("example.org")).toBe("https://example.org/");
  expect(normalizeLinkUrl("jane.doe?tag@example.net")).toBe("mailto:jane.doe%3Ftag@example.net");
  expect(normalizeLinkUrl("first.last/reports@example.net")).toBe("mailto:first.last%2Freports@example.net");
  expect(normalizeLinkUrl("first.last#reports@example.net")).toBe("mailto:first.last%23reports@example.net");
  expect(normalizeLinkUrl("billing.2026?copy@example.org")).toBe("mailto:billing.2026%3Fcopy@example.org");
  const internationalWebsite = "例子.中国/share?to=maya@example.org";
  expect(normalizeLinkUrl(internationalWebsite)).toBe(new URL("https://" + internationalWebsite).href);
  expect(normalizeLinkUrl("orders/returns@example.org")).toBe("mailto:orders%2Freturns@example.org");
  expect(normalizeLinkUrl("orders?tag+new@example.org")).toBe("mailto:orders%3Ftag+new@example.org");
  expect(normalizeLinkUrl("mailto:orders@example.org?subject=Returns")).toBe("mailto:orders@example.org?subject=Returns");
  expect(normalizeLinkUrl("docs.example.org/share?person=maya@example.net")).toBe("https://docs.example.org/share?person=maya@example.net");
  expect(normalizeLinkUrl("person@example.org")).toBe("mailto:person@example.org");
});

it("accepts display-form international domains and encodes spaces in web paths", () => {
  expect(normalizeLinkUrl("例え.jp/秋 の便り")).toBe(new URL("https://例え.jp/秋 の便り").href);
  expect(normalizeLinkUrl("Docs.Example.org:8443/Fall notes")).toBe("https://docs.example.org:8443/Fall%20notes");
  for (const text of ["two hosts.example.org", "a.example.org:invalid", "javascript:run()", "file:///home/note"]) {
    expect(normalizeLinkUrl(text)).toBe("");
  }
});

it("edits a simple mailbox without a scheme and preserves compound email destinations", () => {
  expect(editableLinkUrl("mailto:notes@example.org")).toBe("notes@example.org");
  for (const href of ["mailto:orders%3Ftag@example.org", "mailto:a@example.org?subject=Hi%20there", "https://example.org/"]) {
    expect(editableLinkUrl(href)).toBe(href);
  }
});

it("shows both ends of long destinations without splitting a Unicode code point", () => {
  const head = "a".repeat(23) + "🐢", tail = "b".repeat(24);
  expect(shortenLinkDestination(head + tail)).toBe(head + tail);
  expect(shortenLinkDestination(head + "x" + tail)).toBe(head + "..." + tail);
});
