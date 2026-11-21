// The dictionary identifiers also select the locally served, version-locked assets.
export const languages = [
  ['ca','cat','Català'], ['cs','ces','Čeština'], ['da','dan','Dansk'],
  ['de','deu','Deutsch'], ['et','ekk','Eesti keel'], ['en-gb','eng','English (UK)'],
  ['en','eng','English (US)'], ['es','spa','Español'], ['fr','fra','Français'],
  ['hr','hrv','Hrvatski'], ['it','ita','Italiano'], ['is','isl','Íslenska'],
  ['lt','lit','Lietuvių'], ['hu','hun','Magyar'], ['nl','nld','Nederlands'],
  ['nb','nob','Norsk (Bokmål)'], ['pl','pol','Polski'], ['pt','por','Português (Brasil)'],
  ['pt-pt','por','Português (Portugal)'], ['ro','ron','Română'], ['sl','slv','Slovenščina'],
  ['sk','slk','Slovenčina'], ['sv','swe','Svenska'], ['vi','vie','Tiếng Việt'],
  ['el','ell','Ελληνικά'], ['ru','rus','Русский'], ['uk','ukr','Українська'],
  ['bg','bul','Български'], ['he','heb','עברית'], ['fa','pes','فارسی'],
];

export function preferredDictionary(locales) {
  for (const locale of locales) {
    const tag = locale.toLowerCase();
    const base = tag.split('-')[0];
    if (/^en-(gb|au|nz|ie)\b/.test(tag)) return 'en-gb';
    if (tag === 'pt-pt') return tag;
    if (base === 'no') return 'nb';
    if (languages.some(([id]) => id === base)) return base;
  }
  return 'en';
}
