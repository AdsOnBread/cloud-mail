import {rewriteTextRuns} from "../link-text";

const boundary = 'address,article,blockquote,br,div,h1,h2,h3,h4,h5,h6,li,p,pre,td,th';
const skip = 'a[href],code,pre,script,style,[contenteditable=false],[data-mce-bogus],.cloudmail-reply-quote';
const tokens = /(?:https?:\/\/|www\.)[^\s<>]+|[\p{L}\d._%+-]+@[\p{L}\d.\-]+\.[\p{L}]{2,}|[\p{L}\p{M}\d]+(?:['’\u200c][\p{L}\p{M}\d]+)*/giu;

// Join inline runs before tokenizing so a style change within a word does not
// turn it into two apparent misspellings. Each range still points into the editor.
export function collectWords(body) {
  const results = [];
  let parts = [];
  function flush() {
    if (!parts.length) return;
    const text = parts.map(node => node.data).join('');
    let first = 0, offset = 0;
    for (const {0:word, index} of text.matchAll(tokens)) {
      if (word.length > 80 || /[@.\d/]/.test(word)) continue;
      while (offset + parts[first].length <= index) offset += parts[first++].length;
      let last = first, end = index + word.length - offset;
      while (end > parts[last].length) end -= parts[last++].length;
      const range = body.ownerDocument.createRange();
      range.setStart(parts[first], index - offset);
      range.setEnd(parts[last], end);
      results.push({range, word});
    }
    parts = [];
  }
  function visit(node) {
    if (node.nodeType === 3) {
      if (node.length) parts.push(node);
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.matches(skip)) { flush(); return; }
    const block = node.matches(boundary);
    if (block) flush();
    for (const child of node.childNodes) visit(child);
    if (block) flush();
  }
  visit(body);
  flush();
  return results;
}

export function liveWords(body, issues) {
  const byStart = new Map();
  for (const item of collectWords(body)) {
    const {startContainer, startOffset} = item.range;
    if (!byStart.has(startContainer)) byStart.set(startContainer, new Map());
    byStart.get(startContainer).set(startOffset, item);
  }
  return issues.filter(({range, word}) => {
    const live = byStart.get(range.startContainer)?.get(range.startOffset);
    return live?.word === word && live.range.endContainer === range.endContainer && live.range.endOffset === range.endOffset;
  });
}

// Change only characters inside the checked token. Preserve surrounding text
// and the existing style runs, including runs that begin midway through a word.
export function replaceWord(range, value) {
  const {startContainer:first, endContainer:last, startOffset:start, endOffset:end} = range;
  const original = range.toString();
  const caret = first.ownerDocument.createRange();
  if (first === last) {
    first.replaceData(start, end - start, value);
    caret.setStart(first, start + value.length);
  } else {
    const walker = first.ownerDocument.createTreeWalker(range.commonAncestorContainer, 4);
    walker.currentNode = first;
    const runs = [first];
    while (walker.currentNode !== last && walker.nextNode()) {
      if (walker.currentNode.length) runs.push(walker.currentNode);
    }
    if (end < last.length) last.splitText(end);
    if (start) runs[0] = first.splitText(start);
    rewriteTextRuns(runs, original, value);
    caret.setStart(last, last.length);
  }
  caret.collapse(true);
  return caret;
}
