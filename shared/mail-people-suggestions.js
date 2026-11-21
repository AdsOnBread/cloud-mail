// Rows can come from a stored message or a queued draft. Received Bcc is private.
export function peopleSuggestions(rows, field, query = '', limit = 8) {
  const people = new Map(), needle = query.trim().toLowerCase();
  function add(value) {
    const email = typeof value === 'string' ? value : value?.address;
    if (typeof email !== 'string' || !email.trim()) return;
    const address = email.trim(), key = address.toLowerCase();
    const name = (typeof value?.name === 'string' && value.name.trim()) || address;
    if (!key.includes(needle) && !name.toLowerCase().includes(needle)) return;
    if (!people.has(key) || people.get(key).name === people.get(key).email) people.set(key, {name,email:address});
  }
  function recipients(value) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { return; }
    }
    if (Array.isArray(value)) value.forEach(add);
  }
  for (const row of rows) {
    if (field === 'from') add({address:row.senderEmail ?? row.sendEmail, name:row.senderName ?? row.name});
    else {
      recipients(row.recipients ?? row.recipient);
      recipients(row.cc);
      if (row.type === 1 || row.draftId) recipients(row.bcc);
    }
  }
  return [...people.values()].slice(0,limit);
}
