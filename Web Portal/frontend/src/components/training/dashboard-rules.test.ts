import { describe, expect, it } from 'vitest';
import { adminModuleDetail, card, certificate, detail, mine, moduleCard, moduleDetail, myTraining } from './training-fixtures';
import { certificateState, certificateWords, dashboardFocus, lessonsLeft, mainAction, MAIN_ACTION_WORDS, minutesLeftText, moduleKeyOf, shortInstantDay, upNextModule } from './dashboard-rules';
import { learningGroups } from './training-words';

const NOW = new Date('2026-11-13T09:00:00.000Z');

describe('mainAction: one main button (Start / Continue / Review)', () => {
  it('Start when nothing is done (not started, or not theirs yet)', () => {
    expect(mainAction(mine({ enrolled: false, status: 'NOT_STARTED', progressPct: 0, lessonsDone: 0 }))).toBe('start');
    expect(mainAction(mine({ enrolled: true, status: 'NOT_STARTED', progressPct: 0, lessonsDone: 0 }))).toBe('start');
  });

  it('Continue when part done — even with no module done yet (a lesson done, 0%)', () => {
    expect(mainAction(mine({ status: 'IN_PROGRESS', progressPct: 40, lessonsDone: 1 }))).toBe('continue');
    expect(mainAction(mine({ status: 'IN_PROGRESS', progressPct: 0, lessonsDone: 1, modules: { done: 0, total: 8 } }))).toBe('continue');
  });

  it('Review when finished; Continue when modules are new for their role', () => {
    expect(mainAction(mine({ status: 'COMPLETED', progressPct: 100, newForRole: 0 }))).toBe('review');
    expect(mainAction(mine({ status: 'COMPLETED', progressPct: 100, newForRole: 2 }))).toBe('continue');
    // Finished, then lessons changed: Review (the chip says “Review the changes”).
    expect(mainAction(mine({ status: 'REVIEW', progressPct: 100 }))).toBe('review');
  });

  it('a retake: Start until a lesson of the new round is done, then Continue', () => {
    expect(mainAction(mine({ status: 'RETAKE', progressPct: 0, lessonsDone: 0 }))).toBe('start');
    expect(mainAction(mine({ status: 'RETAKE', progressPct: 25, lessonsDone: 1 }))).toBe('continue');
  });

  it('its words', () => {
    expect(MAIN_ACTION_WORDS).toEqual({ start: 'Start', continue: 'Continue', review: 'Review' });
  });
});

describe('minutesLeftText', () => {
  const left = (...minutes: number[]) => minutes.map((m) => ({ minutes: m, done: false }));
  it('the unfinished minutes, rounded to 5: “About 1 h 10 min left”', () => {
    expect(minutesLeftText([...left(40, 30), { minutes: 50, done: true }])).toBe('About 1 h 10 min left');
    expect(minutesLeftText(left(62))).toBe('About 1 h left');
    expect(minutesLeftText(left(21))).toBe('About 20 min left');
    expect(minutesLeftText(left(5))).toBe('About 5 min left');
    expect(minutesLeftText(left(7))).toBe('About 5 min left');
  });

  it('“Under 5 min left” below 5; nothing when nothing is left', () => {
    expect(minutesLeftText(left(3, 1))).toBe('Under 5 min left');
    expect(minutesLeftText([{ minutes: 30, done: true }])).toBeNull();
    expect(minutesLeftText(left(0))).toBeNull();
    expect(minutesLeftText([])).toBeNull();
  });
});

