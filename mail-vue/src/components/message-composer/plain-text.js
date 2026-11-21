// Draft HTML keeps the signature and quote boundaries so either editor can reopen it.
const blocks = new Set(['ADDRESS','ARTICLE','BLOCKQUOTE','DIV','H1','H2','H3','H4','H5','H6','LI','OL','P','PRE','SECTION','TABLE','TBODY','THEAD','TFOOT','TR','UL']);
const skip = new Set(['HEAD','SCRIPT','STYLE','TEMPLATE','NOSCRIPT','SVG','IFRAME','OBJECT']);
const escape = value => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function inlineText(node) {
  if(node.nodeType===3)return node.data.replace(/\u00a0/g,' ');
  if(node.nodeType!==1 || skip.has(node.tagName) || node.hasAttribute('data-mce-bogus'))return '';
  if(node.tagName==='BR')return '\n';
  if(node.tagName==='TR')return Array.from(node.children).filter(cell=>cell.tagName==='TH' || cell.tagName==='TD').map(plainBodyText).join('\t');
  if(node.tagName==='IMG')return node.getAttribute('alt') || '';
  const value=plainBodyText(node);
  if(node.tagName==='A'){
    const href=node.getAttribute('href') || '';
    if(/^(?:https?:\/\/|mailto:|tel:)/i.test(href) && value!==href && value!==href.replace(/^(mailto:|tel:)/i,''))return value ? value+' <'+href+'>' : href;
  }
  if(node.tagName==='BLOCKQUOTE')return value.split('\n').map(line=>'> '+line).join('\n');
  if(node.tagName==='LI'){
    const list=node.parentElement;
    const number=list?.tagName==='OL' ? Number(list.getAttribute('start') || 1)+Array.from(list.children).indexOf(node) : null;
    return (number==null?'• ':number+'. ')+value;
  }
  return value;
}

export function plainBodyText(root) {
  const lines=[];
  let run='';
  for(const node of root.childNodes){
    if(node.nodeType===3 && /^\s*\n\s*$/.test(node.data) && (blocks.has(node.previousSibling?.nodeName)||blocks.has(node.nextSibling?.nodeName)))continue;
    if(blocks.has(node.nodeName)){
      if(run){lines.push(run);run='';}
      const value=inlineText(node);
      lines.push(value==='\n'?'':value);
    }else run+=inlineText(node);
  }
  if(run)lines.push(run);
  return lines.join('\n');
}

export function plainMarkup(html) {
  const template=document.createElement('template');
  template.innerHTML=html || '';
  const doc=template.content.ownerDocument;
  const out=doc.createElement('div'), group=doc.createElement('div');
  function append(source,kind){
    const value=plainBodyText(source);
    if(!source.childNodes.length)return;
    const dest=kind?doc.createElement('div'):out;
    if(kind){
      dest.className=kind;
      if(kind==='cloudmail-signature' && source.dataset.signatureId)dest.dataset.signatureId=source.dataset.signatureId;
      out.append(dest);
    }
    for(const line of value.split('\n')){
      const paragraph=doc.createElement('div');
      paragraph.innerHTML=line ? escape(line) : '<br>';
      dest.append(paragraph);
    }
  }
  for(const node of [...template.content.childNodes]){
    const kind=['cloudmail-signature','cloudmail-reply-quote'].find(name=>node.classList?.contains(name));
    if(kind){append(group);group.replaceChildren();append(node,kind);}
    else if(node.nodeType!==3 || node.data.trim() || !node.data.includes('\n'))group.append(node);
  }
  append(group);
  return {content:out.innerHTML,text:plainBodyText(out)};
}

// Rich HTML collapses ordinary whitespace. Preserve visible runs when enabling
// formatting again, including leading indentation and tab-aligned text.
export function richMarkup(plain) {
  const template=document.createElement('template');
  template.innerHTML=plainMarkup(plain).content;
  for (const line of template.content.querySelectorAll('div')) {
    if (line.childNodes.length!==1 || line.firstChild.nodeType!==3) continue;
    const text=line.textContent;
    if (text.includes('\t')) {
      const pre=document.createElement('pre');
      pre.style.cssText='white-space:pre-wrap;font:inherit;margin:0';
      pre.textContent=text;
      line.replaceWith(pre);
    } else {
      line.textContent=text.replace(/^ +| +$| {2,}/g, (spaces, offset) =>
        offset===0 || offset+spaces.length===text.length ? '\u00a0'.repeat(spaces.length) : '\u00a0'.repeat(spaces.length-1)+' ');
    }
  }
  return template.innerHTML;
}

// A plaintext-only host can store newlines in text nodes or in separate blocks.
// Map the selection into the line-based markup produced when formatting is enabled.
export function plainSelection(body, range) {
  function position(node, offset) {
    const path = [];
    while (node !== body) {
      if (!node.parentNode) return [0, 0];
      path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
      node = node.parentNode;
    }
    const copy = body.cloneNode(true);
    const point = copy.ownerDocument.createRange();
    point.setStart(path.reduce((parent, index) => parent.childNodes[index], copy), offset);
    point.collapse(true);
    const marker = crypto.randomUUID();
    point.insertNode(copy.ownerDocument.createTextNode(marker));
    const text = plainBodyText(copy);
    const lines = text.slice(0, Math.max(0, text.indexOf(marker))).split('\n');
    return [lines.length - 1, lines.at(-1).length];
  }
  const start = position(range.startContainer, range.startOffset);
  return [start, range.collapsed ? start : position(range.endContainer, range.endOffset)];
}

export function restorePlainSelection(body, positions) {
  const lines = Array.from(body.querySelectorAll('div,p,pre')).filter(node => !node.querySelector('div,p,pre'));
  const range = body.ownerDocument.createRange();
  function point([line, column]) {
    const block = lines[Math.min(line, lines.length - 1)] || body;
    const walker = body.ownerDocument.createTreeWalker(block, 4);
    let text;
    while ((text = walker.nextNode())) {
      if (column <= text.length) return [text, column];
      column -= text.length;
    }
    return [block, block.childNodes.length && block.lastChild.nodeName !== 'BR' ? block.childNodes.length : 0];
  }
  range.setStart(...point(positions[0]));
  range.setEnd(...point(positions[1]));
  return range;
}
