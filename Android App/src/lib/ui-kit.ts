/**
 * How the website's building blocks look, decided in one pure place (components/ui/* draw them):
 * Button, PriorityBadge, Chip and Toggle, from the website's components/ui. Colours come only
 * from the palette; text always uses a tone that reads at 4.5:1 on its fill.
 */
import type { Palette } from './theme';
import type { Priority } from './types';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonLook {
  /** 'gradient' = the brand gradient; a colour; null = no fill. */
  fill: 'gradient' | string | null;
  text: string;
  border: string | null;
  /** Every size is a 44 dp touch target. */
  minHeight: 44;
  paddingHorizontal: number;
  fontSize: number;
}

const SIZES: Record<ButtonSize, { paddingHorizontal: number; fontSize: number }> = {
  sm: { paddingHorizontal: 12, fontSize: 14 },
  md: { paddingHorizontal: 16, fontSize: 14 },
  lg: { paddingHorizontal: 20, fontSize: 16 },
};

/** The website's Button: gradient primary, neutral secondary, quiet ghost, red danger. */
export function buttonLook(p: Palette, variant: ButtonVariant, size: ButtonSize): ButtonLook {
  const base = { minHeight: 44 as const, ...SIZES[size] };
  switch (variant) {
    case 'primary':
      return { fill: 'gradient', text: p.onBrand, border: null, ...base };
    case 'secondary':
      return { fill: p.surface, text: p.ink, border: p.line, ...base };
    case 'ghost':
      return { fill: null, text: p.ink2, border: null, ...base };
    case 'danger':
      return { fill: p.danger, text: p.onBrand, border: null, ...base };
  }
}

const PRIORITY_LABEL: Record<Priority, 'Low' | 'Normal' | 'High' | 'Urgent'> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

/** The website's PriorityBadge: Low and Normal neutral (Normal in full ink), High amber, Urgent red. */
export function priorityLook(p: Palette, priority: Priority): { bg: string; fg: string; label: 'Low' | 'Normal' | 'High' | 'Urgent' } {
  const label = PRIORITY_LABEL[priority];
  switch (priority) {
    case 'LOW':
      return { bg: p.ground, fg: p.ink2, label };
    case 'HIGH':
      return { bg: p.warningSoft, fg: p.warningText, label };
    case 'URGENT':
      return { bg: p.dangerSoft, fg: p.dangerText, label };
    case 'NORMAL':
    default:
      return { bg: p.ground, fg: p.ink, label };
  }
}

/** A filter/choice chip: selected = brand fill with white text, otherwise a quiet outline. */
export function chipLook(p: Palette, selected: boolean): { bg: string; fg: string; border: string } {
  return selected ? { bg: p.brand, fg: p.onBrand, border: p.brand } : { bg: p.surface, fg: p.ink2, border: p.line };
}

/** The website's Toggle: brand track when on, line when off; a white thumb. */
export function toggleLook(p: Palette, on: boolean): { track: string; thumb: string } {
  return { track: on ? p.brand : p.line, thumb: p.onBrand };
}

/** The website's Avatar sizes (box and initials text, in dp); xl is its Profile photo (h-28, text-3xl). */
export const AVATAR_SIZES = { sm: { box: 24, text: 10 }, md: { box: 32, text: 12 }, lg: { box: 64, text: 18 }, xl: { box: 112, text: 30 } } as const;
export type AvatarSize = keyof typeof AVATAR_SIZES;

export type ProjectAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/** The website's ProjectAvatar sizes: tile, initials, drawn icon and corner radius. */
export const PROJECT_AVATAR_SIZES: Record<ProjectAvatarSize, { box: number; text: number; icon: number; radius: number }> = {
  xs: { box: 20, text: 9, icon: 12, radius: 6 },
  sm: { box: 24, text: 10, icon: 14, radius: 6 },
  md: { box: 32, text: 12, icon: 18, radius: 8 },
  lg: { box: 44, text: 15, icon: 22, radius: 14 },
  xl: { box: 64, text: 20, icon: 32, radius: 18 },
  '2xl': { box: 96, text: 30, icon: 46, radius: 24 },
};

/** A progress value as a whole percent, 0–100 (anything not a number counts as 0). */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
