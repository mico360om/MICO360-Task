import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

// Stage 2 Task 4: "To approve" at the top of My Tasks (the website's ToApproveSection).
it('My Tasks starts with To approve, above the views', () => {
  const s = src('screens/MyTasksScreen.tsx');
  // The Views row is the eyebrow text ">Views<" (the file also says "useSavedViews" in its imports).
  expect(s.indexOf('<ToApproveSection')).toBeGreaterThan(s.indexOf('<PageHeader'));
  expect(s.indexOf('<ToApproveSection')).toBeLessThan(s.indexOf('>Views<'));
  expect(s.indexOf('<ToApproveSection')).toBeLessThan(s.indexOf('placeholder="Search my tasks…"'));
});
it('"Review all" from the Dashboard lands on it', () => expect(src('screens/MyTasksScreen.tsx')).toMatch(/route\.params\?\.show === 'to-approve'[^]*setParams\(\{ show: undefined \}\)/));
it('a failed decision stays on its row in words (offline too)', () => expect(src('components/approvals/ToApproveSection.tsx')).toMatch(/failureText\(e, APPROVAL_SECTION_TEXT\.(approveFailed|sendBackFailed)\)/));
it('each row opens its task and decides through the shared actions, named for the task, saying so when done', () => {
  const s = src('components/approvals/ToApproveSection.tsx');
  expect(s).toMatch(/toApproveRows\(/); expect(s).toMatch(/useApprovalActions\(\)/);
  expect(s).toMatch(/onOpen\(row\.task\.id\)/);
  expect(s).toMatch(/accessibilityLabel=\{row\.approveLabel\}/); expect(s).toMatch(/accessibilityLabel=\{row\.sendBackLabel\}/);
  expect(s).toMatch(/notice\(approvedNotice\(/); expect(s).toMatch(/notice\(sentBackNotice\(/);
  expect(s).toMatch(/<ProjectAvatar project=\{row\.task\.project\} size="xs"/);
  expect(s).toMatch(/<SendBackSheet/);
  expect(s).toMatch(/if \(rows\.length === 0\) return null/);
});
