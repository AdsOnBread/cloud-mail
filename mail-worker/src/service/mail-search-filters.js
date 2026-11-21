import {fullAddress,peopleTerms} from '../../../shared/mail-search-people';
import {searchDateBounds} from "../../../shared/mail-search-date";
import { attachedFile } from "./mailbox-attachments";

// SQLite's lower() only folds ASCII. GLOB character classes also work for accented
// names. Escape GLOB metacharacters so typed names and address punctuation stay literal.
function peoplePattern(term, partial) {
  const literal={'[':'[[]','*':'[*]','?':'[?]'};
  const pattern=Array.from(term,ch=>{
    if (literal[ch]) return literal[ch];
    const variants=[...new Set([ch,ch.toLowerCase(),ch.toUpperCase()])].filter(v=>Array.from(v).length===1);
    return variants.length===1 ? ch : '['+variants.join('')+']';
  }).join('');
  return partial ? '*'+pattern+'*' : pattern;
}

export function addPeopleFilter(params, field, columns, filters, args, suggestions=false) {
  const terms=peopleTerms(params,field);
  if (!terms.length) return;
  const patterns=terms.map(term=>{
    const partial=suggestions || !fullAddress(term);
    return {p:peoplePattern(term,partial),partial};
  });
  const pattern="json_extract(term.value,'$.p')", partial="json_extract(term.value,'$.partial')";
  let match;
  if (field==='from') {
    const [email,name]=columns;
    match=`${email} GLOB ${pattern} OR (${partial} AND ${name} GLOB ${pattern})`;
  } else {
    match=columns.map(column=>{
      const list=`CASE WHEN json_valid(${column}) THEN ${column} ELSE json_array(${column}) END`;
      const email="CASE WHEN who.type='object' THEN json_extract(who.value,'$.address') ELSE who.value END";
      const name="CASE WHEN who.type='object' THEN json_extract(who.value,'$.name') END";
      return `EXISTS (SELECT 1 FROM json_each(${list}) who WHERE ${email} GLOB ${pattern} OR (${partial} AND ${name} GLOB ${pattern}))`;
    }).join(' OR ');
  }
  filters.push(`EXISTS (SELECT 1 FROM json_each(?) term WHERE ${match})`);
  args.push(JSON.stringify(patterns));
}

// Both the conversation and message lists use "e" for the owned, visible email.
export function addMailFilters(params, filters, args, {conversation = false} = {}) {
  addPeopleFilter(params, 'from', ['e.send_email', 'e.name'], filters, args);
  addPeopleFilter(params, 'to', ['e.recipient', 'e.cc', "CASE WHEN e.type=1 THEN e.bcc ELSE '' END"], filters, args);
  if (params.subject?.trim()) {
    filters.push('instr(lower(e.subject),lower(?))>0');
    args.push(params.subject.trim().slice(0,200));
  }
	if (String(params.hasAttachment) === '1')
		filters.push(conversation
      ? `EXISTS (SELECT 1 FROM mobile_thread_members fm JOIN email e ON e.email_id=fm.email_id AND e.user_id=fm.user_id
          JOIN account fa ON fa.account_id=e.account_id AND fa.user_id=e.user_id AND fa.is_del=0
          JOIN attachments att ON ${attachedFile} WHERE fm.user_id=m.user_id AND fm.thread_id=m.thread_id
          AND e.is_del=0 AND e.trashed_at IS NULL AND e.status NOT IN (6,7))`
      : `EXISTS (SELECT 1 FROM attachments att WHERE ${attachedFile})`);
	if (String(params.isUnread) === '1') filters.push('e.type=0 AND e.unread=0');
  addSearchDates(params, 'e.create_time', filters, args);
}

// Callers provide the creation-time column, independently of the folder or pagination order.
export function addSearchDates(params, column, filters, args) {
  const {after, before} = searchDateBounds(params);
  if (after !== null) {
    filters.push(column + ">=datetime(?,'unixepoch')");
    args.push(after);
  }
  if (before !== null) {
    filters.push(column + "<datetime(?,'unixepoch')");
    args.push(before);
  }
}
