/**
 * 1.23.10 PDF standard — "Preserve all existing data and document content" (owner, 10 Nov).
 *
 * For each of the nine PDFs (and a task with everything), the text of the render made before the
 * standard (before-text.json, from the same seeded samples) is checked against a render made now:
 *   - every line of the old body is still in the new body, in order within the line (wrapping and
 *     page breaks may differ, so spaces are ignored);
 *   - the lines that moved (the "Generated … by …" credit became the footer's "Printed … by …") are
 *     there in their new words;
 *   - only the task PDF's empty optional sections are left out (design call 1), named below;
 *   - every piece of the old footers (company, website, address, "Shared with you through …") is
 *     still on the page, the old running title too when the new PDF has a second page;
 *   - no PDF has more pages than before; every page says "Page X of Y".
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { inspectPdf } from '../../../src/lib/pdf-inspect';
import before from './before-text.json';
import { SAMPLE_NAMES, samplePdfs, samplePictures, type SampleName, type SamplePictures } from './samples';

type Before = { pages: number; body: string[]; footer: string[]; running: string[] };
const BEFORE = before as Record<SampleName, Before>;

/** Spaces, line breaks and bidi marks are layout, not content. */
const norm = (s: string) => s.replace(/[\s‎‏؜⁦-⁩]/g, '');

const TASK_PRINTED = 'Printed 10 Nov 2026, 20:23 by Khurram Mumtaz';
const PRINTED = 'Printed 10 Nov 2026, 14:05 by Khurram Mumtaz';
/** Old lines (body or footer) whose values now read differently, and the words that carry them. */
const MOVED: Partial<Record<SampleName, Record<string, string[]>>> = {
  task: {
    'Generated 10 Nov 2026, 20:23 (Asia/Muscat) by Khurram Mumtaz': [TASK_PRINTED],
    'Prolens Projects LLC · MICO360 Tasks · Generated 10 Nov 2026, 20:23 (Asia/Muscat) by Khurram Mumtaz': ['Prolens Projects LLC', TASK_PRINTED],
  },
  'task-full': {
    'Generated 10 Nov 2026, 20:23 (Asia/Muscat) by Khurram Mumtaz': [TASK_PRINTED],
    'Prolens Projects LLC · MICO360 Tasks · Generated 10 Nov 2026, 20:23 (Asia/Muscat) by Khurram Mumtaz': ['Prolens Projects LLC', TASK_PRINTED],
  },
  report: {
    'Generated 10 Nov 2026, 14:05 (Asia/Muscat) by Khurram Mumtaz': [PRINTED],
    'Prolens Projects LLC · MICO360 Tasks · Generated 10 Nov 2026, 14:05 (Asia/Muscat) by Khurram Mumtaz': ['Prolens Projects LLC', PRINTED],
  },
  management: {
    'Generated 10 Nov 2026, 14:05 (Asia/Muscat) by Khurram Mumtaz': [PRINTED],
    'Prolens Projects LLC · MICO360 Tasks · Generated 10 Nov 2026, 14:05 (Asia/Muscat) by Khurram Mumtaz': ['Prolens Projects LLC', PRINTED],
  },
  'mico-ai': {
    'Generated 10 Nov 2026, 14:05 (Asia/Muscat) by Khurram Mumtaz': [PRINTED],
    'Prolens Projects LLC · MICO360 Tasks · MICO AI report · Generated 10 Nov 2026, 14:05 (Asia/Muscat) by Khurram Mumtaz': ['Prolens Projects LLC', 'MICO AI report', PRINTED],
  },
  minutes: { 'Generated 10 Nov 2026, 14:05 by Khurram Mumtaz · MICO360 Tasks': [PRINTED] },
  // "Inspection report" is the header's eyebrow on every copy.
  inspection: { 'MICO360 Tasks · Inspection report · Generated 10 Nov 2026, 14:05 (Asia/Muscat) by Khurram Mumtaz': ['INSPECTION REPORT', PRINTED] },
};

/** The task PDF's optional sections with nothing in them (design call 1: no empty sections). */
const DROPPED: Partial<Record<SampleName, string[]>> = {
  task: ['External contacts', 'No external contacts.', 'Checklist', 'No checklist items.', 'Attachments', 'No attachments.', 'Dependencies', 'No dependencies.'],
};

let pictures: SamplePictures;
beforeAll(async () => {
  pictures = await samplePictures();
});

describe('every PDF keeps all of its content under the 1.23.10 standard', () => {
  for (const name of SAMPLE_NAMES) {
    it(`${name}: every value is still there, nothing is cut, no more pages than before`, () => {
      const old = BEFORE[name];
      const { lines } = inspectPdf(samplePdfs(pictures)[name]());
      const all = lines.flat();
      const body = norm(all.filter((l) => !l.artifact).map((l) => l.text).join(''));
      const everything = norm(all.map((l) => l.text).join(''));
      const moved = MOVED[name] ?? {};
      const dropped = new Set(DROPPED[name] ?? []);

      const missing: string[] = [];
      for (const line of old.body) {
        if (moved[line]) {
          for (const now of moved[line]) if (!everything.includes(norm(now))) missing.push(`${line} → ${now}`);
        } else if (!dropped.has(line) && !body.includes(norm(line))) missing.push(line);
      }
      for (const line of old.footer) {
        const pieces = moved[line] ?? line.split(/\s+·\s+/);
        for (const piece of pieces) if (!everything.includes(norm(piece))) missing.push(`footer: ${piece}`);
      }
      if (lines.length > 1) for (const t of old.running) if (!everything.includes(norm(t))) missing.push(`running: ${t}`);
      expect(missing).toEqual([]);
      // Nothing is shortened with "…" that wasn't before.
      expect(all.filter((l) => l.text.includes('…')).length).toBeLessThanOrEqual(old.body.filter((t) => t.includes('…')).length);
      expect(lines.length).toBeLessThanOrEqual(old.pages);
      lines.forEach((page, i) => expect(page.filter((l) => l.artifact).map((l) => l.text)).toContain(`Page ${i + 1} of ${lines.length}`));
    });
  }
});
