// Draft HTML keeps the signature and quote boundaries so either editor can reopen it.
const blocks = new Set(['ADDRESS','ARTICLE','BLOCKQUOTE','DIV','H1','H2','H3','H4','H5','H6','LI','OL','P','PRE','SECTION','TABLE','TR','UL']);
const skip = new Set(['HEAD','SCRIPT','STYLE','TEMPLATE','NOSCRIPT','SVG','IFRAME','OBJECT']);
const escape = value => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function inlineText(node) {
  if(node.nodeType===3)return node.data.replace(/\u00a0/g,' ');
  if(node.nodeType!==1 || skip.has(node.tagName) || node.hasAttribute('data-mce-bogus'))return '';
  if(node.tagName==='BR')return '\n';
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
  const doc=new DOMParser().parseFromString(html || '', 'text/html');
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
  for(const node of [...doc.body.childNodes]){
    const kind=['cloudmail-signature','cloudmail-reply-quote'].find(name=>node.classList?.contains(name));
    if(kind){append(group);group.replaceChildren();append(node,kind);}
    else if(node.nodeType!==3 || node.data.trim() || !node.data.includes('\n'))group.append(node);
  }
  append(group);
  return {content:out.innerHTML,text:plainBodyText(out)};
}
