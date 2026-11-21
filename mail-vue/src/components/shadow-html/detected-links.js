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
      const at = match.raw.lastIndexOf('@');
      // Encode URI delimiters in the local part, retaining common plus tags.
      href = 'mailto:' + encodeURIComponent(match.raw.slice(0, at)).replace(/%2B/gi, '+') + match.raw.slice(at);
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

function linkTextRun(doc, nodes) {
  const links = linksIn(nodes.map(node => node.data).join(''));
  // Work backwards so offsets for earlier matches still refer to the original nodes.
  let index = nodes.length - 1;
  let endOffset = nodes.reduce((length, node) => length + node.length, 0);
  function locate(offset, isStart) {
    while (index > 0) {
      const base = endOffset - nodes[index].length;
      if (offset > base || (isStart && offset === base)) break;
      endOffset = base;
      index--;
    }
    return [nodes[index], offset - endOffset + nodes[index].length];
  }
  for (const link of links.reverse()) {
    const end = locate(link.end, false);
    const start = locate(link.start, true);
    const range = doc.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    // extractContents can shorten the current node; retain its original base for the next match.
    const base = endOffset - nodes[index].length;
    const anchor = doc.createElement('a');
    anchor.href = link.href;
    anchor.append(range.extractContents());
    range.insertNode(anchor);
    endOffset = base + nodes[index].length;
  }
}

const literal = 'a,pre,code,script,style,textarea,title,template,noscript,svg,math,iframe,object,form';
const inline = 'b,strong,i,em,u,s,strike,small,big,span,font,sub,sup,mark';
export function detectDocumentLinks(doc) {
  const stylesheet = Boolean(doc.querySelector('style,link[rel~=stylesheet]'));
  const stack = [...doc.body.childNodes].reverse();
  let run = [];
  function flush() {
    if (run.length) linkTextRun(doc, run);
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
    if (node.localName === 'wbr' && !stylesheet && !node.hasAttribute('style')) continue;
    // Detached documents do not resolve sender stylesheets. Keep their element
    // boundaries so hidden or block content cannot silently change a destination.
    const display = node.style?.display;
    if (stylesheet || !node.matches(inline) || node.id || (display && !['inline', 'contents'].includes(display))) {
      flush();
      stack.push(null);
    }
    for (let child = node.lastChild; child; child = child.previousSibling) stack.push(child);
  }
  flush();
}