describe('the hidden-module rule (an employee and an administrator on the same course)', () => {
  it('Module N of M: the module the resume lesson is in, among the person’s own modules', () => {
    expect(upNextModule(moduleDetail())).toMatchObject({ index: 1, total: 3, module: { id: 'tk', title: 'Tasks' } });
    expect(upNextModule(adminModuleDetail())).toMatchObject({ index: 1, total: 5, module: { id: 'tk' } });
  });

  it('minutes left count only the person’s lessons, and none of a module already done', () => {
    // Employee: Work on a task 8 + Tasks quiz 5 + Kanban 3 + 5 = 21 → about 20.
    expect(minutesLeftText(lessonsLeft(moduleDetail()))).toBe('About 20 min left');
    // Administrator: + Reports 10 + 5 + Admin settings 6 + 5 = 47 → about 45.
    expect(minutesLeftText(lessonsLeft(adminModuleDetail()))).toBe('About 45 min left');
    // A lesson added later to a module recorded as done isn't “left”.
    const d = moduleDetail();
    const late = { ...d, lessons: [...d.lessons, { id: 'g3', position: 7, kind: 'GUIDE' as const, title: 'New page', minutes: 30, done: false, locked: false, review: false, moduleId: 'gs' }], modules: d.modules.map((m) => (m.id === 'gs' ? { ...m, lessonIds: [...m.lessonIds, 'g3'] } : m)) };
    expect(minutesLeftText(lessonsLeft(late))).toBe('About 20 min left');
  });

  it('the certificate counts their modules: “Finish 2 more modules” (employee), “Finish 4 more modules” (administrator)', () => {
    expect(certificateWords(certificateState(moduleDetail()))).toBe('Finish 2 more modules to get it');
    expect(certificateWords(certificateState(adminModuleDetail()))).toBe('Finish 4 more modules to get it');
  });
});

describe('upNextModule', () => {
  it('a plain course has no modules: null', () => {
    expect(upNextModule(detail())).toBeNull();
  });

  it('the resume lesson in “Other lessons” (its lessons have no moduleId): that unit', () => {
    const d = moduleDetail({
      resumeLessonId: 'x1',
      lessons: [...moduleDetail().lessons, { id: 'x1', position: 7, kind: 'DOCUMENT', title: 'House rules', minutes: 4, done: false, locked: false, review: false, moduleId: null }],
      modules: [...moduleDetail().modules, { id: 'other', title: 'Other lessons', position: 3, status: 'NOT_STARTED', lessonsDone: 0, lessonCount: 1, minutes: 4, doneAt: null, newForRole: false, nextLessonId: 'x1', lessonIds: ['x1'] }],
    });
    expect(upNextModule(d)).toMatchObject({ index: 3, total: 4, module: { id: 'other', title: 'Other lessons' } });
  });

  it('no resume lesson: the first module not done', () => {
    expect(upNextModule(moduleDetail({ resumeLessonId: null }))).toMatchObject({ index: 1, module: { id: 'tk' } });
  });

  it('everything done: nothing is next (a review of changed lessons still points at its module)', () => {
    const done = moduleDetail().modules.map((m) => ({ ...m, status: 'DONE' as const }));
    expect(upNextModule(moduleDetail({ modules: done, resumeLessonId: 'g1', mine: mine({ ...moduleCard().mine, status: 'COMPLETED', progressPct: 100 }) }))).toBeNull();
    expect(upNextModule(moduleDetail({ modules: done, resumeLessonId: 'k1', mine: mine({ ...moduleCard().mine, status: 'REVIEW', progressPct: 100 }) }))).toMatchObject({ index: 2, module: { id: 'kb' } });
  });

  it('finished, then a module new for their role: that module', () => {
    const d = adminModuleDetail();
    const modules = d.modules.map((m) => (m.id === 'rp' || m.id === 'ad' ? { ...m, newForRole: true } : { ...m, status: 'DONE' as const }));
    expect(upNextModule({ ...d, modules, resumeLessonId: 'r1', mine: mine({ ...d.mine, status: 'COMPLETED', progressPct: 100, newForRole: 2, modules: { done: 3, total: 5 } }) })).toMatchObject({ index: 3, total: 5, module: { id: 'rp' } });
  });
});

