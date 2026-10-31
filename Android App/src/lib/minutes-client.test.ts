import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import { websiteSays } from '../testing/phone-words';
import { MINUTES_CLIENT_WORDS, minutesHint, previewParts, showMinutesSwitch } from './minutes-client';
import type { ApiFinalMinutes, FinalMinutesContent } from './types';

/** Show approved minutes to the client (Stage 4 Task 19). */
const CONTENT: FinalMinutesContent = { summary: 'Rig 3 passed.', discussion: [{ topic: 'Pumps', text: 'Checked' }], decisions: ['Go'], risks: ['Weather'], nextSteps: ['Report'] };

it('the switch shows only on final minutes of a project meeting, to the people who may change it', () => {
  const final = { status: 'FINAL', content: CONTENT } as ApiFinalMinutes;
  expect(showMinutesSwitch({ projectMeeting: true, approved: true, clientVisible: false, canChange: true }, final)).toBe('switch');
  expect(showMinutesSwitch({ projectMeeting: true, approved: true, clientVisible: true, canChange: false }, final)).toBe('chip');
  expect(showMinutesSwitch({ projectMeeting: true, approved: true, clientVisible: false, canChange: false }, final)).toBeNull();
  expect(showMinutesSwitch({ projectMeeting: false, approved: true, clientVisible: false, canChange: true }, final)).toBeNull();
  expect(showMinutesSwitch({ projectMeeting: true, approved: false, clientVisible: false, canChange: true }, { ...final, status: 'DRAFT' })).toBeNull();
  expect(showMinutesSwitch(undefined, final)).toBeNull();
});

it('the hint says what showing them does, and whether the risks go too', () => {
  expect(minutesHint({ projectMeeting: true, approved: true, clientVisible: false, canChange: true })).toBe(
    'Puts these final minutes on the project’s client page, with a PDF of them alone (never the attendees, the notes or the action items). You see exactly what the client will see first.',
  );
  expect(minutesHint({ projectMeeting: true, approved: true, clientVisible: true, includeRisks: true, canChange: true })).toBe(
    'Shown on the project’s client page, with a PDF of them alone (never the attendees, the notes or the action items). Risks and open issues are included. Reopening the minutes or moving the meeting to another project takes them off.',
  );
  expect(minutesHint({ projectMeeting: true, approved: true, clientVisible: true, canChange: true })).toContain('Risks and open issues are left out.');
});

it('the preview shows the risks only while ticked', () => {
  expect(previewParts(CONTENT, false).map((p) => p.title)).toEqual(['Discussion', 'Decisions', 'Next steps']);
  expect(previewParts(CONTENT, true).map((p) => p.title)).toEqual(['Discussion', 'Decisions', 'Risks & open issues', 'Next steps']);
  expect(previewParts({ ...CONTENT, decisions: [], risks: [] }, true).map((p) => p.title)).toEqual(['Discussion', 'Next steps']);
});

it('turning it on shows the preview first; only the preview’s Show to client makes them visible (Review Focus 5)', () => {
  const s = src('components/client-share/MinutesClientSwitch.tsx');
  expect(s).toMatch(/clientSwitchStep\(/);
  expect(s.match(/setMinutesVisible\([^)]*true/g)).toHaveLength(1);
  expect(s).toMatch(/onConfirm=\{[^}]*setMinutesVisible\(meetingId, true, includeRisks\)/);
  expect(s).toMatch(/'hide'[^]*setMinutesVisible\(meetingId, false\)/);
  expect(s).toMatch(/disabled=\{[^}]*!v\.approved/);
});

describe.skipIf(!hasWeb('frontend/src/components/meeting/MinutesClientSwitch.tsx', 'frontend/src/components/meeting/MinutesClientDialog.tsx'))('the website’s', () => {
  it('words', () => {
    const web = [readWeb('frontend/src/components/meeting/MinutesClientSwitch.tsx'), readWeb('frontend/src/components/meeting/MinutesClientDialog.tsx')];
    // websiteSays reads the text between tags; a word in an attribute (<Part title="Discussion">) is read as written.
    for (const [k, v] of Object.entries(MINUTES_CLIENT_WORDS)) expect(websiteSays(web, v) || web.some((w) => w.includes(`"${v}"`)), k).toBe(true);
    expect(web.join('\n')).toContain('Risks and open issues are ');
  });
});

it('the minutes row carries the switch in its final state, and approving or reopening reads it again', () => {
  expect(src('components/meeting/MeetingDetailParts.tsx')).toMatch(/FINAL[^]*<MinutesClientSwitch meetingId=/);
  expect(src('core/meeting-mutations.ts')).toMatch(/queryKey: \['meeting', meetingId, 'client-visibility'\]/);
  expect(src('core/client-share-queries.ts')).toMatch(/useMinutesClient[^]*queryKey: \['meeting', meetingId, 'client-visibility'\]/);
});
