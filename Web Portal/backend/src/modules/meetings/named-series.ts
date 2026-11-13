/**
 * 1.23 Meeting series ("named series" in the code — the word "series" alone means a repeat family
 * here: recurrenceParentId, meeting-series.ts). A named series groups related meetings — made one
 * by one, repeating, or both — under a name ("Monthly site review"). It belongs to a project, or (for
 * meetings without a project) to a company, and only that project's (company's) meetings are in it.
 * A meeting is in at most one series; each repeat family is always in one.
 *
 * This file holds the pure parts: the records, the place rule, the Previous / Next navigation and
 * the "New meeting in this series" pre-fill.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MeetingStatus } from './meeting-repository';

/** The backfill migration (data only; safe to run again): every repeat family gets its series. */
export const SERIES_BACKFILL_MIGRATION = '20261105110100_meeting_series_backfill';

/** The backfill migration file, from the source tree (src/…) or the build (dist/src/…). */
export const SERIES_BACKFILL_SQL_PATH: string = (() => {
  const file = ['prisma', 'migrations', SERIES_BACKFILL_MIGRATION, 'migration.sql'];
  const candidates = [resolve(__dirname, '..', '..', '..', ...file), resolve(__dirname, '..', '..', '..', '..', ...file)];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
})();

/** A series' name: 1–200 characters. */
export const SERIES_NAME_MAX = 200;

export interface NamedSeriesRecord {
  id: string;
  name: string;
  /** The project it belongs to (null: a series of meetings without a project, in `companyId`). */
  projectId: string | null;
  companyId: string | null;
  /** Made automatically for a repeating meeting: removed when it is left empty. */
  auto: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNamedSeriesData {
  name: string;
  projectId: string | null;
  companyId: string | null;
  auto: boolean;
  createdById: string;
}

/** A meeting as a series needs it: when, its place, its people (who may see it), its repeat and minutes. */
export interface SeriesMeetingRow {
  id: string;
  title: string;
  status: MeetingStatus;
  startAt: Date;
  endAt: Date | null;
  timeZone: string | null;
  projectId: string | null;
  companyId: string | null;
  organizerId: string;
  createdById: string;
  attendeeUserIds: string[];
  /** Its repeat family's first meeting (itself when it is the first), or null for a one-off. */
  familyRootId: string | null;
  seriesId: string | null;
  /** Its final minutes are approved. */
  minutesFinal: boolean;
}

/** Where a series (and a meeting) belongs: a project, else a company. */
export type SeriesPlace = { projectId: string; companyId: null } | { projectId: null; companyId: string | null };

export function placeOf(m: { projectId: string | null; companyId?: string | null }): SeriesPlace {
  return m.projectId ? { projectId: m.projectId, companyId: null } : { projectId: null, companyId: m.companyId ?? null };
}

/** Is the meeting in the series' place (its project, or — without a project — its company)? */
export function samePlace(a: { projectId: string | null; companyId?: string | null }, b: { projectId: string | null; companyId?: string | null }): boolean {
  const pa = placeOf(a);
  const pb = placeOf(b);
  return pa.projectId === pb.projectId && (pa.projectId !== null || pa.companyId === pb.companyId);
}

/** A meeting's repeat family's first meeting, or null for a one-off. */
export function familyRootOf(m: { id: string; recurrenceParentId: string | null; recurrenceRule: unknown }): string | null {
  return m.recurrenceParentId ?? (m.recurrenceRule ? m.id : null);
}

/** One meeting of a series as a page lists it. */
export interface SeriesMeetingItem {
  id: string;
  title: string;
  status: MeetingStatus;
  startAt: Date;
  endAt: Date | null;
  timeZone: string | null;
  minutesFinal: boolean;
  /** One of a repeat family. */
  repeats: boolean;
  /** The meeting the page is about. */
  current?: boolean;
}

export interface SeriesNeighbour {
  id: string;
  title: string;
  startAt: Date;
}

/** "3 of 5 · ‹ Previous · Next ›": counted over meetings that go ahead (not cancelled). */
export interface SeriesNav {
  /** This meeting's place among them (null when it is cancelled, or the only one shown). */
  position: number | null;
  total: number;
  previous: SeriesNeighbour | null;
  next: SeriesNeighbour | null;
}

const byStart = (a: { startAt: Date; id: string }, b: { startAt: Date; id: string }) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id);

/** The series' meetings in date order (earliest first; equal starts by id, so the order is stable). */
export function inDateOrder<T extends { startAt: Date; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(byStart);
}

/**
 * Where the meeting sits among the meetings shown (the ones this person may open), counting only
 * those going ahead: cancelled ones are listed but skipped by "n of N", Previous and Next. With only
 * this meeting shown, nothing is counted (just the series' name shows).
 */
export function seriesNav(shown: readonly SeriesMeetingRow[], currentId: string): SeriesNav {
  const ordered = inDateOrder(shown);
  const at = ordered.findIndex((r) => r.id === currentId);
  const live = ordered.filter((r) => r.status !== 'CANCELLED');
  const neighbour = (r: SeriesMeetingRow | undefined): SeriesNeighbour | null => (r ? { id: r.id, title: r.title, startAt: r.startAt } : null);
  if (at < 0 || ordered.length <= 1) return { position: null, total: live.length, previous: null, next: null };
  const before = ordered.slice(0, at).filter((r) => r.status !== 'CANCELLED');
  const after = ordered.slice(at + 1).filter((r) => r.status !== 'CANCELLED');
  const current = ordered[at]!;
  return {
    position: current.status === 'CANCELLED' ? null : before.length + 1,
    total: live.length,
    previous: neighbour(before.at(-1)),
    next: neighbour(after[0]),
  };
}

/** The meeting "New meeting in this series" is copied from: the latest one going ahead, else the latest. */
export function latestOf<T extends { startAt: Date; id: string; status: MeetingStatus }>(rows: readonly T[]): T | null {
  const ordered = inDateOrder(rows);
  return ordered.filter((r) => r.status !== 'CANCELLED').at(-1) ?? ordered.at(-1) ?? null;
}

/**
 * The online link "New meeting in this series" starts with: the latest meeting's. A link Teams made
 * (or was asked to make) is not copied — each meeting made "in this series" gets its own Teams meeting
 * (design B) — so the form starts with no link and "Create a Teams link" ticked (`teamsLink`); the tick
 * counts only for someone who can make one (the form's rule).
 */
export function prefillLink(latest: { onlineLink: string | null; onlineMeetingProvider?: 'TEAMS' | null }): { onlineLink: string | null; teamsLink?: true } {
  if (latest.onlineMeetingProvider === 'TEAMS') return { onlineLink: null, teamsLink: true };
  return { onlineLink: latest.onlineLink };
}
