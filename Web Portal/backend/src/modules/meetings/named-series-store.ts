import type { ActionItemRecord } from './action-item-repository';
import type { CreateNamedSeriesData, NamedSeriesRecord, SeriesMeetingRow, SeriesPlace } from './named-series';

/** Where named series (and which meetings are in them) are kept. Meetings read here are never deleted ones. */
export interface NamedSeriesStore {
  find(id: string): Promise<NamedSeriesRecord | null>;
  create(data: CreateNamedSeriesData): Promise<NamedSeriesRecord>;
  rename(id: string, name: string): Promise<NamedSeriesRecord>;
  /** Delete the series; its meetings stay (they are in no series afterwards). */
  remove(id: string): Promise<void>;
  /** The series' meetings, earliest first. */
  meetingsOf(seriesId: string): Promise<SeriesMeetingRow[]>;
  /** One meeting as a series sees it (null: none, or deleted). */
  meeting(id: string): Promise<SeriesMeetingRow | null>;
  /** A repeat family's meetings: its first meeting and the meetings made from it. */
  family(rootId: string): Promise<SeriesMeetingRow[]>;
  /** Put these meetings in the series (null: in none). */
  link(meetingIds: string[], seriesId: string | null): Promise<void>;
  /** The series of a place (a project, or a company's meetings without a project), newest first. */
  ofPlace(place: SeriesPlace): Promise<NamedSeriesRecord[]>;
  /** The place's one-off meetings in no series, newest first, at most `limit`. */
  unseriedOfPlace(place: SeriesPlace, limit: number): Promise<SeriesMeetingRow[]>;
  /** Series names by id (the meetings list's chips). */
  names(ids: string[]): Promise<Map<string, string>>;
  /** The open action items (not completed or cancelled) of these meetings. */
  openActionItems(meetingIds: string[]): Promise<ActionItemRecord[]>;
}
