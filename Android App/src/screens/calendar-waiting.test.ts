/**
 * Stage 3 Task 10: the calendar marks a task waiting for approval with the website's hourglass (in
 * its warning TEXT tone) and shows the Waiting for approval chip in the task's sheet.
 */
import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

it('the hourglass on the row and the chip in the task sheet', () => {
  expect(src('components/calendar/CalendarTaskRow.tsx')).toMatch(/waits\(item\) \? <Icon name="misc\.waiting" size=\{13\} color=\{c\.warningText\}/);
  expect(src('components/calendar/CalendarSheets.tsx')).toMatch(/waits\(item\) \? <ApprovalChip size="sm" \/>/);
});
it('the hourglass sits after the title, before the repeat sign, and only the row’s name says it to TalkBack', () => {
  const row = src('components/calendar/CalendarTaskRow.tsx');
  expect(row.indexOf('misc.waiting')).toBeGreaterThan(row.indexOf('{item.task.title}'));
  expect(row.indexOf('misc.waiting')).toBeLessThan(row.indexOf('kit.repeat'));
  expect(row).not.toMatch(/name="misc\.waiting"[^>]*label=/);
  expect(src('components/Icon.tsx')).toMatch(/importantForAccessibility=\{label \? 'yes' : 'no-hide-descendants'\}/);
  expect(row).toMatch(/accessibilityLabel=\{`\$\{itemName\(item\)\}\. \$\{meta\}`\}/);
});
