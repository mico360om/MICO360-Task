import { describe, it, expect } from 'vitest';
import { isRichEmpty, noteText, parseRichHtml, renderRichHtml, richToPlain, sanitizeRichHtml } from './rich-text';

describe('rich text: what is kept', () => {
  it('keeps bold, italic, underline, highlight, links, a heading and lists, written back in one fixed form', () => {
    const html =
      '<h2>Site works</h2><p>The <b>slab</b> is <i>ready</i>, <u>pour</u> on <mark>Monday</mark>. See <a href="https://example.com/plan">the plan</a>.</p>' +
      '<ul><li><p>Trucks booked</p></li><li>Pump on site</li></ul><ol><li>Check rebar</li><li>Pour</li></ol>';
    expect(sanitizeRichHtml(html)).toBe(
      '<h3>Site works</h3>' +
        '<p>The <strong>slab</strong> is <em>ready</em>, <u>pour</u> on <mark>Monday</mark>. See <a href="https://example.com/plan" target="_blank" rel="noopener noreferrer nofollow">the plan</a>.</p>' +
        '<ul><li><p>Trucks booked</p></li><li><p>Pump on site</p></li></ul><ol><li><p>Check rebar</p></li><li><p>Pour</p></li></ol>',
    );
  });

  it('writes its own output back unchanged', () => {
    const once = sanitizeRichHtml('<p><strong><em>Both</em></strong> and <a href="mailto:a@b.co">mail</a></p><ul><li><p>One</p><ul><li><p>Inner</p></li></ul></li></ul>');
    expect(sanitizeRichHtml(once)).toBe(once);
  });

  it('nests lists by level, and marks nested together', () => {
    const blocks = parseRichHtml('<ul><li>Top<ul><li>Inner <strong>bold <em>both</em></strong></li></ul></li><li>Next</li></ul>');
    expect(blocks).toEqual([
      { kind: 'item', ordered: false, level: 0, runs: [{ text: 'Top', marks: [] }] },
      { kind: 'item', ordered: false, level: 1, runs: [{ text: 'Inner ', marks: [] }, { text: 'bold ', marks: ['bold'] }, { text: 'both', marks: ['bold', 'italic'] }] },
      { kind: 'item', ordered: false, level: 0, runs: [{ text: 'Next', marks: [] }] },
    ]);
  });

  it('turns line breaks into breaks inside the paragraph and collapses spaces as a page would', () => {
    expect(parseRichHtml('<p>  First   line<br>second\n line  </p>')).toEqual([{ kind: 'paragraph', runs: [{ text: 'First line\nsecond line', marks: [] }] }]);
  });

  it('keeps Arabic text and its punctuation as it is', () => {
    expect(richToPlain(parseRichHtml('<p>مراجعة <strong>خطة</strong> السلامة، قبل يوم الاثنين</p>'))).toBe('مراجعة خطة السلامة، قبل يوم الاثنين');
  });
});

describe('rich text: what is never kept', () => {
  it('drops scripts, styles and frames with their content, and every attribute but a safe link', () => {
    const out = sanitizeRichHtml('<p onclick="x()" style="color:red">Hi<script>alert(1)</script><style>p{}</style><iframe src="https://evil"></iframe> <img src=x onerror=alert(1)>there</p>');
    expect(out).toBe('<p>Hi there</p>');
  });

  it('keeps only web and mail links; anything else stays as plain words', () => {
    expect(sanitizeRichHtml('<p><a href="javascript:alert(1)">Click</a> <a href=" data:text/html,x">Data</a> <a href="https://ok.example">OK</a></p>')).toBe(
      '<p>Click Data <a href="https://ok.example" target="_blank" rel="noopener noreferrer nofollow">OK</a></p>',
    );
  });

  it('keeps escaped markup as text, escaped again', () => {
    expect(sanitizeRichHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "quotes"</p>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "quotes"</p>');
  });

  it('reads pasted documents: unknown tags pass their words through, tables become lines', () => {
    const out = parseRichHtml('<div><span style="font-weight:bold">Agenda</span></div><table><tr><td>Item</td><td>Owner</td></tr><tr><td>Slab</td><td>Omar</td></tr></table>');
    expect(richToPlain(out)).toBe('Agenda\nItem Owner\nSlab Omar');
  });
});

describe('rich text: as plain words', () => {
  it('lists items with dashes or numbers (each list counting from 1), and links with their address', () => {
    const blocks = parseRichHtml(
      '<h3>Plan</h3><ol><li>Book trucks</li><li>Pour <a href="https://example.com/p">slab 2</a></li></ol><p>Then</p><ol><li>Cure</li></ol><ul><li>Note<ul><li>Inner</li></ul></li></ul><p><a href="https://example.com">https://example.com</a></p>',
    );
    expect(richToPlain(blocks)).toBe(
      ['Plan', '1. Book trucks', '2. Pour slab 2 (https://example.com/p)', 'Then', '1. Cure', '- Note', '  - Inner', 'https://example.com'].join('\n'),
    );
  });

  it('knows an empty note', () => {
    expect(isRichEmpty(parseRichHtml('<p></p><p>   </p><ul><li><p> </p></li></ul>'))).toBe(true);
    expect(isRichEmpty(parseRichHtml('<p>x</p>'))).toBe(false);
  });

  it('gives a note’s words whether it is plain or formatted', () => {
    expect(noteText({ body: 'Plain *text*', bodyFormat: 'PLAIN' })).toBe('Plain *text*');
    expect(noteText({ body: 'Plain' })).toBe('Plain');
    expect(noteText({ body: '<p><strong>Go</strong>-live moves</p>', bodyFormat: 'RICH' })).toBe('Go-live moves');
  });

  it('renders blocks it was handed (the model is the one source of truth)', () => {
    expect(renderRichHtml([{ kind: 'paragraph', runs: [{ text: 'a < b', marks: ['highlight'] }] }])).toBe('<p><mark>a &lt; b</mark></p>');
  });
});
