// Build a separate document so printing never includes other messages or the application chrome.
const allowed = new Set('div p br b strong i em s strike u span sub sup ol ul li blockquote pre code table thead tbody tfoot tr th td h1 h2 h3 h4 h5 h6 hr'.split(' '));
const ignored = new Set(['script','style','iframe','object','embed','template','svg','math','noscript']);
const styles = ['color','background-color','font-family','font-size','font-style','font-weight','text-align','text-decoration-line','white-space','margin-left','padding-left'];

export function copyBody(source, target, doc) {
  for (const node of source.childNodes) {
    if (node.nodeType === 3) {
      target.append(doc.createTextNode(node.data));
      continue;
    }
    const tag = node.localName;
    if (!tag || ignored.has(tag)) continue;
    let element;
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      if (!/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(src)) {
        target.append(doc.createTextNode(node.getAttribute('alt') || ''));
        continue;
      }
      element = doc.createElement('img');
      element.src = src;
      element.alt = node.getAttribute('alt') || '';
    } else {
      element = doc.createElement(tag === 'a' ? 'u' : allowed.has(tag) ? tag : 'span');
      for (const prop of styles) {
        const value = node.style?.getPropertyValue(prop);
        if (value) element.style.setProperty(prop, value);
      }
      if (tag === 'td' || tag === 'th') {
        element.colSpan = node.colSpan;
        element.rowSpan = node.rowSpan;
      }
      if (tag === 'ol' && node.hasAttribute('start')) element.start = node.start;
      copyBody(node, element, doc);
    }
    target.append(element);
  }
}

export function printDocument(render, current=()=>true) {
  return new Promise((resolve,reject)=>{
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden','true');
  frame.setAttribute('sandbox','allow-same-origin allow-modals');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0';
  frame.onload = async () => {
    try {
    if (!current()) {frame.remove();resolve();return;}
    const doc = frame.contentDocument;
    await render(doc);
    await Promise.all(Array.from(doc.images, image => image.decode().catch(() => {})));
    if (!current()) {frame.remove();resolve();return;}
    const win = frame.contentWindow;
    win.addEventListener('afterprint', () => frame.remove(), {once:true});
    win.print();
    resolve();
    } catch (error) {frame.remove();reject(error);}
  };
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
    body{font:14px/1.5 Arial,sans-serif;color:#202124;overflow-wrap:anywhere}header{padding-bottom:16px;margin-bottom:20px;border-bottom:1px solid #dadce0}h1{font-size:20px;margin:0 0 12px}pre{white-space:pre-wrap;font:inherit}footer{margin-top:24px;border-top:1px solid #dadce0;padding-top:12px}img{max-width:100%}blockquote{border-left:2px solid #dadce0;padding-left:12px}
  </style><body></body>`;
  document.body.append(frame);
  });
}
