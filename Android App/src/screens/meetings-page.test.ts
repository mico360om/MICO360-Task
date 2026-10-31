/** Stage 2 Task 12: the Meetings page as the website's (source text: the screens need React Native). */
import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

it('the strip counts the whole list, not the filtered one', () => expect(src('screens/MeetingsScreen.tsx')).toMatch(/meetingSummary\(all, /));

it('Nothing coming up when nothing is next and nothing is filtered', () => expect(src('screens/MeetingsScreen.tsx')).toMatch(/!filtered && all\.length > 0 && !upNext[^]*<NothingComingUp/));

it('a compact header: New meeting in the page header, no full-width button', () => {
  const s = src('screens/MeetingsScreen.tsx');
  expect(s).toMatch(/<PageHeader[^]*?actions=\{[^]*?title="New meeting"/);
  expect(s.match(/title="New meeting"/g)).toHaveLength(1);
});

it('cards show faces', () => {
  for (const f of ['components/meeting/MeetingCard.tsx', 'components/meeting/UpNextCard.tsx']) expect(src(f), f).toContain('<MeetingFaces');
});

it('the strip is one summary for TalkBack, two numbers a row, a 0 not a button', () => {
  const s = src('components/meeting/MeetingSummaryStrip.tsx');
  expect(s).toMatch(/accessibilityRole="summary"/);
  expect(s).toMatch(/accessibilityLabel="Meetings at a glance"/);
  expect(s).toMatch(/if \(!value\)/);
  expect(s).toMatch(/onFocus\(pressed \? undefined : key\)/);
});

it('the My action items row gives way to the strip (the menu still has My Action Items)', () => expect(src('screens/MeetingsScreen.tsx')).not.toMatch(/navigate\('MyActionItems'\)/));

// Stage 2 fix pass B10: "Last meeting: <title>" was a link inside the sentence (a small target TalkBack
// can't reach on its own). It is a row of its own to tap, 44 dp tall, read as one: what it opens.
it('B10: the last meeting is a row of its own to tap, not a link inside the sentence', () => {
  const s = src('components/meeting/NothingComingUp.tsx');
  expect(s).not.toMatch(/<Text[^>]*onPress=/);
  expect(s).toMatch(/<Pressable\s+onPress=\{onOpen\}\s+accessibilityRole="button"\s+accessibilityLabel=\{`Last meeting: \$\{last\.title\}, \$\{last\.when\}`\}\s+accessibilityHint="Opens the meeting"/);
  expect(s).toMatch(/lastRow: \{[^}]*minHeight: 44/);
});
