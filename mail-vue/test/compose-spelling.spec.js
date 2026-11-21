import {expect, it} from 'vitest';
import {dictionaryData} from '../src/components/tiny-editor/spelling/dictionary-data';
import {collectWords, liveWords, replaceWord} from '../src/components/tiny-editor/spelling/words';
import {languages, preferredDictionary} from '../src/components/tiny-editor/spelling/languages';

function editor(html) {
  const body = document.createElement('div');
  body.innerHTML = html;
  return body;
}

it('finds a whole styled word but skips addresses, web links, photos and quoted history', () => {
  const body = editor('<div>Write <i>sp</i>eling to pat@example.org at https://example.test/something.</div><div>two<img src="photo.png">words</div><div class="cloudmail-reply-quote">earlier text</div>');
  expect(collectWords(body).map(item => item.word)).toEqual(['Write','speling','to','at','two','words']);
});

it('preserves surrounding whitespace and style runs when correcting typed text', () => {
  const body = editor(' Try <b>ex</b>amp<i>el</i> here ');
  const item = collectWords(body).find(item => item.word === 'exampel');
  const caret = replaceWord(item.range, 'example');
  expect(body.textContent).toBe(' Try example here ');
  expect(body.querySelector('b').textContent).toBe('ex');
  expect(body.querySelector('i').textContent.length).toBeGreaterThan(0);
  expect(caret.collapsed).toBe(true);
});

it('keeps untouched highlights and rejects a corrected word or an outdated prefix', () => {
  const body = editor('<div>exampl</div><div>othr</div>');
  const initial = collectWords(body);
  body.firstChild.firstChild.appendData('e');
  expect(liveWords(body, initial)).toEqual([initial[1]]);
  body.lastChild.firstChild.insertData(0,'an');
  expect(liveWords(body, initial)).toEqual([]);
});

it('honors regional dictionary preferences in browser language order', () => {
  expect(preferredDictionary(['ja','en-AU'])).toBe('en-gb');
  expect(preferredDictionary(['pt-PT','en-US'])).toBe('pt-pt');
  expect(preferredDictionary(['pt-BR'])).toBe('pt');
  expect(languages).toHaveLength(new Set(languages.map(([id]) => id)).size);
});

it('rejects a fallback page and accepts a word count with a dictionary producer comment', async () => {
  await expect(dictionaryData(new Response('<html>Sign in</html>'), 'dic')).rejects.toThrow();
  await expect(dictionaryData(new Response('Not an affix file'), 'aff')).rejects.toThrow();
  await expect(dictionaryData(new Response('2 # producer\none\ntwo'), 'dic')).resolves.toBeInstanceOf(Uint8Array);
});
