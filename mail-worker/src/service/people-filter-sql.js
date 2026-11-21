import {fullAddress,personSearchKey} from '../../../shared/mail-search-people.js';
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

export function personPatterns(terms,suggestions=false) {
  return terms.map(term=>{
    const needle=personSearchKey(term);
    return {needle,pairs:casePairs(needle),partial:suggestions || !fullAddress(term)};
  });
}
export function peopleSQL(field,columns,source,unicode=true){
  const needle="json_extract(term.value,'$.needle')", partial="json_extract(term.value,'$.partial')";
  function matches(email,name) {
    const text=`lower(CASE WHEN ${partial} THEN coalesce(${email},'')||char(10)||coalesce(${name},'') ELSE ${email} END)`;
    // The recursive form also supports long names without exceeding D1's pattern or expression-depth limits.
    const folded=unicode ? `(WITH RECURSIVE folded(step,text) AS (
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
      return `EXISTS (SELECT 1 FROM json_tree(${list}) who WHERE (who.type='object' OR (who.type='text' AND typeof(who.key)='integer')) AND ${matches(email,name)})`;
    }).join(' OR ');
  }
  return `EXISTS (SELECT 1 FROM json_each(${source}) term WHERE ${match})`;
}
