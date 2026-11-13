import { describe, it, expect } from 'vitest';
import { fileDoc, inspectionDoc, meetingDoc, minutesDoc, noteDoc, projectDoc, vocabularyWords } from './search-docs';

describe('search documents (normalised as text-normalize folds a query)', () => {
  it('a project: code, number and name are its head; description its lead; client and notes after', () => {
    const d = projectDoc({ code: 'RIG', number: 'C-2026/14', name: 'Rig Overhaul', description: 'Shut-down of Rig 3', clientName: 'NWT', notes: 'Crane booked' });
    expect(d.head).toBe('\nrig\nc-2026/14\nrig overhaul');
    expect(d.lead).toBe('shut-down of rig 3');
    expect(d.doc.split('\n')).toEqual(['', 'rig', 'c-2026/14', 'rig overhaul', 'shut-down of rig 3', 'nwt', 'crane booked']);
  });

  it('a meeting: its invitee text (title, description, agenda, place, people) and its full text (+ decisions, action items)', () => {
    const d = meetingDoc({
      title: 'Weekly Safety Review',
      description: 'Walk-down findings',
      location: 'Site office',
      category: 'Safety',
      agenda: ['Hot work permits'],
      people: ['Bilal Ahmed', 'Khalid (guest)'],
      decisions: [{ title: 'Stop night lifts', description: 'Until lighting is fixed' }],
      actionItems: ['Order flood lights'],
    });
    expect(d.head).toBe('\nweekly safety review');
    expect(d.limited).toContain('hot work permits');
    expect(d.limited).toContain('bilal ahmed');
    expect(d.limited).not.toContain('stop night lifts');
    expect(d.limited).not.toContain('order flood lights');
    expect(d.doc).toContain('stop night lifts');
    expect(d.doc).toContain('order flood lights');
  });

  it('a note: its words (a formatted note’s text without markup), comments and checklist; no title', () => {
    const d = noteDoc({ body: '<p>Gas test <strong>before</strong> entry</p>', bodyFormat: 'RICH', comments: ['Done at 08:00'], checklist: ['Sign the permit'] });
    expect(d.head).toBe('\n');
    expect(d.lead).toBe('gas test before entry');
    expect(d.doc).toContain('done at 08:00');
    expect(d.doc).toContain('sign the permit');
  });

  it('final minutes: summary first, then discussion, decisions, risks and next steps', () => {
    const d = minutesDoc({ summary: 'Agreed the shutdown plan', discussion: [{ topic: 'Scaffolding', text: 'Tag all scaffolds' }], decisions: ['Start on 9 Nov'], risks: ['Rain'], nextSteps: ['Send the plan'] });
    expect(d.lead).toBe('agreed the shutdown plan');
    for (const w of ['scaffolding', 'tag all scaffolds', 'start on 9 nov', 'rain', 'send the plan']) expect(d.doc).toContain(w);
  });

  it('a file: its name is its head, its text the lead (Arabic folded)', () => {
    const d = fileDoc({ filename: 'Permit-تصريح.pdf', text: 'سلامةُ العمال أولاً' });
    expect(d.head).toBe('\npermit-تصريح.pdf');
    expect(d.lead).toBe('سلامه العمال اولا');
  });

  it('an inspection: title, then description, place, its checklist and the answers’ notes, its task', () => {
    const d = inspectionDoc({
      title: 'Crane pre-use check',
      description: null,
      place: 'Rig 3',
      structure: { sections: [{ id: 's', title: 'Hooks', items: [{ id: 'i', kind: 'CHECK', label: 'Safety latch works', help: null }] }] },
      answers: [{ note: 'Latch spring weak', reading: null }],
      task: { key: 'RIG-12', title: 'Weekly crane check' },
    });
    expect(d.head).toBe('\ncrane pre-use check');
    for (const w of ['rig 3', 'hooks', 'safety latch works', 'latch spring weak', 'rig-12', 'weekly crane check']) expect(d.doc).toContain(w);
  });

  it('vocabulary words (of a normalised text): letters only, 3 to 40 of them, each once', () => {
    expect(vocabularyWords('\nscaffold scaffold\nrig-12 ab generator مضخه 2026')).toEqual(['scaffold', 'rig', 'generator', 'مضخه']);
  });
});
