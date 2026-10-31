import { it, expect } from 'vitest';
import { hasWeb, readWeb, appSource as src } from '../testing/web-source';

/** MICO AI's proposal editors (Stage 3 Task 15), read from their source. */
const s = src('components/mico-ai/ProposalEditor.tsx');
const card = src('components/mico-ai/ProposalCard.tsx');

it('each kind gets the website’s fields and limits', () => {
  expect(s).toMatch(/maxLength=\{FIELD_MAX\.taskTitle\}/); expect(s).toMatch(/maxLength=\{FIELD_MAX\.meetingTitle\}/); expect(s).toMatch(/parseTimeInput\(/);
  for (const w of ['Pick a project', 'Pick a status', 'Assigned to', 'People invited', 'Agenda (one item a line)', 'Decisions (one a line)', 'Next steps (one a line)']) expect(s, w).toContain(w);
  if (hasWeb('frontend/src/components/mico-ai/proposal-rows.tsx')) for (const w of ['Pick a project', 'Pick a status', 'People invited', 'Agenda (one item a line)', 'Risks and open questions (one a line)']) expect(readWeb('frontend/src/components/mico-ai/proposal-rows.tsx'), w).toContain(w);
});
it('the card keeps the edits and sends them with Confirm', () => expect(src('components/mico-ai/ProposalCard.tsx')).toMatch(/applyEdit\(edits, item, patch\)/));

it('the editors use the app’s own pickers and the projects that aren’t archived', () => {
  expect(s).toMatch(/useProjects\(\)/); expect(s).toMatch(/status !== 'ARCHIVED'/);
  expect(s).toMatch(/useProjectMembers\(/); expect(s).toMatch(/useProjectColumns\(/); expect(s).toMatch(/useDirectory\(\)/);
  expect(s).toMatch(/<DueDateField/); expect(s).toMatch(/<InlinePicker/); expect(s).toMatch(/<ChipChoice/);
  // The columns a task can move to: the enabled ones, by position.
  expect(s).toMatch(/filter\(\(col\) => col\.enabled !== false\)\.sort\(\(a, b\) => a\.position - b\.position\)/);
  // Anyone active can be invited; the person asking organizes it.
  expect(s).toMatch(/u\.active !== false && u\.id !== me/);
  for (const w of ['Title', 'Project', 'Due date', 'Priority', 'Description', 'Summary', 'Discussion: ', 'Risks and open questions (one a line)', 'Day', 'Time', 'Length', 'No project', 'HH:MM']) expect(s, w).toContain(w);
  expect(s).toMatch(/maxLength=\{FIELD_MAX\.text\}/);
  expect(s).toMatch(/lengthChoices\(f\.minutes\)/); expect(s).toMatch(/lengthLabel\(/);
  expect(s).toMatch(/linesOf\(/); expect(s).toMatch(/textOf\(/);
});

it('a task change offers only the fields it changes', () => {
  for (const f of ['due', 'columnId', 'priority', 'assigneeIds']) expect(s, f).toMatch(new RegExp(`f\\.${f} !== undefined \\?`));
});

it('the card opens an editor per change, shows the edits and ticks what was put right', () => {
  expect(card).toMatch(/<ProposalEditor item=\{item\} onEdit=\{/);
  expect(card).toMatch(/editing \? 'Done editing' : 'Edit'/);
  expect(card).toMatch(/accessibilityLabel=\{`Edit \$\{label\}`\}/);
  expect(card).toMatch(/effectiveChange\(i, edits\[i\.id\], shown\[i\.id\]\)/);
  expect(card).toMatch(/setTicks\(\(t\) => \(\{ \.\.\.t, \[item\.id\]: r\.tick \}\)\)/);
  if (hasWeb('frontend/src/components/mico-ai/ProposalCard.tsx')) for (const w of ['Done editing', 'Edit ${label}']) expect(readWeb('frontend/src/components/mico-ai/ProposalCard.tsx'), w).toContain(w);
});
