import catalogUrl from "emojibase-data/en/compact.json?url";

export const categories = [
  ["Recently Used", "history", -1],
  ["Smileys and emotions", "mood", 0],
  ["People", "person-outline", 1],
  ["Animals and nature", "pets-outline", 3],
  ["Food and beverage", "restaurant", 4],
  ["Travel and places", "directions-car-outline", 5],
  ["Activities and events", "sports-soccer", 6],
  ["Objects", "lightbulb-outline", 7],
  ["Symbols", "favorite-outline", 8],
  ["Flags", "flag-outline", 9],
];

const normalized = value => value.toLowerCase().replaceAll("\uFE0F", "");
let pending;
export function loadEmoji() {
  if (!pending) {
    pending = fetch(catalogUrl).then(async response => {
      if (!response.ok) throw new Error("Could not load emoji");
      const entries = await response.json();
      return entries.filter(item => item.order && item.group !== 2)
        .sort((a, b) => a.order - b.order)
        .map(item => ({ ...item, keywords: normalized([item.unicode, item.label, ...(item.tags || [])].join(" ")) }));
    }).catch(error => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}

export function searchEmoji(entries, query) {
  const terms = normalized(query.trim()).split(/\s+/);
  const variants = /tone|skin/u.test(query.toLowerCase()) || /\p{Emoji_Modifier}/u.test(query);
  const matches = [];
  for (const item of entries) {
    if (terms.every(term => item.keywords.includes(term))) matches.push(item);
    if (variants && item.skins) {
      for (const skin of item.skins) {
        const text = normalized(skin.unicode + " " + skin.label);
        if (terms.every(term => text.includes(term))) matches.push(skin);
      }
    }
  }
  return matches;
}
