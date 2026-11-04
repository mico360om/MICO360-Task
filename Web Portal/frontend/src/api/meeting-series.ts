import type { ApiClient } from '../lib/api-client';
import type { ActionItemStatus, MeetingStatus, Priority } from './meetings';

/**
 * 1.23 Meeting series: named series of related meetings ("Monthly OXY review"). Not a repeat — a
 * repeating meeting's own series (its first meeting and rule) is `Meeting.series`; every repeat is
 * in a named series too.
 */
export interface SeriesSummary {
  id: string;
  name: string;
  projectId: string | null;
  companyId: string | null;
  /** Made automatically for a repeating meeting. */
  auto: boolean;
}

/** One meeting of a series, as a list shows it (only meetings the signed-in person may open). */
export interface SeriesMeeting {
  id: string;
  title: string;
  status: MeetingStatus;
  startAt: string;
  endAt: string | null;
  timeZone: string | null;
  minutesFinal: boolean;
  repeats: boolean;
  /** The meeting the page is about. */
  current?: boolean;
}

export interface SeriesNeighbour {
  id: string;
  title: string;
  startAt: string;
}

/** An open action item of an earlier meeting of the series — the same item as on that meeting. */
export interface CarriedItem {
  id: string;
  description: string;
  assigneeId: string | null;
  assigneeName: string | null;
  status: ActionItemStatus;
  priority: Priority;
  dueDate: string | null;
  overdue: boolean;
  taskId: string | null;
  taskKey: string | null;
  createdById: string;
  meeting: { id: string; title: string; startAt: string };
}

/** A meeting's series on its page (null: it is in none). */
export interface MeetingSeriesContext {
  series: SeriesSummary;
  meetings: SeriesMeeting[];
  /** This meeting's place among those going ahead (null: cancelled, or the only one shown). */
  position: number | null;
  total: number;
  previous: SeriesNeighbour | null;
  next: SeriesNeighbour | null;
  openFromEarlier: CarriedItem[];
  canManage: boolean;
  canRemove: boolean;
  /** A repeat alone in its series: it can't leave it. */
  keepsRepeat: boolean;
}

export interface SeriesPage {
  series: SeriesSummary & { createdById: string };
  meetings: SeriesMeeting[];
  openActionItems: CarriedItem[];
  canManage: boolean;
  canDelete: boolean;
  keepsRepeat: boolean;
  canAdd: boolean;
  removable: string[];
  /** The project's (company's) other series this person may merge into this one. */
  mergeOptions: Array<{ id: string; name: string }>;
}

export interface SeriesOptions {
  canChange: boolean;
  repeats: boolean;
  familySize: number;
  current: { id: string; name: string; auto: boolean } | null;
  series: Array<{ id: string; name: string }>;
}

export type PrefillPerson = { kind: 'user'; id: string; name: string } | { kind: 'guest'; email: string; name: string };

/** "New meeting in this series": the form's starting values. */
export interface SeriesPrefill {
  seriesId: string;
  seriesName: string;
  title: string;
  projectId: string | null;
  companyId: string | null;
  location: string | null;
  onlineLink: string | null;
  durationMinutes: number | null;
  description: string | null;
  people: PrefillPerson[];
  agendaItems: Array<{ title: string; ownerId: string | null; expectedMinutes: number | null }>;
}

/** The server asks first before a repeating meeting's family moves ("add all its meetings?"). */
export const SERIES_REPEATS_CODE = 'SERIES_REPEATS';
/** A repeat alone in its series can't leave it, nor can that series be deleted. */
export const SERIES_KEEPS_REPEAT_CODE = 'SERIES_KEEPS_REPEAT';

export function meetingSeriesApi(client: ApiClient) {
  const enc = encodeURIComponent;
  return {
    /** The meeting page's series (null: none). */
    ofMeeting: (meetingId: string) => client.get<{ data: MeetingSeriesContext | null }>(`/meetings/${enc(meetingId)}/series`).then((r) => r.data),
    /** "Add to a series": the series of the meeting's project (company) to choose from. */
    options: (meetingId: string) => client.get<{ data: SeriesOptions }>(`/meetings/${enc(meetingId)}/series-options`).then((r) => r.data),
    get: (seriesId: string) => client.get<{ data: SeriesPage }>(`/meeting-series/${enc(seriesId)}`).then((r) => r.data),
    /** "New series…" with this meeting (`wholeFamily`: a repeating meeting's every meeting). */
    create: (input: { name: string; meetingId: string; wholeFamily?: boolean }) => client.post<{ data: SeriesSummary }>('/meeting-series', input).then((r) => r.data),
    rename: (seriesId: string, name: string) => client.patch<{ data: SeriesSummary }>(`/meeting-series/${enc(seriesId)}`, { name }).then((r) => r.data),
    remove: (seriesId: string) => client.del<void>(`/meeting-series/${enc(seriesId)}`),
    addMeetings: (seriesId: string, meetingIds: string[], wholeFamily = false) =>
      client.post<void>(`/meeting-series/${enc(seriesId)}/meetings`, { meetingIds, ...(wholeFamily ? { wholeFamily: true } : {}) }),
    removeMeeting: (seriesId: string, meetingId: string) => client.del<void>(`/meeting-series/${enc(seriesId)}/meetings/${enc(meetingId)}`),
    merge: (seriesId: string, otherId: string) => client.post<void>(`/meeting-series/${enc(seriesId)}/merge`, { seriesId: otherId }),
    candidates: (seriesId: string) => client.get<{ data: SeriesMeeting[] }>(`/meeting-series/${enc(seriesId)}/candidates`).then((r) => r.data),
    prefill: (seriesId: string) => client.get<{ data: SeriesPrefill }>(`/meeting-series/${enc(seriesId)}/prefill`).then((r) => r.data),
  };
}
