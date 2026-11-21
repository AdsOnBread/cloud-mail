import LinkifyIt from 'linkify-it';
import { h } from 'vue';

const detector = new LinkifyIt();
const linkProps = { target: '_blank', rel: 'noopener noreferrer' };

function linkParts(text) {
  const matches = detector.match(text);
  if (!matches) return [text];
  const parts = [];
  let offset = 0;
  for (const match of matches) {
    if (!/^(?:https?:\/\/|mailto:)/i.test(match.url)) continue;
    if (match.index > offset) parts.push(text.slice(offset, match.index));
    parts.push({ href: match.url, text: match.raw });
    offset = match.lastIndex;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return parts;
}

export function MessageText({ text }) {
  return linkParts(text).map(part => typeof part === 'string' ? part :
    h('a', { ...linkProps, href: part.href }, part.text));
}
MessageText.props = ['text'];

export function detectDocumentLinks(doc) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      if (node.matches('a,pre,code,script,style,textarea,title,template,noscript,svg,math,iframe,object,form')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  const textNodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node);
  for (const node of textNodes) {
    const parts = linkParts(node.data);
    if (parts.length === 1 && typeof parts[0] === 'string') continue;
    const fragment = doc.createDocumentFragment();
    for (const part of parts) {
      if (typeof part === 'string') fragment.append(part);
      else {
        const anchor = doc.createElement('a');
        anchor.href = part.href;
        anchor.textContent = part.text;
        fragment.append(anchor);
      }
    }
    node.replaceWith(fragment);
  }
}
