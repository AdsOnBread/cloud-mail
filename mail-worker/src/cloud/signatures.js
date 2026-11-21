import {parseHTML} from 'linkedom';
import BizError from '../error/biz-error';

const empty = () => ({items:[],defaults:{},beforeQuote:false});
const safeTags = new Set('div p br strong b em i u s span a ul ol li blockquote sub sup'.split(' '));
const skipTags = new Set(['script','style','iframe','template','svg','math','object']);
const color = /^(?:#[\da-f]{3,8}|[a-z]{1,20}|rgba?\([\d., %]+\))$/i;
const styles = {
  color, 'background-color':color, 'font-family':/^[\w ,'"-]{1,120}$/,
  'font-size':/^(?:\d{1,2}(?:\.\d+)?(?:px|pt|em|rem)|small|medium|large|x-large)$/,
  'font-weight':/^(?:bold|normal|[1-9]00)$/, 'font-style':/^(?:normal|italic)$/,
  'text-decoration':/^(?:underline|line-through|none)$/, 'text-align':/^(?:left|right|center|justify)$/
};
function cleanHTML(html) {
  const {document} = parseHTML('<html><body></body></html>');
  const input=document.createElement('div'), output=document.createElement('div');
  input.innerHTML=html;
  function copy(node,parent,depth) {
    if(depth>64)throw new BizError('Signature formatting is too deeply nested.',400);
    if(node.nodeType===3){parent.appendChild(document.createTextNode(node.textContent));return;}
    if(node.nodeType!==1)return;
    const tag=node.localName.toLowerCase();
    if(skipTags.has(tag))return;
    let target=parent;
    if(safeTags.has(tag)){
      target=document.createElement(tag);
      if(tag==='a'){
        try {
          const url=new URL(node.getAttribute('href'));
          if(['http:','https:','mailto:','tel:'].includes(url.protocol))target.setAttribute('href',url.href);
        } catch { /* Keep the display text. */ }
      }
      for(const [key,allowed] of Object.entries(styles)){
        const value=node.style.getPropertyValue(key)?.trim();
        if(value && allowed.test(value))target.style.setProperty(key,value);
      }
      parent.appendChild(target);
    }
    for(const child of node.childNodes)copy(child,target,depth+1);
  }
  for(const child of input.childNodes)copy(child,output,0);
  return output.innerHTML;
}
export async function readSignatures(db,userId) {
  const row=await db.prepare('SELECT version,data FROM mail_signatures WHERE user_id=?').bind(userId).first();
  return row ? {version:row.version,...JSON.parse(row.data)} : {version:0,...empty()};
}
export function validatedSignatures(input) {
  if(!input || !Number.isSafeInteger(input.version) || input.version<0 || !Array.isArray(input.items) ||
    input.items.length>100 || typeof input.beforeQuote!=='boolean' || !input.defaults ||
    typeof input.defaults!=='object' || Array.isArray(input.defaults) || JSON.stringify(input).length>500000)
    throw new BizError('Invalid signature settings.',400);
  const ids=new Set();
  const items=input.items.map(item=>{
    if(!item || typeof item.id!=='string' || !/^[a-zA-Z0-9-]{1,64}$/.test(item.id) || ids.has(item.id) ||
      typeof item.name!=='string' || !item.name.trim() || item.name.length>320 || typeof item.html!=='string' || item.html.length>10000)
      throw new BizError('Give every signature a name and keep it under 10,000 characters.',400);
    ids.add(item.id);
    const html=cleanHTML(item.html);
    if(html.length>10000)throw new BizError('Keep each formatted signature under 10,000 characters.',400);
    return {id:item.id,name:item.name.trim(),html};
  });
  const defaults={};
  for(const [accountId,pair] of Object.entries(input.defaults)){
    if(!/^[1-9]\d*$/.test(accountId) || !pair || ![pair.newMail,pair.reply].every(id=>id===null||ids.has(id)))
      throw new BizError('Choose an existing signature for each default.',400);
    if(pair.newMail || pair.reply) defaults[accountId]={newMail:pair.newMail,reply:pair.reply};
  }
  return {items,defaults,beforeQuote:input.beforeQuote};
}
export async function saveSignatures(db,userId,input) {
  const data=validatedSignatures(input);
  const json=JSON.stringify(data);
  const changed=input.version===0
    ? await db.prepare('INSERT INTO mail_signatures(user_id,version,data) VALUES(?,1,?) ON CONFLICT(user_id) DO NOTHING RETURNING version').bind(userId,json).first()
    : await db.prepare('UPDATE mail_signatures SET data=?,version=version+1 WHERE user_id=? AND version=? RETURNING version').bind(json,userId,input.version).first();
  if(!changed)throw new BizError('Signatures changed elsewhere. Reload the saved settings before editing again.',409);
  return {version:changed.version,...data};
}
