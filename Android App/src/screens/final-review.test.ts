import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** Fixes from the final review of Stage 1 that are checked in the source. */

// Item 4: ink3 is never put on brandWash (4.48:1) — a selected saved view is brandWash.
it('the delete mark on a saved view reads on its selected wash', () => {
  expect(src('screens/MyTasksScreen.tsx')).not.toMatch(/<Icon name="ui\.close" size=\{14\} color=\{c\.ink3\} \/>/);
});

// Item 5: a chip's count is drawn at full strength (an opacity took it under 4.5:1).
it('the chip count has no opacity', () => expect(src('components/ui/Chip.tsx')).not.toMatch(/count: \{[^}]*opacity/));
