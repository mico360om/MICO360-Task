/**
 * 1.23.10 PDF standard — pagination across every PDF (seeded samples): a heading never ends a page
 * (orphan heading), no page is blank, and nothing is set under 7.5 pt.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { inspectPdf } from '../../../src/lib/pdf-inspect';
import { PDF_STANDARD } from '../../../src/lib/pdf-document';
import { SAMPLE_NAMES, samplePdfs, samplePictures, type SamplePictures } from './samples';

let pictures: SamplePictures;
beforeAll(async () => {
  pictures = await samplePictures();
});

/** A heading: a part (12 pt), a section heading (11 pt) or a sub-heading (10 pt), in the semibold face. */
const isHeading = (l: { size: number; fonts: string[] }) => [PDF_STANDARD.type.part, PDF_STANDARD.type.heading, PDF_STANDARD.type.subheading].includes(l.size as never) && l.fonts.some((f) => /SemiBold|Bold/.test(f));

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
