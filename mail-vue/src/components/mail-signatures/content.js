// Only manage the signature at the top level. A quoted message may have its own.
const signature = body => Array.from(body.children).find(node=>node.classList.contains('cloudmail-signature'));
export function signatureId(body) { return signature(body)?.getAttribute('data-signature-id') || ''; }

export function replaceSignature(body,item,beforeQuote,reply) {
  const previous=signature(body);
  if(!item) { previous?.remove(); return; }
  const doc=body.ownerDocument, block=doc.createElement('div');
  block.className='cloudmail-signature';
  block.setAttribute('data-signature-id',item.id);
  if(!(reply && beforeQuote)){
    const line=doc.createElement('div');
    line.textContent='-- ';
    block.append(line);
  }
  const content=doc.createElement('div');
  content.innerHTML=item.html;
  block.append(content);
  if(previous){previous.replaceWith(block);return;}
  if(!body.textContent.trim() && !body.querySelector('img') && !body.children.length){
    const blank=doc.createElement('div');blank.append(doc.createElement('br'));body.append(blank);
  }
  const quote=reply && beforeQuote && Array.from(body.children).find(node=>node.classList.contains('cloudmail-reply-quote'));
  body.insertBefore(block,quote || null);
}
