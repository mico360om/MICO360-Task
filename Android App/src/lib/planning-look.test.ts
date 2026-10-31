import { it, expect } from 'vitest';
import { isIconName } from './icons';
import { darkColors, lightColors } from './theme';
import { toneStyle } from './tone';
import { HEALTH_LABEL } from './timeline';
import { barColor, cellLook, healthLook, weekBarColor } from './planning-look';

/** Stage 3 (Review Focus 7): every Timeline and Workload pill, chip and day cell uses a colour pair the contrast test checks. */
it('the health pill is the website’s words, drawn icons and badge tones', () => {
  expect(healthLook('late')).toEqual({ label: 'Late', tone: 'danger', icon: 'kit.clock' }); expect(healthLook('no-target')).toEqual({ label: 'No target', tone: 'neutral', icon: null });
  expect(healthLook('on-track')).toEqual({ label: 'On track', tone: 'success', icon: 'misc.check' }); expect(healthLook('at-risk')).toEqual({ label: 'At risk', tone: 'warning', icon: 'ui.alert' });
  for (const h of ['on-track', 'at-risk', 'late', 'no-target'] as const) { expect(healthLook(h).label).toBe(HEALTH_LABEL[h]); const i = healthLook(h).icon; if (i) expect(isIconName(i)).toBe(true); }
  expect(barColor(lightColors, 'at-risk')).toBe(lightColors.warning); expect(barColor(darkColors, 'no-target')).toBe(darkColors.info);
  expect(barColor(lightColors, 'on-track')).toBe(lightColors.info); expect(barColor(darkColors, 'late')).toBe(darkColors.danger);
});
it('day cells use only colour pairs the contrast test checks', () => {
  for (const p of [lightColors, darkColors]) {
    expect(cellLook(p, 'over')).toMatchObject(toneStyle(p, 'danger')); expect(cellLook(p, 'at')).toMatchObject(toneStyle(p, 'warning'));
    expect(cellLook(p, 'off')).toEqual({ bg: p.surface2, fg: p.ink2, border: p.line, hatched: true });
    expect(cellLook(p, 'offdue')).toEqual({ ...toneStyle(p, 'warning'), hatched: true });
    expect(cellLook(p, 'none')).toEqual({ ...toneStyle(p, 'neutral'), hatched: false });
    expect(cellLook(p, 'below')).toEqual({ ...toneStyle(p, 'success'), hatched: false });
    expect([weekBarColor(p, 'ok'), weekBarColor(p, 'busy'), weekBarColor(p, 'over')]).toEqual([p.success, p.warning, p.danger]);
  }
});
