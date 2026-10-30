import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, loadWebTsx, normalise, readWeb } from '../testing/web-source';
import { DETAIL } from '../testing/inspection-fixtures';
import { asWebsiteWords, websiteSays } from '../testing/phone-words';
import { detailView, type DraftView } from './inspection-outbox';
import type { SyncState } from './inspection-outboxes';
import { defaultScheduleName, lateText, shortDay, upcomingText } from './inspection-schedule';
import type { InspectionListItem } from './inspection-types';
import {
  BACK_ONLINE,
  INSPECTION_WORDS,
  SYNC_ANNOUNCE,
  finishHint,
  finishedNotice,
  followUpNotice,
  inspectionChangeNote,
  inspectionFacts,
  pendingWords,
  problemText,
  progressWords,
  startedLine,
  syncLine,
  syncWord,
} from './inspection-words';
import { isIconName, MISC_ICONS } from './icons';

/** The website's inspection words, its schedule helpers and the inspection icon (Stage 4 Task 6). */

const WEB_FILES = ['frontend/src/pages/InspectionPage.tsx', 'frontend/src/components/inspections/SyncBanner.tsx', 'frontend/src/components/inspections/inspection-ui.tsx'];

const ORDER = [
  { id: 'a', label: 'Guard rails fitted' },
  { id: 'p', label: 'Pressure' },
  { id: 'q', label: 'Hoses' },
];
const REPORTS: Array<Parameters<typeof followUpNotice>[0]> = [
  [{ itemId: 'a', status: 'created', taskKey: 'RIG-9' }],
  [
    { itemId: 'p', status: 'created', taskKey: 'RIG-10' },
    { itemId: 'a', status: 'created', taskKey: 'RIG-9' },
  ],
  [
    { itemId: 'q', status: 'not-failed', taskKey: null },
    { itemId: 'a', status: 'exists', taskKey: 'RIG-9' },
    { itemId: 'p', status: 'pending', taskKey: null },
    { itemId: 'zz', status: 'created', taskKey: null },
  ],
  [],
];

const base = detailView(DETAIL);
const waitingView: DraftView = { ...base, pending: { answers: 2, finish: true, followUps: 1 } };
const VIEWS: Array<[DraftView, SyncState, boolean]> = [
  [{ ...waitingView, persisted: false }, 'idle', true],
  [base, 'idle', true],
  [{ ...base, sentAt: '2026-10-30T08:00:00.000Z' }, 'idle', true],
  [waitingView, 'sending', true],
  [waitingView, 'signed-out', true],
  [waitingView, 'idle', false],
  [waitingView, 'offline', true],
  [{ ...waitingView, lastFailure: 'unreachable' }, 'idle', true],
  [{ ...waitingView, lastFailure: 'retry' }, 'idle', true],
  [waitingView, 'retry', true],
  [waitingView, 'idle', true],
];

describe.skipIf(!hasWeb('frontend/src/lib/inspection-schedule.ts', ...WEB_FILES))('the website’s inspection words', () => {
  it('inspection-schedule.ts is the website’s file', () => expect(normalise(src('lib/inspection-schedule.ts'))).toBe(normalise(readWeb('frontend/src/lib/inspection-schedule.ts'))));

  it('problemText, followUpNotice and syncWord decide as the website’s', () => {
    const ui = loadWebTsx('frontend/src/components/inspections/inspection-ui.tsx') as { problemText: typeof problemText; followUpNotice: typeof followUpNotice };
    const banner = loadWebTsx('frontend/src/components/inspections/SyncBanner.tsx') as { syncWord: typeof syncWord };
    for (const e of [new Error('Network request failed.'), new Error('Request failed with 500'), new Error('Only Ann can answer it.'), new Error('Failed to fetch'), { message: 'Plain object' }, null, 'text'])
      expect(problemText(e, 'F'), String(e)).toBe(ui.problemText(e, 'F'));
    for (const r of REPORTS) expect(followUpNotice(r, ORDER)).toBe(ui.followUpNotice(r, ORDER));
    for (const [v, s, on] of VIEWS) expect(syncWord(v, s, on), `${s} ${on}`).toBe(banner.syncWord(v, s, on));
  });

  it('every fixed word is the website’s (phone wordings excepted)', () => {
    const web = WEB_FILES.map(readWeb);
    for (const [k, w] of Object.entries(INSPECTION_WORDS)) expect(websiteSays(web, w), k).toBe(true);
    for (const [k, w] of Object.entries(SYNC_ANNOUNCE)) expect(websiteSays(web, w), k).toBe(true);
    expect(websiteSays(web, BACK_ONLINE)).toBe(true);
  });

  it('the banner says what the website’s banner says', () => {
    const web = readWeb('frontend/src/components/inspections/SyncBanner.tsx');
    for (const [v, s, on] of VIEWS) expect(websiteSays(web, syncLine(syncWord(v, s, on), v).replace(pendingWords(v.pending), '{w}')), `${s} ${on}`).toBe(true);
  });

  it('the screen’s words name the phone, not a page reload', () => {
    expect(INSPECTION_WORDS.noSignal).toContain('even if the app closes');
    expect(asWebsiteWords(INSPECTION_WORDS.noSignal)).toContain('even if the page reloads');
  });
});

