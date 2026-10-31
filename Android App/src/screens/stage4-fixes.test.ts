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
