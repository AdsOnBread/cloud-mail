const quoteMarkers='.gmail_quote,.cloudmail-reply-quote,blockquote[type="cite"],blockquote';
const isAttribution=text=>/^On\s+.{1,700}\bwrote:\s*$/is.test(text.trim()) ||
  /^[^\n]{1,350}<[^<>\s]+@[^<>\s]+>\s+wrote:\s*$/i.test(text.trim());
const forwardMarker=/^-{2,}\s*(?:forwarded message|original message)\s*-{2,}/i;

function precedingAttribution(quote) {
  let previous=quote.previousSibling;
  while (previous && ((previous.nodeType===3 && !previous.textContent.trim()) || previous.nodeName==='BR')) previous=previous.previousSibling;
  if (!previous) return null;
  const explicit=previous.matches?.('.gmail_attr,.moz-cite-prefix');
  if (!explicit && !isAttribution(previous.textContent)) return null;
  // A reply and its attribution can share a div separated by a line break.
  // Keep new sentences above the attribution visible.
  if (previous.querySelector?.('p,div,br,blockquote') && !explicit) return null;
  return previous;
}

function htmlParts(html,reply) {
  if (!/gmail_quote|cloudmail-reply-quote|<blockquote\b/i.test(html)) return [{html}];
  const doc=new DOMParser().parseFromString(html,'text/html'), body=doc.body;
  const quotes=[];
  for (const node of body.querySelectorAll(quoteMarkers)) {
    // Slicing a table or a list into independent documents changes its layout and numbering.
    if (node.closest('table,ul,ol,pre,code') || quotes.at(-1)?.end.contains(node)) continue;
    const attribution=precedingAttribution(node);
    const gmail=node.classList.contains('gmail_quote');
    const cloud=node.classList.contains('cloudmail-reply-quote');
    if (forwardMarker.test(node.textContent.trim())) continue;
    if (!(gmail || attribution || (cloud && (reply || isAttribution(node.firstElementChild?.textContent || ''))) ||
      (reply && node.matches('blockquote[type="cite"]')))) continue;
    if (!node.textContent.trim() && !node.querySelector('img,hr,video,audio')) continue;
    quotes.push({start:attribution || node,end:node});
  }
  if (!quotes.length) return [{html}];
  const parts=[],range=doc.createRange();
  range.setStart(body,0);
  function append(quote) {
    const fragment=range.cloneContents();
    if (!fragment.textContent.trim() && !fragment.querySelector('img,hr,video,audio,table,input')) return;
    // cloneContents omits ancestors shared by both endpoints. Restore them to
    // keep direction, formatting and containers on either side of an inline reply.
    let content=fragment;
    for (let el=range.commonAncestorContainer; el && el!==body;el=el.parentNode) {
      if (el.nodeType!==1) continue;
      const parent=el.cloneNode(false);parent.append(content);content=parent;
    }
    const shell=body.cloneNode(false);shell.append(content);
    const root=doc.documentElement.cloneNode(false);root.append(shell);
    parts.push({html:root.outerHTML,quote});
  }
  for (const {start,end} of quotes) {
    range.setEndBefore(start);append(false);
    range.setStartBefore(start);range.setEndAfter(end);append(true);
    range.setStartAfter(end);
  }
  range.setEnd(body,body.childNodes.length);append(false);
  return parts;
}

function textParts(text,reply) {
  if (!/^ {0,3}>/m.test(text)) return [{text}];
  const lines=text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
  const quoted=line=>/^ {0,3}>/.test(line);
  const parts=[];
  let visible=0;
  for (let i=0;i<lines.length;i++) {
    if (!quoted(lines[i])) continue;
    const first=i;
    while (i+1<lines.length && quoted(lines[i+1])) i++;
    let start=first;
    while (start>visible && !lines[start-1].trim()) start--;
    const attribution=start>visible && isAttribution(lines[start-1]);
    if (!attribution && !reply) continue;
    // A single comparison such as "> 4" in an ordinary reply is ambiguous.
    if (!attribution && first===i && /^\s*>\s*[\d=]/.test(lines[first])) continue;
    start=attribution ? start-1 : first;
    if (start>visible) parts.push({text:lines.slice(visible,start).join('')});
    parts.push({text:lines.slice(start,i+1).join(''),quote:true});visible=i+1;
  }
  if (visible<lines.length) parts.push({text:lines.slice(visible).join('')});
  return parts;
}

export function messageParts({html,text='',subject='',reply=false}) {
  const inReply=reply || /^\s*re\s*:/i.test(subject || '');
  return html ? htmlParts(html,inReply) : textParts(text || '',inReply);
}