describe('certificateState', () => {
  it('no certificate on the course: none', () => {
    expect(certificateState(detail({ certificateOn: false })).kind).toBe('none');
  });

  it('a plain course: lessons left; quizzes left when passing the quizzes finishes it', () => {
    expect(certificateWords(certificateState(detail()))).toBe('Finish 3 more lessons to get it');
    expect(certificateWords(certificateState(detail({ completionRule: 'QUIZZES' })))).toBe('Pass 1 more quiz to get it');
    expect(certificateWords(certificateState(detail({ lessons: detail().lessons.map((l, i) => ({ ...l, done: i < 3 })) })))).toBe('Finish 1 more lesson to get it');
  });

  it('finished with a valid certificate: ready (a review of changes keeps it valid)', () => {
    const cert = certificate();
    const s = certificateState(moduleDetail({ mine: mine({ ...moduleCard().mine, status: 'COMPLETED', progressPct: 100, certificate: cert, modules: { done: 3, total: 3 } }) }));
    expect(s).toEqual({ kind: 'ready', certificate: cert });
    expect(certificateWords(s)).toBe('Certificate ready');
    expect(certificateState(moduleDetail({ mine: mine({ ...moduleCard().mine, status: 'REVIEW', progressPct: 100, certificate: cert }) })).kind).toBe('ready');
  });

  it('finished, then modules new for their role: an updated certificate when those are done (the current one kept)', () => {
    const cert = certificate();
    const s = certificateState(adminModuleDetail({ mine: mine({ ...moduleCard().mine, status: 'COMPLETED', progressPct: 100, newForRole: 2, certificate: cert, modules: { done: 3, total: 5 } }) }));
    expect(s).toEqual({ kind: 'updated', certificate: cert });
    expect(certificateWords(s)).toBe('Finish the new modules for an updated certificate');
  });

  it('a retake: what is left again; a withdrawn certificate on a finished course: none', () => {
    expect(certificateWords(certificateState(moduleDetail({ mine: mine({ ...moduleCard().mine, status: 'RETAKE', progressPct: 0, modules: { done: 0, total: 3 }, certificate: certificate({ status: 'EXPIRED' }) }) })))).toBe('Finish 3 more modules to get it');
    expect(certificateState(moduleDetail({ mine: mine({ ...moduleCard().mine, status: 'COMPLETED', progressPct: 100, certificate: certificate({ status: 'REVOKED' }) }) })).kind).toBe('none');
  });
});

describe('dashboardFocus: which course fills the dashboard', () => {
  const done = (over = {}) => card({ id: 'd1', title: 'Kanban board', mine: mine({ status: 'COMPLETED', progressPct: 100, dueDay: null, ...over }) });
  it('the Up next course (today’s rule)', () => {
    expect(dashboardFocus(learningGroups(myTraining()))).toMatchObject({ course: { id: 'c1' }, allDone: false });
  });

  it('nothing open: the finished course with modules new for their role, as Up next', () => {
    const one = moduleCard({ mine: mine({ ...moduleCard().mine, status: 'COMPLETED', progressPct: 100, newForRole: 2 }) });
    expect(dashboardFocus(learningGroups(myTraining({ assigned: [], inProgress: [], completed: [done(), one] })))).toMatchObject({ course: { id: 'u1' }, allDone: false });
  });

  it('everything done: the course with modules, else the first done — “All done”', () => {
    const one = moduleCard({ mine: mine({ ...moduleCard().mine, status: 'COMPLETED', progressPct: 100 }) });
    expect(dashboardFocus(learningGroups(myTraining({ assigned: [], inProgress: [], completed: [done(), one] })))).toMatchObject({ course: { id: 'u1' }, allDone: true });
    expect(dashboardFocus(learningGroups(myTraining({ assigned: [], inProgress: [], completed: [done()] })))).toMatchObject({ course: { id: 'd1' }, allDone: true });
  });

  it('no training at all: null (the empty state)', () => {
    expect(dashboardFocus(learningGroups(myTraining({ assigned: [], inProgress: [], completed: [], certificates: [] })))).toBeNull();
  });
});

describe('moduleKeyOf: a module’s feature, from its name', () => {
  it('the starter modules', () => {
    const keys = ['Getting started', 'Tasks', 'Kanban board', 'Projects', 'Calendar', 'Meetings & minutes', 'Chat', 'MICO AI', 'Reports', 'Admin settings'].map((title) => moduleKeyOf({ id: 'm', title }));
    expect(keys).toEqual(['general', 'tasks', 'board', 'projects', 'calendar', 'meetings', 'chat', 'mico-ai', 'reports', 'admin']);
  });

  it('any case and spaces; “Other lessons” and a module an admin added: none (the book)', () => {
    expect(moduleKeyOf({ id: 'm', title: '  kanban BOARD ' })).toBe('board');
    expect(moduleKeyOf({ id: 'other', title: 'Other lessons' })).toBeNull();
    expect(moduleKeyOf({ id: 'm', title: 'Safety at Acme' })).toBeNull();
  });
});

describe('shortInstantDay', () => {
  it('“16 Nov” this year, “16 Nov 2025” another', () => {
    expect(shortInstantDay('2026-11-16T08:00:00.000Z', NOW)).toBe('16 Nov');
    expect(shortInstantDay('2025-11-16T08:00:00.000Z', NOW)).toBe('16 Nov 2025');
  });
});
