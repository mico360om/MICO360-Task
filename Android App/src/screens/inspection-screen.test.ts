import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** The inspection screen, checked by its source (Stage 4 Tasks 7, 8, 11). */
const s = () => src('screens/InspectionScreen.tsx');

it('opens from the copy on the phone with no signal, and says so', () => {
  expect(s()).toMatch(/view \?\? \(q\.data \? detailView\(q\.data\) : null\)/);
  expect(s()).toContain('INSPECTION_WORDS.noSignal');
  expect(s()).toContain('INSPECTION_WORDS.showingCopy');
});

it('keeps what it read so it opens offline next time', () => expect(s()).toMatch(/outbox\.remember\(ownerId, q\.data\)/));

it('waits for the phone’s records before deciding there is no copy', () => expect(s()).toMatch(/if \(!ready\) return <SkeletonList/));

it('every answer goes through the outbox, never straight to the server', () => {
  expect(s()).toMatch(/outbox\.saveAnswer\(ownerId, inspectionId, /);
  expect(s()).toMatch(/sendSoon\(\)/);
  expect(s()).not.toMatch(/inspections\.answer\(/);
});

it('answers stop while signed or refused', () => expect(s()).toMatch(/p\.canAnswer && !finished && !view\.locked && view\.problem\?\.stage !== 'answers'/));

it('the reading box takes decimals and the item is a radio group', () => {
  const r = src('components/inspections/InspectionItemRow.tsx');
  expect(r).toContain('keyboardType="decimal-pad"');
  expect(r).toContain('accessibilityRole="radio"');
  expect(r).toContain('accessibilityRole="radiogroup"');
  expect(r).toMatch(/maxLength=\{INSPECTION_LIMITS\.readingMax\}/);
  expect(r).toMatch(/DRAFT_DELAY_MS/);
});

it('the banner tells TalkBack when the changes can’t be sent, and when they all went', () => {
  const b = src('components/inspections/SyncBanner.tsx');
  expect(b).toMatch(/AccessibilityInfo\.announceForAccessibility\(/);
  expect(b).toContain('SYNC_ANNOUNCE[');
  expect(b).toContain('BACK_ONLINE');
  expect(b).toMatch(/syncLine\(syncWord\(view, sync, online\), view\)/);
});

it('the screen is registered', () => expect(src('navigation/RootNavigator.tsx')).toMatch(/<AppStack\.Screen name="Inspection" component=\{InspectionScreen\}/));

it('reads the inspection without an offline copy of its own (the outbox’s record is the copy)', () => {
  const q = src('core/inspection-queries.ts');
  expect(q).toMatch(/queryKey: \['inspection', id\]/);
  expect(q).toMatch(/retry: \(n, e\) => !isNetworkError\(e\) && n < 1/);
});
