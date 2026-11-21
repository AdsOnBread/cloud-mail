import {mailboxHref} from '@/utils/mailto';
import { LinkifyIt } from 'linkify-it';
import tlds from 'tlds';
import { h } from 'vue';

const detector = new LinkifyIt({ fuzzyLink: true, tlds });
const addressRules = new LinkifyIt();
const query = /\?(?=[\w%-]+=)[^\s<>"\u0000-\u001f。，、；！？「」『』《》【】“”‘’]*/uy;
function queryLength(fields) {
  // Unencoded sentence punctuation can follow a URI. Keep paired delimiters
  // inside a value, such as ?body=Meet%20(Friday).
  const openers = { ')': '(', ']': '[', '}': '{' };
  const balance = { '(': 0, '[': 0, '{': 0 };
  for (const char of fields) {
    if (char in balance) balance[char]++;
    else if (char in openers) balance[openers[char]]--;
  }
  let end = fields.length;
  while (end > 0) {
    const last = fields[end - 1];
    if (/[.,!?:;]/.test(last)) end--;
    else if (last in openers && balance[openers[last]] < 0) {
      balance[openers[last]]++;
      end--;
    } else break;
  }
  return end;
}
detector.add('mailto:', {
  validate(text, start) {
    let end = start;
    for (;;) {
      const length = addressRules.testSchemaAt(text, 'mailto:', end);
      if (!length) break;
      end += length;
      if (text[end] !== ',' || !addressRules.testSchemaAt(text, 'mailto:', end + 1)) break;
      end++;
    }
    query.lastIndex = end;
    const fields = query.exec(text)?.[0];
    if (fields) end += queryLength(fields);
    return end - start;
  },
});

const linkProps = { target: '_blank', rel: 'noopener noreferrer' };

function linksIn(text) {
  const links = [];
  for (const match of detector.match(text) || []) {
    let href = match.url;
    if (!match.schema) href = 'https://' + match.raw;
    if (match.schema === 'mailto:' && !/^mailto:/i.test(match.raw)) {
      href = mailboxHref(match.raw);
    }
    if (/^(?:https?:\/\/|mailto:)/i.test(href)) links.push({ start: match.index, end: match.lastIndex, href });
  }
  return links;
}

export function MessageText({ text }) {
  const children = [];
  let offset = 0;
  for (const link of linksIn(text)) {
    children.push(text.slice(offset, link.start), h('a', { ...linkProps, href: link.href }, text.slice(link.start, link.end)));
    offset = link.end;
  }
  children.push(text.slice(offset));
  return children;
}
MessageText.props = ['text'];

function wouldSplitId(node, ancestor) {
  for (let parent = node.parentNode; parent && parent !== ancestor; parent = parent.parentNode) {
    if (parent.id) return true;
  }
  return false;
}

function linkTextRun(doc, nodes, stylesheet) {
  const links = linksIn(nodes.map(node => node.data).join(''));
  if (!links.length) return;
  let index = 0, base = 0;
  function locate(offset, isStart) {
    while (index < nodes.length - 1) {
      const next = base + nodes[index].length;
      if (offset < next || (!isStart && offset === next)) break;
      base = next;
      index++;
    }
    return { node: nodes[index], offset: offset - base };
  }
  const spans = links.map(link => ({
    href: link.href, start: locate(link.start, true), end: locate(link.end, false),
  }));
  let range;
  // Work backwards so earlier offsets survive later replacements. Batch all
  // links in a single text node into one write, even in a long newsletter.
  for (let i = spans.length - 1; i >= 0; i--) {
    const { start, end, href } = spans[i];
    if (start.node !== end.node) {
      // Sender stylesheets can hide pieces of a visually contiguous address.
      // Leave this entire ambiguous match as text.
      if (stylesheet) continue;
      range ??= doc.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const ancestor = range.commonAncestorContainer;
      if (wouldSplitId(start.node, ancestor) || wouldSplitId(end.node, ancestor)) continue;
      const anchor = doc.createElement('a');
      anchor.href = href;
      anchor.append(range.extractContents());
      range.insertNode(anchor);
      continue;
    }
    const node = start.node;
    const last = i;
    while (i > 0 && spans[i - 1].start.node === node && spans[i - 1].end.node === node) i--;
    const firstOffset = spans[i].start.offset;
    const original = node.data;
    const fragment = doc.createDocumentFragment();
    let offset = firstOffset;
    for (let j = i; j <= last; j++) {
      const span = spans[j];
      if (offset < span.start.offset) fragment.append(original.slice(offset, span.start.offset));
      const anchor = doc.createElement('a');
      anchor.href = span.href;
      anchor.textContent = original.slice(span.start.offset, span.end.offset);
      fragment.append(anchor);
      offset = span.end.offset;
    }
    if (offset < original.length) fragment.append(original.slice(offset));
    node.deleteData(firstOffset, original.length - firstOffset);
    node.after(fragment);
  }
}

const literal = 'a,pre,code,script,style,textarea,title,template,noscript,svg,math,iframe,object,form';
const inline = 'b,strong,i,em,u,s,strike,small,big,span,font,sub,sup,mark';
export function detectDocumentLinks(doc) {
  const stylesheet = Boolean(doc.querySelector('style,link[rel~=stylesheet]'));
  const stack = [...doc.body.childNodes].reverse();
  let run = [];
  function flush() {
    if (run.length) linkTextRun(doc, run, stylesheet);
    run = [];
  }
  while (stack.length) {
    const node = stack.pop();
    if (!node) { flush(); continue; }
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.length) run.push(node);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    if (node.matches(literal) || node.hidden || node.style?.display === 'none' ||
        ['hidden', 'collapse'].includes(node.style?.visibility)) { flush(); continue; }
    if (node.localName === 'wbr' && !node.hasAttribute('style')) continue;
    const display = node.style?.display;
    if (!node.matches(inline) || (display && !['inline', 'contents'].includes(display))) {
      flush();
      stack.push(null);
    }
    for (let child = node.lastChild; child; child = child.previousSibling) stack.push(child);
  }
  flush();
}
