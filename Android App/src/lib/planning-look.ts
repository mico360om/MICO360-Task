/**
 * How Timeline and Workload look (Stage 3): the website's health pill (components/timeline/parts.tsx
 * HealthPill — words and an icon, never colour alone) and bar fills (BAR_TONE). Text only ever
 * uses a `toneStyle` pair, which lib/contrast.test.ts checks in light and dark (Review Focus 7).
 */
import type { IconName } from './icons';
import type { Palette } from './theme';
import type { ProjectHealth } from './planning-api';
import { toneStyle } from './tone';
import type { CellTone } from './workload';

export type HealthLook = { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; icon: IconName | null };

const HEALTH: Record<ProjectHealth, HealthLook> = {
  'on-track': { label: 'On track', tone: 'success', icon: 'misc.check' },
  'at-risk': { label: 'At risk', tone: 'warning', icon: 'ui.alert' },
  late: { label: 'Late', tone: 'danger', icon: 'kit.clock' },
  'no-target': { label: 'No target', tone: 'neutral', icon: null },
};

/** On track (tick), At risk (warning sign), Late (clock), No target: words, a drawn icon and a badge tone. */
export function healthLook(h: ProjectHealth): HealthLook {
  return HEALTH[h];
}

/** A progress bar's fill: the timeline's blue on track (and without a target), amber at risk, red when late. */
export function barColor(p: Palette, h: ProjectHealth): string {
  return h === 'at-risk' ? p.warning : h === 'late' ? p.danger : p.info;
}

/**
 * A Workload day's colours: a day off is the surface-2 ground with ink-2 words, hatched; tasks due
 * on a day off amber, hatched; nothing due quiet; then green below the limit, amber at it, red over.
 * Every pair is a badge pair the contrast test checks.
 */
export function cellLook(p: Palette, tone: CellTone): { bg: string; fg: string; border: string; hatched: boolean } {
  switch (tone) {
    case 'off':
      return { bg: p.surface2, fg: p.ink2, border: p.line, hatched: true };
    case 'offdue':
      return { ...toneStyle(p, 'warning'), hatched: true };
    case 'none':
      return { ...toneStyle(p, 'neutral'), hatched: false };
    case 'below':
      return { ...toneStyle(p, 'success'), hatched: false };
    case 'at':
      return { ...toneStyle(p, 'warning'), hatched: false };
    case 'over':
    default:
      return { ...toneStyle(p, 'danger'), hatched: false };
  }
}

/** A person's week bar: green with room, amber from half the week's limit, red over it (the website's BAR). */
export function weekBarColor(p: Palette, tone: 'ok' | 'busy' | 'over'): string {
  return tone === 'over' ? p.danger : tone === 'busy' ? p.warning : p.success;
}
