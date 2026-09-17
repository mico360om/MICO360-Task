export interface AgendaItemRecord {
  id: string;
  meetingId: string;
  title: string;
  /** Presenter/owner of this agenda point (a platform user); null if unassigned. */
  ownerId: string | null;
  expectedMinutes: number | null;
  position: number;
  completed: boolean;
  /** Optional link to an action item carried forward from a previous meeting. */
  linkedPrevActionId: string | null;
  createdAt: Date;
}

export interface CreateAgendaData {
  meetingId: string;
  title: string;
  ownerId?: string | null;
  expectedMinutes?: number | null;
  position: number;
  linkedPrevActionId?: string | null;
}

export interface UpdateAgendaData {
  title?: string;
  ownerId?: string | null;
  expectedMinutes?: number | null;
  completed?: boolean;
  position?: number;
}

export interface AgendaRepository {
  add(data: CreateAgendaData): Promise<AgendaItemRecord>;
  findById(id: string): Promise<AgendaItemRecord | null>;
  listByMeeting(meetingId: string): Promise<AgendaItemRecord[]>;
  update(id: string, patch: UpdateAgendaData): Promise<AgendaItemRecord>;
  remove(id: string): Promise<void>;
  /** Persist a new position for each id (used by reorder). */
  setPositions(updates: { id: string; position: number }[]): Promise<void>;
}
