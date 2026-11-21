// Keep the first term in the original query parameter for single-person searches.
export const maxPeople = 12;

export function peopleTerms(params, field) {
  let extra = [];
  try {
    const parsed = JSON.parse(params[field + 'Any'] || '[]');
    if (Array.isArray(parsed)) extra = parsed;
  } catch { /* Older clients supply only the first term. */ }
  return normalizedPeople([params[field], ...extra]);
}

function normalizedPeople(values) {
  const seen = new Set(), terms = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const term = value.trim().slice(0, 200), key = term.toLowerCase();
    if (term && !seen.has(key)) {
      terms.push(term);
      seen.add(key);
      if (terms.length === maxPeople) break;
    }
  }
  return terms;
}

export function setPeopleTerms(params, field, values) {
  const [first, ...extra] = normalizedPeople(values);
  delete params[field];
  delete params[field + 'Any'];
  if (first) params[field] = first;
  if (extra.length) params[field + 'Any'] = JSON.stringify(extra);
}

export const fullAddress = term => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(term);

export function matchesPeople(values, terms) {
  return !terms.length || terms.some(term => {
    const needle=term.toLowerCase(), exact=fullAddress(term);
    return values.some(person=>{
      const email=(typeof person==='string' ? person : person?.address)?.toLowerCase() || '';
      return exact ? email===needle : email.includes(needle) || (person?.name || '').toLowerCase().includes(needle);
    });
  });
}
