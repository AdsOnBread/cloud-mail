// A quoted label has an explicit boundary. For an unquoted label containing
// spaces, prefer the longest complete name before the remaining search terms.
export function labelSuggestions(text, destinations) {
  if (text === undefined) return [];
  const value = text.trimStart();
  const quoted = /^"([^"]*)"(?:\s+(.*)|$)/.exec(value);
  const term = (quoted ? quoted[1] : value.replace(/^"/, "")).trim().toLocaleLowerCase();
  const results = destinations.filter(item => {
    const name = item.name.toLocaleLowerCase();
    return quoted ? name === term : name.includes(term);
  });
  results.sort((a,b) => Number(b.name.toLocaleLowerCase()===term) - Number(a.name.toLocaleLowerCase()===term));
  if (quoted) return results.map(item => ({...item, query: quoted[2]?.trim() || ""}));
  if (value.startsWith('"')) return results;
  const prefix = destinations.filter(item => {
    const length = item.name.length;
    return /\s/.test(value.charAt(length)) && value.slice(0,length).toLocaleLowerCase() === item.name.toLocaleLowerCase();
  }).sort((a,b) => b.name.length - a.name.length)[0];
  const query = prefix && value.slice(prefix.name.length).trim();
  if (query) results.push({...prefix, query});
  return results;
}
