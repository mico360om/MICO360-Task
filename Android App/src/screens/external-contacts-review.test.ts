import { it, expect, describe } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** The review of the app's external contacts (findings 1–7): where each fix is wired (the logic is tested in lib/). */
describe('1. a company filter never reorders a column from its shown cards only', () => {
  it('the project board turns off up/down and places in a column, and moves into another column with no new order', () => {
    const s = src('screens/BoardScreen.tsx');
    expect(s).toMatch(/steps=\{!company\}/);
    expect(s).toMatch(/placesOff=\{!!company\}/);
    expect(s).toMatch(/company \? moveWithoutOrder\(/);
    // The whole column (hidden cards too) is where the bottom is found.
    expect(s).toMatch(/fullBoard\.find\(/);
    expect(s).toMatch(/if \(company\) return;/);
  });

  it('the move sheet offers no places while it is off: a column tap moves the card to its bottom', () => {
    const s = src('components/board/MoveCardSheet.tsx');
    expect(s).toMatch(/placesOff\?: boolean/);
    expect(s).toMatch(/placesOff \? onMove\(col\.id, 'bottom'\) : setTo\(col\.id\)/);
    expect(s).toMatch(/!placesOff && own && shownHere\.length/);
  });

  it('the column view takes the board’s word on up/down', () => {
    expect(src('screens/BoardScreen.tsx')).toMatch(/<BoardColumnView [^>]*steps=\{steps\}/);
  });
});

describe('2. a contact still open in its editor is never dropped', () => {
  it('the field tells the form when its editor is open; Create and Save refuse meanwhile, and it counts as unsaved', () => {
    expect(src('components/task-form/ExternalContactsField.tsx')).toMatch(/onOpenChange\?\.\(/);
    const s = src('screens/NewTaskScreen.tsx');
    expect(s).toMatch(/onOpenChange=\{setContactOpen\}/);
    expect(s).toMatch(/if \(contactOpen\) \{\s*setBanner\(CONTACT_STILL_OPEN\);/);
    expect(s).toMatch(/\|\| contactOpen;/);
  });
});

describe('3–5. a change sends only what changed, a failure refreshes, an addition keeps its key', () => {
  it('the task screen sends only the fields that changed from what was shown', () => {
    expect(src('components/task-detail/ExternalContactsCard.tsx')).toMatch(/contactPatch\(contact, fields\)/);
  });

  it('every change refreshes the task when it fails too; a contact already gone counts as removed', () => {
    const q = src('core/external-contact-queries.ts');
    expect(q.match(/onSettled: after/g)?.length).toBe(3);
    expect(q).not.toMatch(/onSuccess: after/);
    const card = src('components/task-detail/ExternalContactsCard.tsx');
    expect(card).toMatch(/isContactGone\(e\)/);
    // An editor open on a contact that went away closes with it.
    expect(card).toMatch(/const open = editing === 'new' \|\| contacts\.some\(\(x\) => x\.id === editing\) \? editing : null;/);
  });

  it('an addition goes under one key until it is added (a retry after a lost answer adds it once)', () => {
    const q = src('core/external-contact-queries.ts');
    expect(q).toMatch(/\{ fields, idempotencyKey \}: \{ fields: ExternalContactFields; idempotencyKey\?: string \}/);
    expect(q).not.toMatch(/newIdempotencyKey\(\)/);
    const card = src('components/task-detail/ExternalContactsCard.tsx');
    expect(card).toMatch(/const addKey = useRef\(newIdempotencyKey\(\)\);/);
    expect(card).toMatch(/addKey\.current = newIdempotencyKey\(\);/);
  });
});

describe('6. suggestions are for the name as typed now, and are read out; the first problem is said', () => {
  it('no list for an earlier text, none kept while the next is asked for', () => {
    const q = src('core/external-contact-queries.ts');
    expect(q).not.toMatch(/keepPreviousData/);
    const e = src('components/task-form/ContactEditor.tsx');
    expect(e).toMatch(/freshSuggestions\(draft\.name, suggestions\.forText, suggestions\.data\)/);
    expect(e).toMatch(/accessibilityLiveRegion="polite"[^>]*>\s*\{EXTERNAL_CONTACT_WORDS\.suggestions\}/);
  });

  it('a refused contact brings its first problem into view and says it, whichever field it is', () => {
    const e = src('components/task-form/ContactEditor.tsx');
    expect(e).toMatch(/const first = firstProblem\(/);
    expect(e).toMatch(/refs\[first\.field\]\.current\?\.focus\(\)/);
    expect(e).toMatch(/AccessibilityInfo\.announceForAccessibility\(first\.message\)/);
  });
});

describe('7. an offline save still says so; the All projects board offers only its shown projects’ companies', () => {
  it('the kept message goes with the contacts’ problem', () => expect(src('screens/NewTaskScreen.tsx')).toMatch(/setBanner\(editSaveProblem\(out, sent\.problem\)\)/));

  it('the company choices come from the shown projects’ tasks only', () => {
    const s = src('screens/AllBoardScreen.tsx');
    expect(s).toMatch(/externalCompanyOptions\(shownTasks\)/);
    expect(s).toMatch(/const shownTasks = useMemo\(/);
  });
});
