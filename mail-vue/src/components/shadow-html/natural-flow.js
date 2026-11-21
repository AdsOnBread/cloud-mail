import {h} from 'vue';

// Only ordinary text formatting crosses the iframe boundary. Build fresh Vue
// nodes and never copy message HTML, classes, styles or links into the app.
const tags=new Set('div p br b strong i em s strike u span blockquote'.split(' '));
const wrappers=new Set(['gmail_quote','gmail_quote_container','gmail_attr','moz-cite-prefix','cloudmail-reply-quote']);
function flowNode(node,depth) {
  if (node.nodeType===3) return node.data;
  if (node.nodeType===8) return '';
  if (!tags.has(node.localName) || depth>40) return null;
  for (const attr of node.attributes) {
    if (attr.name==='class' && [...node.classList].every(c=>wrappers.has(c))) continue;
    if (attr.name==='type' && node.localName==='blockquote' && attr.value==='cite') continue;
    if (attr.name==='dir' && /^(ltr|rtl|auto)$/i.test(attr.value)) continue;
    return null;
  }
  const children=[...node.childNodes].map(child=>flowNode(child,depth+1));
  if (children.includes(null)) return null;
  return h(node.localName,node.dir?{dir:node.dir}:{},children);
}

export function naturalFlow(doc) {
  if (doc.head.children.length || doc.documentElement.attributes.length || doc.body.attributes.length) return null;
  const nodes=[...doc.body.childNodes].map(node=>flowNode(node,0));
  return nodes.includes(null) ? null : nodes;
}
