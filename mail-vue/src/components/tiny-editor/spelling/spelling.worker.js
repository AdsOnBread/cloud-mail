import {loadModule} from '@farscrl/hunspell-wasm';
import {dictionaryData} from './dictionary-data';
import {franc} from 'franc';
import {languages, preferredDictionary} from './languages';

let engine, dictionary, currentLanguage;
function detect(sample, locales) {
  const preferred = preferredDictionary(locales);
  if (sample.trim().split(/\s+/).length < 10) return preferred;
  const code = franc(sample, {only:languages.map(([, iso]) => iso)});
  // Choose the regional variant from the browser when both dictionaries match.
  if (languages.some(([id, iso]) => id === preferred && iso === code)) return preferred;
  if (code === 'eng') return 'en';
  return languages.find(([, iso]) => iso === code)?.[0] || preferred;
}

async function select(language, base) {
  if (currentLanguage === language) return;
  engine ||= await loadModule();
  const buffers = await Promise.all(['aff','dic'].map(async ext => {
    const response = await fetch(new URL('spelling/' + language + '/index.' + ext, base));
    return dictionaryData(response, ext);
  }));
  const paths = [];
  try {
    for (const [i, ext] of ['aff','dic'].entries()) paths.push(engine.mountBuffer(buffers[i], 'index.' + ext));
    const next = engine.create(...paths);
    dictionary?.dispose();
    dictionary = next;
    currentLanguage = language;
  } finally {
    for (const path of paths) engine.unmount(path);
  }
}

async function respond({id, type, language, locales, sample, words, word, base}) {
  if (type === 'check') {
    const chosen = language === 'auto' ? detect(sample, locales) : language;
    await select(chosen, base);
    return {id, wrong:words.filter(value => !dictionary.spell(value.normalize().replaceAll('’', "'")))};
  }
  return {id, suggestions:dictionary.suggest(word.normalize().replaceAll('’', "'")).slice(0, 8)};
}

// Keep suggestions attached to the dictionary that completed the preceding scan.
let queue = Promise.resolve();
self.onmessage = ({data}) => {
  queue = queue.then(async () => {
    try { self.postMessage(await respond(data)); }
    catch { self.postMessage({id:data.id, error:true}); }
  });
};
