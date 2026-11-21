import {sizeCriterion} from '../../../shared/mail-search-size';
import {fullAddress,peopleTerms,personSearchKey} from '../../../shared/mail-search-people';
import {searchDateBounds} from "../../../shared/mail-search-date";
import { attachedFile } from "./mailbox-attachments";

// SQLite folds ASCII. Apply just the additional Unicode case pairs needed by this search.
// These titlecase and compatibility letters cannot be recovered by uppercasing their lowercase form.
const alternateForms='İǅǈǋǲϴẞᾈᾉᾊᾋᾌᾍᾎᾏᾘᾙᾚᾛᾜᾝᾞᾟᾨᾩᾪᾫᾬᾭᾮᾯᾼῌῼΩKÅς';
function casePairs(needle) {
  const pairs=new Map();
  for (const ch of [...needle,...alternateForms]) {
    const upper=needle.includes(ch) ? ch.toUpperCase() : ch;
    for (const variant of [ch,upper]) {
      const folded=personSearchKey(variant);
      if (variant.codePointAt(0)>127 && variant!==folded && Array.from(variant).length===1 &&
          (needle.includes(folded) || (folded.length>1 && needle.includes(folded[0])))) pairs.set(variant,folded);
    }
  }
  return [...pairs];
}

export function addPeopleFilter(params, field, columns, filters, args, suggestions=false) {
  const terms=peopleTerms(params,field);
  if (!terms.length) return;
  const patterns=terms.map(term=>{
    const needle=personSearchKey(term);
    return {needle,pairs:casePairs(needle),partial:suggestions || !fullAddress(term)};
  });
  const needle="json_extract(term.value,'$.needle')", partial="json_extract(term.value,'$.partial')";
  function matches(email,name) {
    const text=`lower(CASE WHEN ${partial} THEN coalesce(${email},'')||char(10)||coalesce(${name},'') ELSE ${email} END)`;
    // The recursive form also supports long names without exceeding D1's pattern or expression-depth limits.
    const folded=patterns.some(term=>term.pairs.length) ? `(WITH RECURSIVE folded(step,text) AS (
      SELECT 0,${text} UNION ALL
      SELECT step+1,replace(text,json_extract(pair.value,'$[0]'),json_extract(pair.value,'$[1]'))
      FROM folded JOIN json_each(term.value,'$.pairs') pair ON pair.key=step
    ) SELECT text FROM folded WHERE step=json_array_length(term.value,'$.pairs'))` : text;
    return `CASE WHEN ${partial} THEN instr(${folded},${needle})>0 ELSE ${folded}=${needle} END`;
  }
  let match;
  if (field==='from') match=matches(...columns);
  else {
    match=columns.map(column=>{
      const list=`CASE WHEN json_valid(${column}) THEN ${column} ELSE json_array(${column}) END`;
      const email="CASE WHEN who.type='object' THEN json_extract(who.value,'$.address') ELSE who.value END";
      const name="CASE WHEN who.type='object' THEN json_extract(who.value,'$.name') END";
      return `EXISTS (SELECT 1 FROM json_each(${list}) who WHERE ${matches(email,name)})`;
    }).join(' OR ');
  }
  filters.push(`EXISTS (SELECT 1 FROM json_each(?) term WHERE ${match})`);
  args.push(JSON.stringify(patterns));
}

// SQLite length(text) counts characters. Casting to BLOB counts stored UTF-8 bytes.
export function addSizeFilter(params, filters, args, {columns,files,raw}) {
  const criterion=sizeCriterion(params);
  if (!criterion) return;
  const parts=columns.map(column=>`coalesce(length(cast(${column} as blob)),0)`);
  parts.push(`coalesce((${files}),0)`);
  const estimate=parts.join('+');
  const bytes=raw ? `coalesce(${raw},${estimate})` : `(${estimate})`;
  filters.push(bytes+(criterion.larger ? '>?' : '<?'));
  args.push(criterion.bytes);
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
  addSizeFilter(params,filters,args,{
    raw:'e.raw_size',columns:['e.subject','e.text','e.content'],
    files:'SELECT sum(att.size) FROM attachments att WHERE att.email_id=e.email_id AND att.user_id=e.user_id AND att.account_id=e.account_id',
  });
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
