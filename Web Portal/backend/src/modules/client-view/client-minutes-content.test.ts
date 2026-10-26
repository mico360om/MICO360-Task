import { describe, it, expect } from 'vitest';
import { clientMinutesContent, nameVariants, stripOwner } from './client-minutes-content';

const NAMES = nameVariants([
  { firstName: 'Bilal', lastName: 'Ahmed' },
  { firstName: 'Sara', lastName: 'Al Balushi' },
  { firstName: 'سارة', lastName: 'البلوشي' },
  { name: 'Guest Visitor' },
]);

describe('the names a client copy is checked against', () => {
  it('are each person’s full name and first name (once each), longest first', () => {
    expect(NAMES).toEqual(['Sara Al Balushi', 'Guest Visitor', 'سارة البلوشي', 'Bilal Ahmed', 'Bilal', 'Guest', 'Sara', 'سارة']);
  });
});

describe('a next step without its owner', () => {
  it.each([
    ['Send the revised form to the client — Bilal, by 18 Oct', 'Send the revised form to the client — by 18 Oct'],
    ['Send the revised form — Bilal Ahmed, by Oct 18', 'Send the revised form — by Oct 18'],
    ['Book the rig — sara al balushi', 'Book the rig'],
    ['Book the rig – Sara, by 1 Nov', 'Book the rig – by 1 Nov'],
    ['Book the rig - Guest Visitor', 'Book the rig'],
    ['Survey the site — unassigned, by 20 Oct', 'Survey the site — by 20 Oct'],
    ['Survey the site — Unassigned', 'Survey the site'],
    ['تجهيز التقرير — سارة، by 2 Nov', 'تجهيز التقرير — by 2 Nov'],
  ])('%s → %s', (step, expected) => {
    expect(stripOwner(step, NAMES)).toBe(expected);
  });

  it.each([
    'Agree prices — high priority, by 18 Oct', // not a name after the dash
    'Call Bilal about the permit', // a name, but not as the owner after a dash
    'Order parts — Bilalco supplies, by Friday', // only a whole name counts
    'Plan — by 18 Oct',
    '',
  ])('leaves "%s" as it is', (step) => {
    expect(stripOwner(step, NAMES)).toBe(step);
  });
});

describe('the client copy of the final minutes', () => {
  const content = {
    summary: 'Agreed the plan with Bilal.',
    discussion: [{ topic: 'Scope', text: 'Three rigs.' }],
    decisions: ['Start 1 Nov'],
    risks: ['Weather', 'Internal: margin is thin'],
    nextSteps: ['Survey — Sara, by 20 Oct', 'Report — Bilal Ahmed'],
  };

  it('leaves out "Risks & open issues" unless they were ticked', () => {
    expect(clientMinutesContent(content, { names: NAMES, includeRisks: false }).risks).toEqual([]);
    expect(clientMinutesContent(content, { names: NAMES, includeRisks: true }).risks).toEqual(['Weather', 'Internal: margin is thin']);
  });

  it('takes the owner off every next step, and keeps the rest as written', () => {
    const copy = clientMinutesContent(content, { names: NAMES, includeRisks: false });
    expect(copy.nextSteps).toEqual(['Survey — by 20 Oct', 'Report']);
    expect(copy.summary).toBe('Agreed the plan with Bilal.');
    expect(copy.decisions).toEqual(['Start 1 Nov']);
    expect(copy.discussion).toEqual([{ topic: 'Scope', text: 'Three rigs.' }]);
  });
});
