/**
 * How Timeline and Workload look (Stage 3): the website's health pill (components/timeline/parts.tsx
 * HealthPill — words and an icon, never colour alone) and bar fills (BAR_TONE). Text only ever
 * uses a `toneStyle` pair, which lib/contrast.test.ts checks in light and dark (Review Focus 7).
 */
import type { IconName } from './icons';
import type { Palette } from './theme';
import type { ProjectHealth } from './planning-api';

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
