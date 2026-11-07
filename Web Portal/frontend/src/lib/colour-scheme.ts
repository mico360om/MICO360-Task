/**
 * 1.23.8 — one fixed colour scheme for statuses, priorities, overdue, due soon and project health, used
 * everywhere: board columns and cards, lists, tables, the calendar, the timeline, the dashboard, the
 * PDFs and the server's emails. The owner chose it (6–7 Nov): no per-board or per-company colours.
 *
 * Statuses: Backlog grey · To do slate · In progress blue · Blocked red · Review purple · Done green.
 * Priorities: Urgent red · High orange · Normal blue-grey · Low grey. Overdue: red (text and an edge);
 * due soon: amber. Health (its own names, not statuses): on track green · at risk amber · late red.
 * Colour is never the only sign — a word or an icon always goes with it.
 *
 * Each colour has three tones, for light and dark:
 *  - `fill`: dots, stripes, bars and edges — at least 3:1 against the page and card backgrounds;
 *  - `text`: the colour as words — at least 4.5:1 on the page, on cards and on its own `soft` tint;
 *  - `soft`: a tint for chips and highlighted rows.
 * The website reads them as CSS variables (index.css, `--c-<token>`, `--c-<token>-text`, `--c-<token>-soft`;
 * a test keeps both in step); the server reads this same file (a copy in backend/src/lib, kept identical by a
 * test) for its PDFs and emails. No imports: both sides load it on its own.
 */

export interface Tone {
  fill: string;
  text: string;
  soft: string;
}

export type ThemeTones = { light: Tone; dark: Tone };

/** The column kinds (statuses), in board order. */
export const STATUS_KINDS = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/** Priorities, most urgent first. */
export const PRIORITY_LEVELS = ['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

/** A project's health (the Management page's Green / Amber / Red; the Timeline's on track / at risk / late). */
export const HEALTH_LEVELS = ['ON_TRACK', 'AT_RISK', 'LATE'] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];

/** Each token's CSS variable name (without `--c-`). */
export const STATUS_TOKEN: Record<StatusKind, string> = {
  BACKLOG: 'status-backlog',
  TODO: 'status-todo',
  IN_PROGRESS: 'status-progress',
  BLOCKED: 'status-blocked',
  REVIEW: 'status-review',
  DONE: 'status-done',
};
export const PRIORITY_TOKEN: Record<PriorityLevel, string> = { URGENT: 'prio-urgent', HIGH: 'prio-high', NORMAL: 'prio-normal', LOW: 'prio-low' };
export const HEALTH_TOKEN: Record<HealthLevel, string> = { ON_TRACK: 'health-ok', AT_RISK: 'health-risk', LATE: 'health-late' };
export const OVERDUE_TOKEN = 'overdue';
export const DUE_SOON_TOKEN = 'soon';

const RED: ThemeTones = { light: { fill: '#CB4632', text: '#B83E2B', soft: '#FBEDEA' }, dark: { fill: '#E0644F', text: '#EE8C79', soft: '#4A2D27' } };
const GREEN: ThemeTones = { light: { fill: '#2E7D53', text: '#2A744D', soft: '#E9F4EE' }, dark: { fill: '#4AB07A', text: '#63C490', soft: '#2C3C30' } };
const AMBER: ThemeTones = { light: { fill: '#B87611', text: '#8F5B0B', soft: '#FBF1E1' }, dark: { fill: '#DC9E42', text: '#E6B266', soft: '#493824' } };
const GREY: ThemeTones = { light: { fill: '#8F8580', text: '#6B625D', soft: '#F4F3F2' }, dark: { fill: '#A0958F', text: '#B8AEA8', soft: '#3D3734' } };

export const STATUS_TONES: Record<StatusKind, ThemeTones> = {
  BACKLOG: GREY,
  TODO: { light: { fill: '#5B6C82', text: '#4F5F74', soft: '#EFF0F3' }, dark: { fill: '#8D9DB3', text: '#A7B5C8', soft: '#39383B' } },
  IN_PROGRESS: { light: { fill: '#2F6DB5', text: '#2B64A6', soft: '#EAF0F8' }, dark: { fill: '#5B9BE0', text: '#82B4EA', soft: '#2F3844' } },
  BLOCKED: RED,
  REVIEW: { light: { fill: '#7C56B4', text: '#6E4BA4', soft: '#F2EEF8' }, dark: { fill: '#A485D8', text: '#BEA6E8', soft: '#3E3342' } },
  DONE: GREEN,
};

export const PRIORITY_TONES: Record<PriorityLevel, ThemeTones> = {
  URGENT: RED,
  HIGH: { light: { fill: '#D0631A', text: '#A84C10', soft: '#FAEFE8' }, dark: { fill: '#E8873F', text: '#F0A26A', soft: '#4B3424' } },
  NORMAL: { light: { fill: '#62748A', text: '#53647A', soft: '#EFF1F3' }, dark: { fill: '#8E9FB5', text: '#A9B7CA', soft: '#39393B' } },
  LOW: GREY,
};

export const OVERDUE_TONES: ThemeTones = RED;
export const DUE_SOON_TONES: ThemeTones = AMBER;
export const HEALTH_TONES: Record<HealthLevel, ThemeTones> = { ON_TRACK: GREEN, AT_RISK: AMBER, LATE: RED };

/** Every token with its tones — what index.css must say (`--c-<name>`, `-text`, `-soft`). */
export function allTokens(): Array<[name: string, tones: ThemeTones]> {
  return [
    ...STATUS_KINDS.map((k) => [STATUS_TOKEN[k], STATUS_TONES[k]] as [string, ThemeTones]),
    ...PRIORITY_LEVELS.map((p) => [PRIORITY_TOKEN[p], PRIORITY_TONES[p]] as [string, ThemeTones]),
    [OVERDUE_TOKEN, OVERDUE_TONES],
    [DUE_SOON_TOKEN, DUE_SOON_TONES],
    ...HEALTH_LEVELS.map((h) => [HEALTH_TOKEN[h], HEALTH_TONES[h]] as [string, ThemeTones]),
  ];
}

/** A status kind's tones; anything unknown reads as To do (as the boards do). */
export function statusTones(kind: string | null | undefined): ThemeTones {
  return STATUS_TONES[(kind ?? '') as StatusKind] ?? STATUS_TONES.TODO;
}

/** The Management page’s Green / Amber / Red and the Timeline’s words as one health level. */
export function healthLevel(h: string): HealthLevel | null {
  if (h === 'GREEN' || h === 'on-track') return 'ON_TRACK';
  if (h === 'AMBER' || h === 'at-risk') return 'AT_RISK';
  if (h === 'RED' || h === 'late') return 'LATE';
  return null;
}
