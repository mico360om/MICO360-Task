import {
  DUE_SOON_TOKEN,
  HEALTH_TOKEN,
  OVERDUE_TOKEN,
  PRIORITY_TOKEN,
  STATUS_TOKEN,
  healthLevel,
  type HealthLevel,
  type PriorityLevel,
  type StatusKind,
} from './colour-scheme';

/**
 * 1.23.8 The colour scheme (lib/colour-scheme.ts) as the website's classes — the only place a component
 * gets a status, priority, overdue, due-soon or health colour from (a test fails on any other). Written
 * out in full so Tailwind finds every class.
 *
 * - `dot`: a small round mark (or a stripe, a bar) in the fill colour;
 * - `chip`: a soft tint with the colour's words on it (a pill or badge);
 * - `text`: the colour as words, on the page or a card;
 * - `edge` / `ring`: a border in the fill colour.
 */
export interface ToneClasses {
  dot: string;
  chip: string;
  text: string;
  edge: string;
  ring: string;
  /** The soft tint alone (a highlighted row, a track behind a bar). */
  soft: string;
}

export const STATUS_CLASS: Record<StatusKind, ToneClasses> = {
  BACKLOG: { dot: 'bg-status-backlog', chip: 'bg-status-backlog-soft text-status-backlog', text: 'text-status-backlog', edge: 'border-status-backlog', ring: 'ring-status-backlog', soft: 'bg-status-backlog-soft' },
  TODO: { dot: 'bg-status-todo', chip: 'bg-status-todo-soft text-status-todo', text: 'text-status-todo', edge: 'border-status-todo', ring: 'ring-status-todo', soft: 'bg-status-todo-soft' },
  IN_PROGRESS: { dot: 'bg-status-progress', chip: 'bg-status-progress-soft text-status-progress', text: 'text-status-progress', edge: 'border-status-progress', ring: 'ring-status-progress', soft: 'bg-status-progress-soft' },
  BLOCKED: { dot: 'bg-status-blocked', chip: 'bg-status-blocked-soft text-status-blocked', text: 'text-status-blocked', edge: 'border-status-blocked', ring: 'ring-status-blocked', soft: 'bg-status-blocked-soft' },
  REVIEW: { dot: 'bg-status-review', chip: 'bg-status-review-soft text-status-review', text: 'text-status-review', edge: 'border-status-review', ring: 'ring-status-review', soft: 'bg-status-review-soft' },
  DONE: { dot: 'bg-status-done', chip: 'bg-status-done-soft text-status-done', text: 'text-status-done', edge: 'border-status-done', ring: 'ring-status-done', soft: 'bg-status-done-soft' },
};

export const PRIORITY_CLASS: Record<PriorityLevel, ToneClasses> = {
  URGENT: { dot: 'bg-prio-urgent', chip: 'bg-prio-urgent-soft text-prio-urgent', text: 'text-prio-urgent', edge: 'border-prio-urgent', ring: 'ring-prio-urgent', soft: 'bg-prio-urgent-soft' },
  HIGH: { dot: 'bg-prio-high', chip: 'bg-prio-high-soft text-prio-high', text: 'text-prio-high', edge: 'border-prio-high', ring: 'ring-prio-high', soft: 'bg-prio-high-soft' },
  NORMAL: { dot: 'bg-prio-normal', chip: 'bg-prio-normal-soft text-prio-normal', text: 'text-prio-normal', edge: 'border-prio-normal', ring: 'ring-prio-normal', soft: 'bg-prio-normal-soft' },
  LOW: { dot: 'bg-prio-low', chip: 'bg-prio-low-soft text-prio-low', text: 'text-prio-low', edge: 'border-prio-low', ring: 'ring-prio-low', soft: 'bg-prio-low-soft' },
};

/** Overdue: red words and a red edge (owner, 6 Nov). */
export const OVERDUE_CLASS: ToneClasses = { dot: 'bg-overdue', chip: 'bg-overdue-soft text-overdue', text: 'text-overdue', edge: 'border-overdue', ring: 'ring-overdue', soft: 'bg-overdue-soft' };
/** Due today or tomorrow: amber. */
export const DUE_SOON_CLASS: ToneClasses = { dot: 'bg-soon', chip: 'bg-soon-soft text-soon', text: 'text-soon', edge: 'border-soon', ring: 'ring-soon', soft: 'bg-soon-soft' };

export const HEALTH_CLASS: Record<HealthLevel, ToneClasses> = {
  ON_TRACK: { dot: 'bg-health-ok', chip: 'bg-health-ok-soft text-health-ok', text: 'text-health-ok', edge: 'border-health-ok', ring: 'ring-health-ok', soft: 'bg-health-ok-soft' },
  AT_RISK: { dot: 'bg-health-risk', chip: 'bg-health-risk-soft text-health-risk', text: 'text-health-risk', edge: 'border-health-risk', ring: 'ring-health-risk', soft: 'bg-health-risk-soft' },
  LATE: { dot: 'bg-health-late', chip: 'bg-health-late-soft text-health-late', text: 'text-health-late', edge: 'border-health-late', ring: 'ring-health-late', soft: 'bg-health-late-soft' },
};

/** A status kind's classes; anything unknown reads as To do (as the boards do). */
export function statusClass(kind: string | null | undefined): ToneClasses {
  return STATUS_CLASS[(kind ?? '') as StatusKind] ?? STATUS_CLASS.TODO;
}

/** A priority's classes (Normal for anything unknown). */
export function priorityClass(p: string | null | undefined): ToneClasses {
  return PRIORITY_CLASS[(p ?? '') as PriorityLevel] ?? PRIORITY_CLASS.NORMAL;
}

/** The Management page's GREEN / AMBER / RED or the Timeline's on-track / at-risk / late (null: no health, e.g. no target). */
export function healthClass(h: string): ToneClasses | null {
  const level = healthLevel(h);
  return level ? HEALTH_CLASS[level] : null;
}

const cssColour = (token: string) => `rgb(var(--c-${token}))`;

/**
 * The fill colour as a CSS value, for what can't take a class: an inline style (a chart's bar, an SVG
 * line), a `color-mix()`. Follows light and dark.
 */
export const statusColour = (kind: string | null | undefined): string => cssColour(STATUS_TOKEN[(kind ?? '') as StatusKind] ?? STATUS_TOKEN.TODO);
export const priorityColour = (p: string | null | undefined): string => cssColour(PRIORITY_TOKEN[(p ?? '') as PriorityLevel] ?? PRIORITY_TOKEN.NORMAL);
export const healthColour = (h: HealthLevel): string => cssColour(HEALTH_TOKEN[h]);
export const OVERDUE_COLOUR = cssColour(OVERDUE_TOKEN);
export const DUE_SOON_COLOUR = cssColour(DUE_SOON_TOKEN);

/**
 * A due date's words in the scheme: red and bold when overdue, amber and bold when due today or tomorrow,
 * else `otherwise`. (The words say "Overdue"; the date says when — amber is an extra cue, never the only one.)
 */
export function dueTone(state: { late: boolean; soon?: boolean }, otherwise = 'text-ink-2'): string {
  return state.late ? `font-semibold ${OVERDUE_CLASS.text}` : state.soon ? `font-semibold ${DUE_SOON_CLASS.text}` : otherwise;
}