it('schedules and checks say days as the website does', () => {
  expect(shortDay('2026-10-28')).toBe('Wed 28 Oct');
  expect(lateText(1)).toBe('1 day late');
  expect(upcomingText('2026-10-29', '2026-10-28')).toBe('Tomorrow');
  expect(defaultScheduleName('Rig check', 'Rig 3')).toBe('Rig check – Rig 3');
});

it('progress, finish and change words', () => {
  expect(progressWords({ total: 40, answered: 12, passed: 9, failed: 1, na: 2 })).toEqual({ answered: '12 of 40 answered', passed: '9 passed', failed: '1 failed', na: '2 N/A' });
  expect(finishHint(['INSPECTOR', 'CLIENT', 'SUPERVISOR'], ['INSPECTOR', 'SUPERVISOR'])).toBe('The inspector signs, then the client (optional) and the supervisor. After that it can’t be changed, and the report is made.');
  expect(finishHint(['INSPECTOR'], ['INSPECTOR'])).toBe('The inspector signs. After that it can’t be changed, and the report is made.');
  expect(finishedNotice({ taskCompleted: { id: 't1', key: 'RIG-1', title: 'x' }, taskWaiting: null })).toBe('Finished. Task RIG-1 completed.');
  expect(finishedNotice({ taskCompleted: null, taskWaiting: { id: 't1', key: 'RIG-1', title: 'x' } })).toBe('Finished. Task RIG-1 needs approval, so it’s waiting for a project manager.');
  expect(finishedNotice({ taskCompleted: null, taskWaiting: null })).toBe('Finished. The report is ready.');
  expect(inspectionChangeNote(DETAIL, { ...DETAIL, inspector: { id: 'u9', name: 'Omar Ali' } }, 'u1')).toBe('Omar Ali took this inspection over: only they can answer and sign it now. Anything still saved on this phone for it isn’t sent.');
  expect(inspectionChangeNote(DETAIL, { ...DETAIL, revision: 1, reopened: { at: '2026-10-30T09:00:00.000Z', by: { id: 'u2', name: 'Sara Khan' } } }, 'u1')).toBe('Sara Khan reopened this inspection: its answers can be changed again, and it is signed again when it’s finished.');
  expect(inspectionChangeNote(DETAIL, { ...DETAIL, revision: 1, reopened: { at: '2026-10-30T09:00:00.000Z', by: { id: 'u1', name: 'Ann Lee' } } }, 'u1')).toBeNull();
  expect(inspectionChangeNote(DETAIL, DETAIL, 'u1')).toBeNull();
  expect(inspectionChangeNote(null, DETAIL, 'u1')).toBeNull();
});

it('the banner line, and what is waiting in words', () => {
  expect(pendingWords({ answers: 2, finish: true, followUps: 1 })).toBe('2 answers, 1 follow-up task request, the signatures');
  expect(pendingWords({ answers: 1, finish: false, followUps: 0 })).toBe('1 answer');
  expect(syncLine('offline', waitingView)).toBe('Saved on this phone, will send when online: 2 answers, 1 follow-up task request, the signatures.');
  expect(syncLine('sent', base)).toBe('Saved.');
  expect(syncLine('sent', { ...base, sentAt: '2026-10-30T08:00:00.000Z' })).toBe('All changes sent.');
});

it('a row’s facts and the started line, in the company’s time zone', () => {
  const row: InspectionListItem = { ...DETAIL, startedAt: '2026-10-27T20:30:00.000Z' };
  expect(inspectionFacts(row, 'Asia/Muscat')).toBe('Rig 3 · Started 28 Oct 2026 · Ann Lee · For RIG-1');
  expect(inspectionFacts({ ...row, place: null, task: null, status: 'FINISHED', finishedAt: '2026-10-29T05:00:00.000Z' }, 'Asia/Muscat')).toBe('Finished 29 Oct 2026 · Ann Lee');
  expect(startedLine('2026-10-27T10:05:00.000Z', 'Asia/Muscat')).toBe('Started 27 Oct 2026, 14:05');
});

it('the inspection icon is the website’s clipboard', () => {
  expect(isIconName('misc.inspection')).toBe(true);
  expect(MISC_ICONS.inspection).toMatchObject({ source: 'components/inspections/inspection-ui.tsx', strokeWidth: 2.2 });
});
