/**
 * 1.23.10 PDF standard — pagination across every PDF (seeded samples): a heading never ends a page
 * (orphan heading), no page is blank, and nothing is set under 7.5 pt.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { inspectPdf } from '../../../src/lib/pdf-inspect';
import { PDF_STANDARD } from '../../../src/lib/pdf-document';
import { SAMPLE_NAMES, WIDE_SAMPLE_NAMES, samplePdfs, samplePictures, wideSamplePdfs, type SamplePictures, type WideSampleName } from './samples';

let pictures: SamplePictures;
beforeAll(async () => {
  pictures = await samplePictures();
});

/** A heading: a part (12 pt), a section heading (11 pt) or a sub-heading (10 pt), in the semibold face. */
const isHeading = (l: { size: number; fonts: string[] }) => [PDF_STANDARD.type.part, PDF_STANDARD.type.heading, PDF_STANDARD.type.subheading].includes(l.size as never) && l.fonts.some((f) => /SemiBold|Bold/.test(f));

describe('page furniture (review, 1.23.10)', () => {
  it('every later page names the project in its running header (task, minutes, inspection)', () => {
    const pdfs = samplePdfs(pictures);
    for (const [name, project] of [['task-full', 'Rig 3 Overhaul'], ['minutes', 'Rig 3 Overhaul'], ['inspection', 'Rig 3 Overhaul']] as const) {
      const { lines } = inspectPdf(pdfs[name]());
      expect(lines.length, name).toBeGreaterThan(1);
      for (const page of lines.slice(1)) expect(page.filter((l) => l.artifact && l.y < 100).map((l) => l.text).join(' '), name).toContain(project);
    }
  });

  it('a copy shared with a client says when it was printed, never by whom', () => {
    const pdfs = samplePdfs(pictures);
    for (const name of ['client-minutes', 'client-task-list'] as const) {
      const footer = inspectPdf(pdfs[name]()).lines.flat().filter((l) => l.artifact).map((l) => l.text);
      expect(footer.some((t) => t.startsWith('Printed 10 Nov 2026')), name).toBe(true);
      expect(footer.join(' '), name).not.toMatch(/\bby\b/);
      expect(footer, name).toContain('Shared with you through MICO360 Tasks');
    }
  });
});

describe('a table too wide for a portrait page (review, 1.23.10)', () => {
  const firstHeader: Record<WideSampleName, string> = { 'report-wide': 'Key', 'mico-ai-wide': 'Certificate1' };
  for (const name of WIDE_SAMPLE_NAMES) {
    it(`${name}: turns landscape without leaving page 1 nearly empty — the table starts on page 1`, () => {
      const pdf = wideSamplePdfs(pictures)[name]();
      const { lines } = inspectPdf(pdf);
      expect(lines[0]!.filter((l) => !l.artifact).map((l) => l.text)).toContain(firstHeader[name]);
      expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
      lines.forEach((page, i) => expect(page.filter((l) => !l.artifact).length, `page ${i + 1}`).toBeGreaterThan(0));
    });
  }
});

describe('every PDF paginates cleanly', () => {
  for (const name of SAMPLE_NAMES) {
    it(`${name}: no page ends with a heading, no page is blank, no type under 7.5 pt`, () => {
      const { lines } = inspectPdf(samplePdfs(pictures)[name]());
      lines.forEach((page, i) => {
        const body = page.filter((l) => !l.artifact);
        expect(body.length, `page ${i + 1} has content`).toBeGreaterThan(0);
        if (i < lines.length - 1) {
          const last = body.reduce((a, b) => (b.y > a.y ? b : a));
          expect(isHeading(last), `page ${i + 1} ends with the heading "${last.text}"`).toBe(false);
        }
        for (const l of page) expect(l.size, l.text).toBeGreaterThanOrEqual(PDF_STANDARD.type.min);
      });
    });
  }
});
