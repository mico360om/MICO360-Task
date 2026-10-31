/** Stage 2 Task 14: Settings and Reports leftovers (source text: the screens need React Native). */
import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

it('the weekly summary is for the people the server says get it, and off when the company turned it off', () => {
  expect(src('components/account/WeeklySummarySettings.tsx')).toMatch(/useManagementAccess\(\)[^]*weeklySummaryEnabled === false/);
  expect(src('screens/SettingsScreen.tsx')).toContain('<WeeklySummarySettings');
});

it('the weekly summary switch is the shared Toggle, shown off and disabled while the company has it off, saving only that setting', () => {
  const s = src('components/account/WeeklySummarySettings.tsx');
  // Shown as the website's row ("Send me the weekly summary"); TalkBack hears its switch label.
  expect(s).toMatch(/<Toggle[^>]*label=\{WEEKLY_SUMMARY_TEXT\.row\}[^>]*a11yLabel=\{WEEKLY_SUMMARY_TEXT\.label\}/);
  expect(s).toMatch(/on=\{on && !companyOff\}/);
  expect(s).toMatch(/disabled=\{[^}]*companyOff/);
  expect(s).toMatch(/\{ weeklySummary: /);
});

it('each notification switch says “Notify me: …” to TalkBack, as the website’s', () => expect(src('screens/SettingsScreen.tsx')).toMatch(/a11yLabel=\{`Notify me: \$\{n\.label\}`\}/));

it('Calendar & dates says whose week start it is, and offers the company’s', () => {
  const s = src('components/account/DateSettings.tsx');
  expect(s).toMatch(/weekStartHint\(prefs\?\.weekStart \?\? null, /);
  expect(s).toMatch(/companyWeekStartButton\(/);
  expect(s).toMatch(/change\(\{ weekStart: null \}\)/);
});

it('Reports reads onTimeFigure', () => {
  const s = src('screens/ReportsScreen.tsx');
  expect(s).toMatch(/onTimeFigure\(/);
  expect(s).not.toMatch(/onTimeText\(/);
});
