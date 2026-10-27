import { describe, it, expect, beforeAll } from 'vitest';
import { inspectPdf } from '../../lib/pdf-inspect';
import { blankPng } from '../../lib/test-images';
import type { ClientInspection, ClientInspectionItem } from './inspection-client-copy';
import { buildInspectionPdf, inspectionPdfFileName, type InspectionReportData } from './inspection-report-pdf';

const brand = {
  productName: 'MICO360 Tasks',
  companyName: 'MICO360 Softwares',
  websiteUrl: 'https://mico360.example',
  supportEmail: 'info@mico360.example',
  companyAddress: 'MICO360, Muscat, Oman',
  colors: { brand: '#8B1E1E', ink: '#211B1A', muted: '#6C625F', line: '#E6DFDC' },
};
const project = { name: 'Rig 3 overhaul', code: 'RIG', number: 'C-77', clientName: 'Oman Drilling Co.', color: '#1E6B8B', icon: null, image: null };

let drawn = '';
beforeAll(async () => {
  drawn = `data:image/png;base64,${(await blankPng(300, 100)).toString('base64')}`;
});

const check = (label: string, result: string | null, note: string | null = null): ClientInspectionItem => ({ label, kind: 'CHECK', result, reading: null, limits: null, note });
const reading = (label: string, value: string | null, limits: string | null, result: string | null, note: string | null = null): ClientInspectionItem => ({ label, kind: 'READING', result, reading: value, limits, note });

function report(over: Partial<ClientInspection> = {}): ClientInspection {
  return {
    id: 'insp-1',
    title: 'Rig daily check',
    date: '2026-10-27',
    place: 'Rig 3, north deck',
    counts: { total: 4, passed: 2, failed: 2, na: 0 },
    result: '2 failed',
    sections: [
      { title: 'Well head', items: [reading('Pressure', '162.5 psi', '0–150 psi', 'Fail', 'Gauge read high twice.'), check('Valves closed', 'Pass')] },
      { title: 'Deck', items: [reading('Air temperature', '3.25 °C', '-10 to 5 °C', 'Pass'), check('Guard rails fitted', 'Fail', 'One rail loose at the stairs.')] },
    ],
    signatures: [{ role: 'Inspector', name: 'Ivan Inspector', signedAt: '2026-10-27T08:30:00.000Z', signedOn: '27 Oct 2026, 12:30', image: drawn, typed: false }],
    unsigned: [],
    revisionNumber: 1,
    reopenedOn: null,
    ...over,
  };
}

const staff = { inspector: 'Ivan Inspector (staff account)', startedAt: '2026-10-27T08:00:00.000Z', finishedAt: '2026-10-27T08:31:00.000Z', task: 'RIG-12 · Inspect rig 3', followUps: [['RIG-41', null], [null, 'RIG-42']] };

const data = (over: Partial<InspectionReportData> = {}): InspectionReportData => ({ brand, project, report: report(), timeZone: 'Asia/Muscat', generatedAt: '2026-10-27T09:00:00.000Z', ...over });
const textOf = (d: InspectionReportData) => inspectPdf(buildInspectionPdf(d)).pages.flat().join('\n');

