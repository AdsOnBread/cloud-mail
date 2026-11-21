// The search bar spells a single exclusion with a minus, and alternatives with -{…}.
const clauses = /"(?:[^"]*"|[^"]*$)|[^\s"]+/gu;
const tokens = /[\p{L}\p{M}\p{N}]+/gu;
const words = text => String(text ?? '').normalize('NFD').toLowerCase().replace(/\p{M}/gu,'').match(tokens) || [];

export function excludedPhrases(value) {
  const parts = String(value || '').slice(0,200).match(clauses) || [];
  return [...new Set(parts.map(part=>words(part).join(' ')).filter(Boolean))];
}

export function containsExcluded(fields, phrases) {
  if (!phrases.length) return false;
  return fields.some(field=>{
    const text=' '+words(field).join(' ')+' ';
    return phrases.some(phrase=>text.includes(' '+phrase+' '));
  });
}

export function searchBarText(query, excluded) {
  const terms=String(excluded || '').trim().match(clauses) || [];
  if (!terms.length) return query || '';
  return [query, terms.length===1 ? '-'+terms[0] : '-{'+terms.join(' ')+'}'].filter(Boolean).join(' ');
}

export function readSearchBar(text) {
  const ordinary=[], excluded=[];
  // Quoted positive phrases and hyphens inside words stay in the ordinary query.
  for (const match of String(text || '').matchAll(/(?:^|\s+)(-\{((?:"[^"]*"|[^}"])*)\}(?=\s|$)|-("[^"]+"|[^\s{}"]+)(?=\s|$)|"[^"]*"|\S+)/gu)) {
    if (match[2]!==undefined || match[3]!==undefined) excluded.push(match[2] ?? match[3]);
    else ordinary.push(match[1]);
  }
  return {query:excluded.length ? ordinary.join(' ') : String(text || '').trim(), excluded:excluded.join(' ').trim().slice(0,200)};
}
