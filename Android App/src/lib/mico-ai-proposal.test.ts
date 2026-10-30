import { describe, it, expect } from 'vitest';
import {
  cardHeading,
  changeLabel,
  confirmBody,
  countdown,
  initialTicks,
  lengthLabel,
  linesOf,
  meetingWhen,
  remainingNeeds,
  resultSummary,
  shortDay,
  textOf,
  undoLeft,
  undoSummary,
  zoneLabel,
} from './mico-ai-proposal';
import { PROPOSALS } from '../testing/mico-ai-fixtures';
import { hasWeb, loadWebTs } from '../testing/web-source';

/** MICO AI's card rules are a copy of the website's lib/mico-ai-proposal.ts (Stage 3 Task 11). */
it('the card in words', () => {
  const proposed = PROPOSALS[0]!.items;
  expect(cardHeading(proposed)).toBe('5 changes to make');
  expect(cardHeading(PROPOSALS[1]!.items)).toBe('2 new tasks');
  expect(changeLabel(proposed[0]!)).toBe('Create “Order valves”');
  expect(initialTicks(proposed)).toEqual({ c1: false, c2: true, c3: true, c4: false, c5: false });
  expect(remainingNeeds(proposed[3]!, { title: 'x' }).map((n) => n.message)).toEqual(['Pick a time.']);
  expect(confirmBody(proposed, { c1: true, c2: true, c4: true, c5: true }, { c1: { projectId: 'p1' }, c2: { due: null, title: 'x' } }, false)).toEqual({
    items: [{ id: 'c1', include: true, edits: { projectId: 'p1' } }, { id: 'c2', include: true, edits: { due: null } }, { id: 'c3', include: false }, { id: 'c4', include: false }, { id: 'c5', include: false }],
    sendInvites: false,
  });
  expect(resultSummary(PROPOSALS[2]!.items)).toBe('1 done, 1 refused, 1 failed, 1 skipped');
  expect(undoSummary(PROPOSALS[5]!.items)).toBe('1 put back, 2 left as they were');
  expect(countdown(872_000)).toBe('14:32');
  expect(shortDay('2027-01-05', '2026')).toBe('Tue 5 Jan 2027');
  expect(zoneLabel('America/New_York')).toBe('New York time');
  expect(lengthLabel(90)).toBe('1 h 30 min');
  expect(linesOf(' a \n\n b')).toEqual(['a', 'b']);
  expect(textOf(['a', 'b'])).toBe('a\nb');
  expect(meetingWhen({ date: '2026-10-27', time: '23:30', minutes: 90 })).toBe('Tue 27 Oct, 23:30–01:00');
});

describe.skipIf(!hasWeb('frontend/src/lib/mico-ai-proposal.ts'))('the website’s proposal rules', () => {
  const web = loadWebTs('frontend/src/lib/mico-ai-proposal.ts') as Record<string, (...a: never[]) => unknown>;
  it('agree on every card of the fixtures', () => {
    for (const p of PROPOSALS) {
      const items = p.items;
      for (const f of ['cardHeading', 'initialTicks', 'resultSummary', 'undoSummary'] as const) expect((({ cardHeading, initialTicks, resultSummary, undoSummary }) as Record<string, (i: unknown) => unknown>)[f]!(items), `${p.status} ${f}`).toEqual(web[f]!(items as never));
      for (const i of items) { expect(changeLabel(i)).toBe(web.changeLabel!(i as never)); expect(remainingNeeds(i, { title: 'x' })).toEqual(web.remainingNeeds!(i as never, { title: 'x' } as never)); }
      const ticks = initialTicks(items); expect(confirmBody(items, ticks, { c1: { title: 'New' } }, true)).toEqual(web.confirmBody!(items as never, ticks as never, { c1: { title: 'New' } } as never, true as never));
    }
    for (const ms of [0, 59_000, 872_000, 900_000]) expect(countdown(ms)).toBe(web.countdown!(ms as never));
    expect(undoLeft('2026-10-30T08:15:00Z', '2026-10-30T08:00:00Z', 1_000, 29_000)).toBe(web.undoLeft!('2026-10-30T08:15:00Z' as never, '2026-10-30T08:00:00Z' as never, 1_000 as never, 29_000 as never));
    for (const f of [{ date: '2026-10-27', time: '10:00', minutes: 30 }, { date: '2026-10-27', time: null, minutes: 90 }]) expect(meetingWhen(f, { zone: 'Asia/Dubai', thisYear: '2026' })).toBe(web.meetingWhen!(f as never, { zone: 'Asia/Dubai', thisYear: '2026' } as never));
    for (const k of ['2026-10-27', '2027-01-05', null]) expect(shortDay(k, '2026')).toBe(web.shortDay!(k as never, '2026' as never));
    for (const m of [0, 15, 60, 90, 125]) expect(lengthLabel(m)).toBe(web.lengthLabel!(m as never));
    expect(zoneLabel('Asia/Muscat')).toBe(web.zoneLabel!('Asia/Muscat' as never));
    expect(linesOf(' a \n\n b ')).toEqual(web.linesOf!(' a \n\n b ' as never));
  });
});
