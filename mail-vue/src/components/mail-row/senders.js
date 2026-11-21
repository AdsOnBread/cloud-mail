// Keep the originator and recent correspondents recognizable in a crowded sender column.
export function senderLine(senders) {
  if (!senders?.length) return [];
  const firstNames = senders.map(({name}) => name.trim().split(/\s+/)[0]);
  const counts = new Map();
  for (const name of firstNames) counts.set(name,(counts.get(name) || 0) + 1);
  const parts = senders.map((sender,i) => ({
    ...sender,
    label: senders.length > 1 && counts.get(firstNames[i]) === 1 ? firstNames[i] : sender.name,
    separator: i ? ', ' : '',
  }));
  if (parts.length <= 4) return parts;
  const latest = parts.slice(1).sort((a,b) => b.lastId - a.lastId).slice(0,2).reverse();
  latest[0].separator = ' .. ';
  return [parts[0], ...latest];
}
