import {h} from 'vue';

// Reconstruct a small set of ordinary text elements. Anything else keeps the
// rich reader's isolated frame, including arbitrary classes, styles and URLs.
const tags=new Set('div p br b strong i em s strike u span a blockquote'.split(' '));
const wrappers=new Set(['gmail_quote','gmail_quote_container','gmail_attr','moz-cite-prefix','cloudmail-reply-quote']);
const quoteStyles=new Set(['margin','margin-top','margin-right','margin-bottom','margin-left','border-left','padding-left']);
function flowNode(node,depth) {
  if (node.nodeType===3) return node.data;
  if (node.nodeType===8) return '';
  if (!tags.has(node.localName) || depth>40) return null;
  const props={};
  for (const attr of node.attributes) {
    if (attr.name==='class' && [...node.classList].every(c=>wrappers.has(c))) continue;
    if (attr.name==='type' && node.localName==='blockquote' && attr.value==='cite') continue;
    if (attr.name==='dir' && /^(ltr|rtl|auto)$/i.test(attr.value)) {props.dir=attr.value;continue;}
    if (node.localName==='a') {
      if (attr.name==='href' && /^(?:https?:\/\/|mailto:)/i.test(attr.value)) {
        props.href=attr.value;props.target='_blank';props.rel='noopener noreferrer';continue;
      }
      if (['target','rel'].includes(attr.name)) continue;
    }
    if (attr.name==='style' && node.localName==='blockquote' && [...node.style].every(key=>quoteStyles.has(key))) {
      // CSSOM accepts many values, including URLs. Only reconstruct common
      // indented citation geometry and an ordinary solid gray border.
      const style=node.style;
      if ([style.marginTop,style.marginRight,style.marginBottom].some(v=>v && v!=='0px')) return null;
      if (style.marginLeft && !['0px','0.8ex'].includes(style.marginLeft)) return null;
      if (style.paddingLeft && style.paddingLeft!=='1ex') return null;
      if (style.borderLeft && !/^1px solid (?:#ccc(?:ccc)?|rgb\(204, 204, 204\))$/i.test(style.borderLeft)) return null;
      continue;
    }
    return null;
  }
  const children=[];
  for (const child of node.childNodes) {
    const rendered=flowNode(child,depth+1);
    if (rendered===null) return null;
    children.push(rendered);
  }
  return h(node.localName,props,children);
}

export function naturalFlow(doc) {
  if (doc.head.children.length || doc.documentElement.attributes.length || doc.body.attributes.length) return null;
  const nodes=[];
  for (const node of doc.body.childNodes) {
    const rendered=flowNode(node,0);
    if (rendered===null) return null;
    nodes.push(rendered);
  }
  return nodes;
}
