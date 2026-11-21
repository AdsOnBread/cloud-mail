const quoteMarkers='.gmail_quote,.cloudmail-reply-quote,blockquote[type="cite"],blockquote';
const isAttribution=text=>/^On\s+.{1,700}\bwrote:\s*$/is.test(text.trim()) ||
  /^[^\n]{1,350}<[^<>\s]+@[^<>\s]+>\s+wrote:\s*$/i.test(text.trim());
const forwardMarker=/^(?:-{2,}\s*(?:forwarded message|original message)\s*-{2,}|begin forwarded message:)/i;

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
  // Document-level selectors can span a quote boundary. Keeping this rich
  // message together preserves hidden preheaders, table layout and styling.
  if (doc.querySelector('style')) return [{html}];
  const quotes=[];
  let forwarded=null;
  for (const node of body.querySelectorAll(quoteMarkers)) {
    // Slicing a table or a list into independent documents changes its layout and numbering.
    if (node.closest('table,ul,ol,pre,code') || forwarded?.contains(node) || quotes.at(-1)?.end.contains(node)) continue;
    const attribution=precedingAttribution(node);
    const gmail=node.classList.contains('gmail_quote');
    const cloud=node.classList.contains('cloudmail-reply-quote');
    const cloudReply=cloud && isAttribution(node.firstElementChild?.textContent || '');
    if (forwardMarker.test(node.textContent.trim()) || (cloud && !cloudReply && !attribution)) {
      forwarded=node;
      continue;
    }
    // The composer also wraps forwarded content in the Cloudmail class, even
    // when its original subject starts with Re:. Only its reply has an attribution.
    if (!(gmail || attribution || cloudReply ||
      (reply && node.matches('blockquote[type="cite"]')))) continue;
    if (!node.textContent.trim() && !node.querySelector('img,hr,video,audio')) continue;
    const start=attribution && !quotes.at(-1)?.end.contains(attribution) ? attribution : node;
    quotes.push({start,end:node});
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

// Require a calendar date before joining a wrapped line to the sender.
const month='(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const weekday='(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)';
const datedReply=new RegExp(`^On\\s+(?:${weekday},?\\s+)?(?:\\d{1,2}\\s+${month}\\b|${month}\\s+\\d{1,2}\\b|\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{1,4}\\b)`,'i');
function attributionStart(lines,end,visible) {
  if (end===visible) return end;
  const last=lines[end-1].trim();
  if (!/\bwrote:$/i.test(last)) return end;
  if (/^On\s/i.test(last) && isAttribution(last)) return end-1;
  // Wrapped attributions start with a dated line and end with the author's name.
  for (let i=end-2;i>=Math.max(visible,end-3);i--) {
    const line=lines[i].trim();
    if (!line || /[.!?]$/.test(line)) break;
    if (datedReply.test(line) &&
      /(?:\d|,|\b[ap]m|<[^<>\s]+@[^<>\s]+>)$/i.test(line) && isAttribution(lines.slice(i,end).map(s=>s.trim()).join(' '))) return i;
  }
  return isAttribution(last) ? end-1 : end;
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
    const header=attributionStart(lines,start,visible);
    const attribution=header<start;
    if (!attribution && !reply) continue;
    // A single comparison such as "> 4" in an ordinary reply is ambiguous.
    if (!attribution && first===i && /^\s*>\s*[\d=]/.test(lines[first])) continue;
    start=attribution ? header : first;
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
