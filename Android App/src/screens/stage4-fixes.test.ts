import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** Stage 4's final review, part S (lane S): each fix pinned where it lives in the screens' source. */

it('S1: a task whose form changed re-reads its details, and the card never starts the old form', () => {
  const card = src('components/inspections/TaskInspectionsCard.tsx');
  expect(card).toMatch(/checkFormOf\(task, formsQ\.data\?\.forms\)/);
  expect(card).not.toMatch(/task\.inspectionForm \?\? null/);
});

it('S2: a try the server is still on (or that got no answer) keeps its key; only a definite answer renews it', () => {
  for (const f of ['components/templates/SaveProjectTemplateSheet.tsx', 'components/templates/SaveTaskTemplateSheet.tsx', 'components/inspections/TaskInspectionsCard.tsx', 'screens/ClientShareScreen.tsx']) {
    const s = src(f);
    expect(s, f).toMatch(/if \(!keepsKey\(e\)\) key\.current = newIdempotencyKey\(\);/);
    expect(s, f).not.toMatch(/if \(e instanceof ApiError\) key\.current = newIdempotencyKey\(\)/);
  }
});

it('S3: a preview shows "Loading…" (and can’t be confirmed) while it is read again — minutes and inspection reports', () => {
  for (const f of ['components/client-share/MinutesClientSwitch.tsx', 'components/inspections/InspectionClientSwitch.tsx']) expect(src(f), f).toMatch(/loading=\{previewQ\.isFetching\}/);
});

it('S4: a project made from a template refreshes My Tasks, the Dashboard and the Calendar (its tasks are new)', () => {
  expect(src('core/project-queries.ts')).toMatch(/over\?\.create && !o\.saved && \(out\.kind === 'done' \|\| out\.kind === 'partly'\)\) refresh\(qc, createdTaskRefreshes\(out\.project\.id\)\)/);
});

it('S6: a removed client leaves the list at once (and the list is read again)', () => {
  const q = src('core/client-share-queries.ts');
  expect(q).toMatch(/onSuccess: \(_r, share\) => \{[^}]*setQueryData<ClientShare\[\]>\(\['client-shares', projectId\][^]*filter\(\(s\) => s\.id !== share\.id\)/);
  expect(q).toMatch(/remove = useMutation[^]*refresh\(\)/);
});

it('S7: TalkBack hears each switch’s explanation with the switch, once', () => {
  const task = src('components/client-share/TaskClientCard.tsx');
  expect(task).toMatch(/<Toggle[^>]*hint=\{HINT\}/);
  expect(task).toMatch(/importantForAccessibility="no">\s*\{HINT\}/);
  const minutes = src('components/client-share/MinutesClientSwitch.tsx');
  expect(minutes).toMatch(/<Toggle on=\{v\.clientVisible\}[^>]*hint=\{minutesHint\(v\)\}/);
  expect(minutes).toMatch(/importantForAccessibility="no">\s*\{minutesHint\(v\)\}/);
});

it('S8: Remove, Retry and the follow-up link are 44 dp targets', () => {
  expect(src('screens/ClientShareScreen.tsx')).toMatch(/remove: \{ minHeight: 44,/);
  const field = src('components/templates/TemplateStartField.tsx');
  expect(field).toMatch(/<Pressable onPress=\{onRetry\} accessibilityRole="button" style=\{\(\{ pressed \}\) => \[s\.retry/);
  expect(field).toMatch(/retry: \{ minHeight: 44,/);
  const card = src('components/inspections/TaskInspectionsCard.tsx');
  expect(card).toMatch(/<Pressable[^>]*onPress=\{\(\) => open\(of\.inspectionId, of\.title\)\}/);
  expect(card).toMatch(/followLink: \{ minHeight: 44,/);
});
