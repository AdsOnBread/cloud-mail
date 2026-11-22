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
  return /[()"{}\\]|\s{2}|[^\S ]|(?:^|\s)OR(?:$|\s)/u.test(value) ? JSON.stringify(value) : value;
}
function decodeValue(value) {
  value=value.trim();
  if (!value.startsWith('"')) return value;
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
  // Advanced search can ask for the literal text "from:alice" in a message.
  // Quote that text so editing another part of the expression keeps it in the body search.
  const literal=/[(){}"\\]|(?:^|\s)(?:-|(?:from|to|subject):|has:attachment(?:\s|$)|is:(?:unread|muted)(?:\s|$)|OR(?:\s|$))/iu.test(query);
  const words=searchBarText(literal ? JSON.stringify(query) : query,filters.excluded);
  if (words) terms.push(words);
  if (filters.hasAttachment) terms.push('has:attachment');
  if (filters.isUnread) terms.push('is:unread');
  if (filters.isMuted) terms.push('is:muted');
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
  const values=[];
  let groupStart=0, cursor=0;
  for (const word of splitTerms(value)) {
    const start=value.indexOf(word,cursor);
    cursor=start+word.length;
    if (word==='OR') {
      values.push(decodeValue(value.slice(groupStart,start)));
      groupStart=cursor;
    }
  }
  values.push(decodeValue(value.slice(groupStart)));
  if (values.length<=maxPeople && values.every(v=>v && v.length<=maxPersonTerm)) return {key,values};
}

function alternatives(tokens) {
  const fields=tokens.map(fieldTerm);
  const key=fields[0]?.key;
  if (!key || key==='subject' || !fields.every(f=>f?.key===key)) return;
  const values=fields.flatMap(f=>f.values);
  if (values.length<=maxPeople) return {key,values};
}

function groupedField(token) {
  if (token.startsWith('{') && token.endsWith('}')) return alternatives(splitTerms(token.slice(1,-1)));
  return fieldTerm(token);
}

export function readSearchExpression(text,previous={}) {
  const filters={...previous}, excluded=[];
  for (const key of ['from','to','fromAny','toAny','subject','excluded','hasAttachment','isUnread','isMuted']) delete filters[key];
  const input=text.trim(), tokens=splitTerms(input);
  if (tokens.includes('OR')) {
    // The address filters can represent alternatives within one field. Other Boolean
    // expressions must stay intact rather than silently becoming a conjunction.
    const isAlternation=tokens.length%2===1 && tokens.every((t,i)=>i%2===0 || t==='OR');
    const field=isAlternation && alternatives(tokens.filter((_,i)=>i%2===0));
    if (!field) return {query:input,filters};
    setPeopleTerms(filters,field.key,field.values);
    return {query:'',filters};
  }
  const fields=tokens.map(groupedField);
  const occurrences=new Map();
  for (const field of fields) if (field) occurrences.set(field.key,(occurrences.get(field.key)||0)+1);
  let query='', end=0, lastWord=-1;
  for (const [i,token] of tokens.entries()) {
    const start=input.indexOf(token,end), space=input.slice(end,start);
    end=start+token.length;
    const field=fields[i], lower=token.toLowerCase();
    if (field && occurrences.get(field.key)===1) {
      if (field.key==='subject') filters.subject=field.subject;
      else setPeopleTerms(filters,field.key,field.values);
    } else if (lower==='has:attachment') filters.hasAttachment=1;
    else if (lower==='is:muted') filters.isMuted=1;
    else if (lower==='is:unread') filters.isUnread=1;
    else {
      const negative=token.startsWith('-') && readSearchBar(token);
      if (negative?.excluded && !negative.query) {excluded.push(negative.excluded);continue;}
      const word=token.startsWith('"') ? decodeValue(token) || token : token;
      if (query) query+=lastWord===i-1 ? space : ' ';
      query+=word;
      lastWord=i;
    }
  }
  if (excluded.length) filters.excluded=excluded.join(' ').slice(0,200);
  return {query,filters};
}
