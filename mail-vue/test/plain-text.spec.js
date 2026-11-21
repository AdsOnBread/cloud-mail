import {expect,it} from 'vitest';
import {plainMarkup} from '../src/components/message-composer/plain-text';
it('preserves link destinations, block boundaries, quote prefixes and list items',()=>{
  const html='<div><b>Read</b> <a href="https://example.com/">notes</a></div><ol start="3"><li>One</li><li>Two</li></ol><blockquote>Earlier<br>reply</blockquote>';
  const converted=plainMarkup(html);
  expect(converted.text).toBe('Read notes <https://example.com/>\n3. One\n4. Two\n> Earlier\n> reply');
  expect(converted.content).not.toMatch(/<(?:a |b>|ol|li|blockquote)/);
  expect(plainMarkup(converted.content)).toEqual(converted);
});
it('preserves deliberate blank lines, literal markup and the editable signature',()=>{
 const converted=plainMarkup('<div>&lt;hello&gt;</div><div><br></div><div class="cloudmail-signature" data-signature-id="work"><strong>A &amp; B</strong></div>');
 expect(converted.text).toBe('<hello>\n\nA & B');
 expect(converted.content).toContain('data-signature-id="work"');
 expect(plainMarkup(converted.content)).toEqual(converted);
});

it('preserves distinct cells and rows when converting a pasted table',()=>{
  const result=plainMarkup('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>10</td><td>20</td></tr></tbody></table>');
  expect(result.text).toBe('A\tB\n10\t20');
});
