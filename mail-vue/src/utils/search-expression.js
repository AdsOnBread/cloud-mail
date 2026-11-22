import {maxPeople,maxPersonTerm,peopleTerms,setPeopleTerms} from '../../../shared/mail-search-people';
import {readSearchBar,searchBarText} from '../../../shared/mail-search-words';

// Keep spaces inside quoted text and groups, including unsupported Gmail expressions.
function splitTerms(text) {
  const terms=[];
  let start=0, quoted=false, escaped=false;
  const ends=[];
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (escaped) { escaped=false; continue; }
    if (quoted && c==='\\') { escaped=true; continue; }
    if (c==='"') { quoted=!quoted; continue; }
    if (quoted) continue;
    if (c==='(' || c==='{') ends.push(c==='(' ? ')' : '}');
    else if (c===ends.at(-1)) ends.pop();
    else if (!ends.length && /\s/u.test(c)) {
      if (i>start) terms.push(text.slice(start,i));
      start=i+1;
    }
  }
  if (start<text.length) terms.push(text.slice(start));
  return terms;
}

function quoteValue(value) {
  return /[()"{}\\]|(?:^|\s)OR(?:$|\s)/u.test(value) ? JSON.stringify(value) : value;
}
function decodeValue(value) {
  if (!value.startsWith('"')) return value.trim();
  try { const parsed=JSON.parse(value); return typeof parsed==='string' ? parsed.trim() : ''; }
  catch { return ''; }
}

export function formatSearchExpression(query,filters,{compact=false}={}) {
  const terms=[];
  for (const key of ['from','to']) {
    const values=peopleTerms(filters,key);
    if (!values.length) continue;
    const group=values.map(quoteValue).join(' OR ');
    terms.push(compact && values.length===1 && /^[^\s(){}"\\]+$/u.test(group) ? key+':'+group : key+':('+group+')');
  }
  if (filters.subject) terms.push('subject:('+quoteValue(filters.subject)+')');
  const words=searchBarText(query,filters.excluded);
  if (words) terms.push(words);
  if (filters.hasAttachment) terms.push('has:attachment');
  if (filters.isUnread) terms.push('is:unread');
  return terms.join(' ');
}

function fieldTerm(token) {
  const match=/^(from|to|subject):(.+)$/isu.exec(token);
  if (!match) return;
  const key=match[1].toLowerCase();
  let value=match[2];
  if (value.startsWith('(')) {
    if (!value.endsWith(')')) return;
    value=value.slice(1,-1);
  }
  if (key==='subject') {
    const subject=decodeValue(value);
    if (subject && subject.length<=200) return {key,subject};
    return;
  }
  const groups=[[]];
  for (const word of splitTerms(value)) {
    if (word==='OR') groups.push([]);
    else groups.at(-1).push(word);
  }
  const values=groups.map(group=>decodeValue(group.join(' ')));
  if (values.length<=maxPeople && values.every(v=>v && v.length<=maxPersonTerm)) return {key,values};
}

export function readSearchExpression(text,previous={}) {
  const filters={...previous}, ordinary=[], excluded=[];
  for (const key of ['from','to','fromAny','toAny','subject','excluded','hasAttachment','isUnread']) delete filters[key];
  const input=text.trim(), tokens=splitTerms(input);
  const fields=tokens.map(fieldTerm);
  const occurrences=new Map();
  for (const field of fields) if (field) occurrences.set(field.key,(occurrences.get(field.key)||0)+1);
  for (const [i,token] of tokens.entries()) {
    const field=fields[i], lower=token.toLowerCase();
    if (field && occurrences.get(field.key)===1) {
      if (field.key==='subject') filters.subject=field.subject;
      else setPeopleTerms(filters,field.key,field.values);
    } else if (lower==='has:attachment') filters.hasAttachment=1;
    else if (lower==='is:unread') filters.isUnread=1;
    else if (token.startsWith('-') && readSearchBar(token).excluded && !readSearchBar(token).query) excluded.push(readSearchBar(token).excluded);
    else ordinary.push(token);
  }
  if (excluded.length) filters.excluded=excluded.join(' ').slice(0,200);
  return {query:ordinary.length===tokens.length ? input : ordinary.join(' '),filters};
}
