import {diffChars, diffWordsWithSpace} from "diff";

// Keep the existing inline elements, including styles on text between separate edits.
export function renameLink(link, label) {
  const original = link.textContent;
  if (original === label) return;
  const walker = link.ownerDocument.createTreeWalker(link, NodeFilter.SHOW_TEXT);
  const runs = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.length) runs.push(node);
  }
  if (!runs.length || (!link.querySelector("img") && link.querySelector("br,[contenteditable=false]"))) {
    link.textContent = label;
    return;
  }
  rewriteTextRuns(runs, original, label);
}

export function rewriteTextRuns(runs, original, label) {
  if (runs.length === 1) {
    runs[0].data = label;
    return;
  }

  const options = {timeout: 35, maxEditLength: 1024};
  const deadline = Date.now() + options.timeout;
  const changes = diffWordsWithSpace(original, label, options);
  if (!changes) {
    // Bound work on very large pasted replacements and retain each run's formatting.
    let offset = 0;
    runs.forEach((node, i) => {
      const end = i === runs.length - 1 ? label.length : offset + node.length;
      node.data = label.slice(offset, end);
      offset = end;
    });
    return;
  }
  // Refine word edits so formatting inside a partially changed word also survives.
  const pieces = [];
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i], next = changes[i + 1];
    if (change.removed && next?.added && !/\s/.test(change.value + next.value)) {
      const timeout = deadline - Date.now();
      const letters = timeout > 0 && diffChars(change.value, next.value, {...options, timeout});
      pieces.push(...(letters || [change, next]));
      i++;
    } else pieces.push(change);
  }
  const output = runs.map(() => "");
  let index = 0, offset = 0, firstRemoved = null;
  for (const change of pieces) {
    if (change.added) {
      const target = firstRemoved ?? (offset ? index : Math.max(0, index - 1));
      output[target] += change.value;
      firstRemoved = null;
      continue;
    }
    firstRemoved = change.removed ? index : null;
    let remaining = change.value.length;
    while (remaining > 0) {
      const text = runs[index].data;
      const take = Math.min(remaining, text.length - offset);
      if (!change.removed) output[index] += text.slice(offset, offset + take);
      remaining -= take;
      offset += take;
      if (offset === text.length) {
        index++;
        offset = 0;
      }
    }
  }
  runs.forEach((node, i) => { node.data = output[i]; });
}
