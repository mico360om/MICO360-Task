import { it, expect } from 'vitest';
import { appSource as src, appSources } from '../testing/web-source';

/**
 * Device check A (31 Oct): the status bar's height was added twice — once by the white top bar (or a
 * stack screen's header) and again by the screen under it — leaving an empty band under the bar. The
 * top bar owns the top inset; a signed-in screen sits under a bar, so it takes none itself.
 */
it('no signed-in screen pads the top inset again (the top bar or the stack header owns it)', () => {
  const doubled = appSources()
    .filter(([file]) => file.startsWith('screens/') && !file.startsWith('screens/auth/'))
    .filter(([, text]) => /edges=\{\[[^\]]*'top'/.test(text))
    .map(([file]) => file);
  expect(doubled).toEqual([]);
});

it('the white top bar is what pads the status bar', () => {
  expect(src('components/AppTopBar.tsx')).toMatch(/paddingTop: insets\.top, height: insets\.top \+ 56/);
});

// The side menu is a Modal, whose window starts under the status bar on Android (it isn't
// statusBarTranslucent): padding it by the status bar again left a tall empty area above the logo.
it('the side menu adds no top inset of its own', () => {
  const drawer = src('components/AppDrawer.tsx');
  expect(drawer).not.toMatch(/statusBarTranslucent/);
  expect(drawer).not.toMatch(/paddingTop: insets\.top/);
});
