import { describe, it, expect } from 'vitest';
import { noteWords, plainToRichHtml, richPlainText } from './rich-note';

describe('rich notes as plain words', () => {
  it('gives paragraphs as lines, list items with dashes or numbers, links with their address', () => {
    const html =
      '<h3>Plan</h3><ol><li><p>Book</p></li><li><p>Pour <a href="https://x.co/p">slab</a></p></li></ol>' +
      '<ul><li><p>Note</p><ul><li><p>Inner</p></li></ul></li></ul><p>Line<br>break <a href="https://x.co">https://x.co</a></p>';
    expect(richPlainText(html)).toBe(['Plan', '1. Book', '2. Pour slab (https://x.co/p)', '- Note', '  - Inner', 'Line', 'break https://x.co'].join('\n'));
  });

  it('never runs or shows markup it is given', () => {
    expect(richPlainText('<p>Hi<script>alert(1)</script> <img src=x onerror="alert(1)">there</p>')).toBe('Hi there');
  });

  it('gives a note’s words whether it is plain or formatted', () => {
    expect(noteWords({ body: 'Plain <b>as typed</b>', bodyFormat: 'PLAIN' })).toBe('Plain <b>as typed</b>');
    expect(noteWords({ body: 'No format given' })).toBe('No format given');
    expect(noteWords({ body: '<p><strong>Go</strong>-live moves</p>', bodyFormat: 'RICH' })).toBe('Go-live moves');
  });
});

describe('plain text into the editor', () => {
  it('makes each line a paragraph, escaping what could be read as markup', () => {
    expect(plainToRichHtml('Line one\nLine <two> & "three"\n\nAfter a gap')).toBe('<p>Line one</p><p>Line &lt;two&gt; &amp; "three"</p><p></p><p>After a gap</p>');
  });
});
