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

it('the pad draws with react-native-svg and PanResponder, keeps the page still while signing, and exports without the guide', () => {
  const p = src('components/inspections/SignaturePad.tsx');
  for (const m of ['PanResponder.create(', 'onPanResponderTerminationRequest: () => false', 'toDataURL(', 'pngDataUrl(', 'SIGNATURE_COLORS.paper', 'exportSize(']) expect(p, m).toContain(m);
  expect(src('components/inspections/SignFinishSheet.tsx')).toContain('scrollEnabled={!signing}');
  expect(src('components/inspections/SignFinishSheet.tsx')).toMatch(/signatureInputs\(/);
});

it('signing queues the finish on the phone, then sends', () => expect(s()).toMatch(/outbox\.queueFinish\(ownerId, inspectionId, [^)]+\)[^]*await send\(\)/));

it('a finish that went through offers to mark its task done, once', () => {
  expect(s()).toMatch(/view\.finishedOffer/);
  expect(s()).toMatch(/Alert\.alert\(INSPECTION_WORDS\.markDoneTitle/);
  expect(s()).toMatch(/resources\.tasks\.move\(offer\.id, offer\.doneColumnId\)/);
  expect(s()).toMatch(/approvalNotice\(offer\.doneColumnId, moved\) \?\? INSPECTION_WORDS\.markedDone/);
  expect(s()).toMatch(/ackFinished\(ownerId, inspectionId\)/);
});

it('the signed card can take the signatures back', () => expect(src('components/inspections/FinishCard.tsx')).toMatch(/INSPECTION_WORDS\.takeBack/));

it('a report goes to the client only from the preview’s Show to client (Review Focus 5)', () => {
  const sw = src('components/inspections/InspectionClientSwitch.tsx');
  expect(sw).toMatch(/clientSwitchStep\(/);
  expect(sw.match(/setClientVisible\([^)]*true\)/g)).toHaveLength(1);
  expect(sw).toMatch(/onConfirm=\{[^}]*setClientVisible\([^)]*true\)/);
  expect(sw).toMatch(/queryKey: \['inspection', detail\.id, 'client-preview'\]/);
  expect(sw).toMatch(/staleTime: 0/);
});

it('the report downloads through the exporter, a delete forgets the phone’s copy', () => {
  const a = src('components/inspections/InspectionActions.tsx');
  expect(a).toMatch(/exportFile\(resources\.inspections\.reportPdfPath\(/);
  expect(a).toMatch(/outbox\.discard\(ownerId, /);
  expect(a).toMatch(/navigation\.replace\('ProjectDetail', \{ projectId: [^,]+, tab: 'inspections' \}\)/);
  expect(a).toMatch(/outbox\.remember\(ownerId, result\)/);
});

it('throwing away what is on the phone asks first', () => {
  expect(s()).toMatch(/onDiscard=\{\(\) => confirmDiscard\(/);
  expect(src('components/inspections/InspectionActions.tsx')).toMatch(/export function confirmDiscard\([^]*Alert\.alert\(ACTION_WORDS\.discardTitle/);
});

it('keeps what it read only once the phone’s records are read (Final I1)', () => {
  expect(s()).toMatch(/if \(!ready \|\| !q\.data \|\| !ownerId \|\| !outbox\) return;/);
  expect(s()).toMatch(/\}, \[ready, q\.data, ownerId, outbox\]\);/);
});
