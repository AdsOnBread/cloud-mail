// Preserve formatting on the unchanged parts of a link when its label is edited.
export function renameLink(link, label) {
  const original = link.textContent;
  if (original === label) return;
  if (!original || link.querySelector("img,br,[contenteditable=false]")) {
    link.textContent = label;
    return;
  }

  let start = 0;
  while (start < original.length && original[start] === label[start]) start++;
  let end = original.length;
  let newEnd = label.length;
  while (end > start && newEnd > start && original[end - 1] === label[newEnd - 1]) {
    end--;
    newEnd--;
  }

  const walker = link.ownerDocument.createTreeWalker(link, NodeFilter.SHOW_TEXT);
  const replacement = label.slice(start, newEnd);
  let offset = 0, inserted = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.data;
    const next = offset + text.length;
    if (text.length && next >= start && offset <= end) {
      const prefix = text.slice(0, Math.max(0, start - offset));
      const suffix = text.slice(Math.max(0, end - offset));
      // At a formatting boundary, replacement inherits the first replaced character.
      const insertHere = !inserted && (next > start || start === end);
      node.data = prefix + (insertHere ? replacement : "") + suffix;
      if (insertHere) inserted = true;
    }
    offset = next;
  }
}
