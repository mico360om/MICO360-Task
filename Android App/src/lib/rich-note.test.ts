import { describe, it, expect } from 'vitest';
import { listMarkers, noteWords, parseRichNote } from './rich-note';

/**
 * The server keeps a formatted note in one fixed HTML form (Web Portal/backend/src/lib/rich-text.ts
 * renderRichHtml): <p>, <h3>, <ul>/<ol> with <li><p>, <strong>, <em>, <u>, <mark>, <a href> and
 * <br>, every piece of text escaped. These are notes in that form.
 */
describe('parseRichNote', () => {
  it('reads paragraphs with bold, italic, underline and highlight, and the escaped characters', () => {
    expect(parseRichNote('<p><strong>Budget</strong> approved &amp; <em>signed</em></p><p><mark><u>key</u></mark> &lt;b&gt; &quot;x&quot; &#39;y&#39;</p>')).toEqual([
      {
        kind: 'paragraph',
        runs: [
          { text: 'Budget', marks: ['bold'] },
          { text: ' approved & ', marks: [] },
          { text: 'signed', marks: ['italic'] },
        ],
      },
      {
        kind: 'paragraph',
        runs: [
          { text: 'key', marks: ['underline', 'highlight'] },
          { text: ' <b> "x" \'y\'', marks: [] },
        ],
      },
    ]);
  });

  it('reads a heading, bulleted and numbered lists (nested), and links', () => {
    const html =
      '<h3>Next steps</h3><ul><li><p>Call <a href="https://example.com/c" target="_blank" rel="noopener noreferrer nofollow">the client</a></p></li>' +
      '<li><p>Send</p><ol><li><p>one</p></li><li><p>two</p></li></ol></li></ul><p>After</p>';
    const blocks = parseRichNote(html);
    expect(blocks).toEqual([
      { kind: 'heading', runs: [{ text: 'Next steps', marks: [] }] },
      { kind: 'item', ordered: false, level: 0, runs: [{ text: 'Call ', marks: [] }, { text: 'the client', marks: [], href: 'https://example.com/c' }] },
      { kind: 'item', ordered: false, level: 0, runs: [{ text: 'Send', marks: [] }] },
      { kind: 'item', ordered: true, level: 1, runs: [{ text: 'one', marks: [] }] },
      { kind: 'item', ordered: true, level: 1, runs: [{ text: 'two', marks: [] }] },
      { kind: 'paragraph', runs: [{ text: 'After', marks: [] }] },
    ]);
    expect(listMarkers(blocks)).toEqual([null, '•', '•', '1.', '2.', null]);
  });

  it('keeps line breaks, and runs spaces together as on a web page', () => {
    expect(parseRichNote('<p>line  one<br>line two </p>')).toEqual([{ kind: 'paragraph', runs: [{ text: 'line one\nline two', marks: [] }] }]);
  });

  it('never keeps an unsafe link, and leaves out what isn’t written text', () => {
    expect(parseRichNote('<p><a href="javascript:alert(1)">tap</a></p>')).toEqual([{ kind: 'paragraph', runs: [{ text: 'tap', marks: [] }] }]);
    expect(parseRichNote('<script>steal()</script><style>p{}</style><p>ok</p>')).toEqual([{ kind: 'paragraph', runs: [{ text: 'ok', marks: [] }] }]);
    expect(parseRichNote('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')[0]!.runs[0]!.text).toBe('<script>alert(1)</script>');
  });

  it('copes with text outside a paragraph, unknown tags and numbered entities', () => {
    expect(parseRichNote('plain <span>words</span>&#x2014;&#8212;&nbsp;end')).toEqual([{ kind: 'paragraph', runs: [{ text: 'plain words—— end', marks: [] }] }]);
    expect(parseRichNote('')).toEqual([]);
    expect(parseRichNote('<p> </p>')).toEqual([]);
  });

  it('numbers each list from 1, and carries on a level when coming back to it (as the server and website count)', () => {
    const blocks = parseRichNote('<ol><li><p>a</p><ul><li><p>x</p></li></ul></li><li><p>b</p></li></ol><p>then</p><ol><li><p>again</p></li></ol>');
    expect(listMarkers(blocks)).toEqual(['1.', '•', '2.', null, '1.']);
  });
});

describe('noteWords (what TalkBack reads)', () => {
  it('gives a plain note as it was written', () => {
    expect(noteWords({ body: 'Line one\nLine two', bodyFormat: 'PLAIN' })).toBe('Line one\nLine two');
    expect(noteWords({ body: '<b>not html</b>' })).toBe('<b>not html</b>');
  });

  it('gives a formatted note’s words, with list markers and a link’s address', () => {
    expect(noteWords({ body: '<p>See <a href="https://example.com/d">the doc</a></p><ul><li><p>one</p></li></ul><ol><li><p>first</p></li></ol>', bodyFormat: 'RICH' })).toBe(
      'See the doc (https://example.com/d)\n- one\n1. first',
    );
  });
});
