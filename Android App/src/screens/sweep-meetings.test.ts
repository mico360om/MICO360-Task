/** Task 19: the meetings screens in the new look (source text: the screens need React Native). */
import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

it('the Meetings filters are the shared Chips', () => expect(src('screens/MeetingsScreen.tsx')).toMatch(/<Chip /));
it('meeting sheets lay the shared scrim over the page', () => expect(src('components/meeting/sheet-kit.tsx')).toMatch(/colors?\.scrim|\bc\.scrim/));
it('the date leaf: upcoming in the brand text tone, past in ink3', () => expect(src('components/meeting/MeetingCard.tsx')).toMatch(/tone === 'upcoming' \? c\.brandText : c\.ink3/));
it('the filters sheet uses the shared scrim and the shared Chip', () => {
  const sheet = src('components/meeting/MeetingFiltersSheet.tsx');
  expect(sheet).toMatch(/backgroundColor: c\.scrim/);
  expect(sheet).toMatch(/import \{ Button, Chip \} from '\.\.\/ui';/);
});
it('a meeting shown beside tasks wears the meeting colour', () => expect(src('components/MeetingRow.tsx')).toMatch(/<Icon name="kit\.calendar" size=\{20\} color=\{c\.meeting\} \/>/));
it('the meeting facts are drawn icons from the meeting kit', () => {
  const parts = src('components/meeting/MeetingDetailParts.tsx');
  for (const icon of ['kit.calendar', 'kit.clock', 'kit.globe', 'kit.repeat', 'kit.pin', 'kit.user']) expect(parts, icon).toContain(`fact('${icon}'`);
});