describe('the inspection report PDF', () => {
  it('is a PDF headed by the project, with the form’s title, its date and place', () => {
    const pdf = buildInspectionPdf(data());
    expect(pdf.toString('latin1').startsWith('%PDF-1.')).toBe(true);
    const text = textOf(data());
    for (const s of ['INSPECTION REPORT', 'Rig 3 overhaul', 'RIG', 'Project no. C-77', 'Oman Drilling Co.', 'Rig daily check', '27 Oct 2026', 'Rig 3, north deck']) expect(text).toContain(s);
  });

  it('leaves the place out when there is none', () => {
    const text = textOf(data({ report: report({ place: null }) }));
    expect(text).not.toContain('Place');
  });

  it('has a summary of the counts, in words as well as colour', () => {
    const text = textOf(data());
    for (const s of ['Passed', 'Failed', 'N/A', 'Items', '2 ITEMS FAILED']) expect(text).toContain(s);
    const passed = textOf(data({ report: report({ counts: { total: 4, passed: 3, failed: 0, na: 1 }, result: 'Passed', sections: [{ title: 'A', items: [check('One', 'Pass'), check('Two', 'Pass'), check('Three', 'Pass'), check('Four', 'N/A')] }] }) }));
    expect(passed).toContain('PASSED');
    expect(passed).not.toContain('Failed items');
  });

  it('lists the failed items near the top, and marks each failed row FAIL (bold, not by colour alone)', () => {
    const pdf = inspectPdf(buildInspectionPdf(data()));
    const lines = pdf.pages.flat();
    const failedAt = lines.indexOf('Failed items (2)');
    expect(failedAt).toBeGreaterThan(-1);
    expect(failedAt).toBeLessThan(lines.indexOf('Well head'));
    const fails = pdf.lines.flat().filter((l) => l.text === 'FAIL');
    expect(fails.length).toBeGreaterThanOrEqual(2);
    for (const l of fails) expect(l.fonts.some((f) => /SemiBold|Bold/.test(f))).toBe(true);
    const passes = pdf.lines.flat().filter((l) => l.text === 'Pass');
    expect(passes.length).toBe(2);
    for (const l of passes) expect(l.fonts.every((f) => !/SemiBold|Bold/.test(f))).toBe(true);
  });

  it('prints each item’s result, reading with its unit and decimals, its limits and its note', () => {
    const text = textOf(data());
    for (const s of ['Well head', 'Deck', 'Pressure', '162.5 psi', '0–150 psi', 'Gauge read high twice.', 'Valves closed', 'Air temperature', '3.25 °C', '-10 to 5 °C', 'Guard rails fitted', 'One rail loose at the stairs.']) expect(text).toContain(s);
  });

  it('carries the signatures: drawn ones as pictures with name and time, typed ones in words, a missing optional one as not signed', () => {
    const d = data({
      report: report({
        signatures: [
          { role: 'Inspector', name: 'Ivan Inspector', signedAt: '2026-10-27T08:30:00.000Z', signedOn: '27 Oct 2026, 12:30', image: drawn, typed: false },
          { role: 'Supervisor', name: 'Sara Al Hinai', signedAt: '2026-10-27T08:32:00.000Z', signedOn: '27 Oct 2026, 12:30', image: null, typed: true },
        ],
      }),
      unsigned: ['Client'],
    });
    const pdf = buildInspectionPdf(d);
    const text = inspectPdf(pdf).pages.flat().join('\n');
    expect(text).toContain('Signatures');
    expect(text).toMatch(/Inspector: .*Ivan Inspector/);
    expect(text).toMatch(/27 Oct 2026, 12:30/);
    expect(text).toMatch(/Supervisor: .*Sara Al Hinai/);
    expect(text).toContain('typed name');
    expect(text).toMatch(/Client: Not signed/);
    // In role order, given or not: inspector, client, supervisor.
    const at = (re: RegExp) => text.search(re);
    expect(at(/Inspector: .*Ivan Inspector · signed/)).toBeLessThan(at(/Client: Not signed/));
    expect(at(/Client: Not signed/)).toBeLessThan(at(/Supervisor: .*Sara Al Hinai/));
    // The drawn signature is an image in the file.
    expect(pdf.toString('latin1')).toMatch(/\/Subtype \/Image/);
  });

  it('takes the signatures not given from the report itself', () => {
    expect(textOf(data({ report: report({ unsigned: ['Supervisor'] }) }))).toContain('Supervisor: Not signed');
  });

  it('says so when a signature picture can’t be shown', () => {
    const text = textOf(data({ report: report({ signatures: [{ role: 'Inspector', name: 'Ivan', signedAt: '2026-10-27T08:30:00.000Z', signedOn: '27 Oct 2026, 12:30', image: 'data:image/png;base64,bm90IGEgcG5n', typed: false }] }) }));
    expect(text).toContain('signature image could not be shown');
    expect(text).toMatch(/Inspector: .*Ivan/);
  });

  it('the staff copy names the inspector, the attached task, the follow-up tasks and who made it', () => {
    const text = textOf(data({ staff, generatedBy: 'Olivia Owner' }));
    for (const s of ['Ivan Inspector (staff account)', 'RIG-12 · Inspect rig 3', 'RIG-41', 'RIG-42', 'Olivia Owner', 'Generated']) expect(text).toContain(s);
  });

  it('the client copy carries no staff names but the signers’, no tasks, no follow-ups, not who made it', () => {
    const text = textOf(data({ generatedBy: 'Olivia Owner' }));
    for (const s of ['Ivan Inspector (staff account)', 'RIG-12', 'RIG-41', 'RIG-42', 'Olivia Owner', 'Generated', 'Follow-up', 'For task', 'Started', 'Finished']) expect(text, s).not.toContain(s);
    expect(text).toContain('Ivan Inspector');
    expect(text).toContain('Shared with you through MICO360 Tasks');
  });

  it('sets Arabic labels, notes and names as joined right-to-left text', () => {
    const text = textOf(
      data({
        report: report({
          title: 'فحص الحفارة اليومي',
          sections: [{ title: 'رأس البئر', items: [check('الصمامات مغلقة', 'Fail', 'تسرب بسيط عند الصمام الرئيسي')] }],
          counts: { total: 1, passed: 0, failed: 1, na: 0 },
          result: '1 failed',
          signatures: [{ role: 'Inspector', name: 'عمر أحمد', signedAt: '2026-10-27T08:30:00.000Z', signedOn: '27 Oct 2026, 12:30', image: null, typed: true }],
        }),
      }),
    );
    for (const s of ['فحص الحفارة اليومي', 'رأس البئر', 'الصمامات مغلقة', 'تسرب بسيط عند الصمام الرئيسي', 'عمر أحمد']) expect(text).toContain(s);
  });

  it('prints a long note in full: its start in the cell, all of it wrapped under its section', () => {
    const words = Array.from({ length: 300 }, (_, i) => `word${i}`);
    const note = words.join(' ').slice(0, 2000);
    const pdf = inspectPdf(buildInspectionPdf(data({ report: report({ sections: [{ title: 'Deck', items: [check('Guard rails fitted', 'Fail', note)] }] }) })));
    const all = pdf.pages.flat().join(' ');
    const kept = note.split(' ');
    for (const w of [kept[0]!, kept[100]!, kept[kept.length - 1]!]) expect(all).toContain(w);
    // It wrapped onto many lines.
    expect(pdf.lines.flat().filter((l) => /word\d+/.test(l.text)).length).toBeGreaterThan(10);
  });

  it('200 items: every row is there, the header row repeats on each page, and every page says Page N of M', () => {
    const sections = Array.from({ length: 4 }, (_, s) => ({
      title: `Section ${s + 1}`,
      items: Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? reading(`Gauge ${s + 1}.${i + 1}`, `${i}.5 bar`, '0–40 bar', i > 40 ? 'Fail' : 'Pass') : check(`Check ${s + 1}.${i + 1}`, i % 7 === 0 ? 'Fail' : 'Pass'))),
    }));
    const pdf = inspectPdf(buildInspectionPdf(data({ staff, report: report({ sections, counts: { total: 200, passed: 160, failed: 40, na: 0 }, result: '40 failed' }) })));
    const pages = pdf.pages;
    expect(pages.length).toBeGreaterThan(3);
    const all = pages.flat();
    for (let s = 1; s <= 4; s++) for (let i = 1; i <= 50; i++) expect(all.some((l) => l === `Check ${s}.${i}` || l === `Gauge ${s}.${i}`), `${s}.${i}`).toBe(true);
    pages.forEach((p, i) => expect(p).toContain(`Page ${i + 1} of ${pages.length}`));
    // Each page with item rows has a table's header row on it: the checklist's ("Result") or the failed list's ("Section").
    for (const p of pages) if (p.some((l) => /^(Check|Gauge) \d/.test(l))) expect(p.includes('Result') || p.includes('Section')).toBe(true);
    // The checklist's header repeats: once per section at least, and on the pages a section runs on to.
    expect(pages.flat().filter((l) => l === 'Result').length).toBeGreaterThan(4);
    // Later pages carry the running title.
    expect(pages[1]!.some((l) => l.includes('Rig daily check'))).toBe(true);
  });

  it('names its file after the form and the day', () => {
    expect(inspectionPdfFileName('Rig daily check', '2026-10-27')).toBe('inspection-rig-daily-check-2026-10-27.pdf');
    expect(inspectionPdfFileName('فحص الحفارة', '2026-10-27')).toBe('inspection-2026-10-27.pdf');
  });

  it('says which revision a reopened report is, and when (the staff copy also by whom)', () => {
    const reopened = report({ revisionNumber: 2, reopenedOn: '2026-10-28' });
    const client = textOf(data({ report: reopened }));
    expect(client).toContain('Revision 2 · reopened on 28 Oct 2026');
    expect(client).not.toContain(' by Mona');
    const staffCopy = textOf(data({ report: reopened, staff: { ...staff, reopenedBy: 'Mona Manager', earlierRevisions: [{ number: 1, reopenedAt: '2026-10-28T06:00:00.000Z', signatures: [{ role: 'Inspector', name: 'Ivan Inspector', signedAt: '2026-10-27T08:30:00.000Z' }] }] } }));
    expect(staffCopy).toContain('Revision 2 · reopened on 28 Oct 2026 by Mona Manager');
    expect(staffCopy).toContain('Earlier signed revisions');
    expect(staffCopy).toMatch(/Revision 1 · reopened 28 Oct 2026, 10:00/);
    expect(staffCopy).toMatch(/Inspector: Ivan Inspector · signed 27 Oct 2026, 12:30/);
    expect(client).not.toContain('Earlier signed revisions');
  });

  it('says nothing about revisions for a report never reopened', () => {
    expect(textOf(data())).not.toMatch(/Revision \d/);
  });
});
