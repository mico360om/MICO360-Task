import { NotFoundError, ValidationError } from '../../lib/http-errors';
import type { AgendaRepository, AgendaItemRecord } from './agenda-repository';
import type { CanEditMeeting } from './meeting-access';

export interface AddAgendaInput {
  title: string;
  ownerId?: string | null;
  expectedMinutes?: number | null;
  linkedPrevActionId?: string | null;
}

export interface UpdateAgendaInput {
  title?: string;
  ownerId?: string | null;
  expectedMinutes?: number | null;
}

export interface AgendaServiceDeps {
  agenda: AgendaRepository;
  /** Fired after the agenda changes, so the meeting aggregate can broadcast. */
  onChanged?: (meetingId: string) => void;
  /** Who may change the agenda (organizer / creator / project manager / admin). Open when not wired. */
  canEditMeeting?: CanEditMeeting;
}

export interface AgendaService {
  /** May this user change the meeting's agenda? */
  canEditMeeting: CanEditMeeting;
  listAgenda(meetingId: string): Promise<AgendaItemRecord[]>;
  getItem(meetingId: string, itemId: string): Promise<AgendaItemRecord>;
  addItem(meetingId: string, input: AddAgendaInput): Promise<AgendaItemRecord>;
  updateItem(meetingId: string, itemId: string, patch: UpdateAgendaInput): Promise<AgendaItemRecord>;
  setCompleted(meetingId: string, itemId: string, completed: boolean): Promise<AgendaItemRecord>;
  removeItem(meetingId: string, itemId: string): Promise<void>;
  /** Apply the given id order (positions 0..n) to this meeting's items; ids not in the meeting are ignored. */
  reorder(meetingId: string, orderedIds: string[]): Promise<AgendaItemRecord[]>;
}

const trim = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t.length ? t : null;
};

export function createAgendaService(deps: AgendaServiceDeps): AgendaService {
  const { agenda } = deps;

  async function requireInMeeting(meetingId: string, itemId: string): Promise<AgendaItemRecord> {
    const rec = await agenda.findById(itemId);
    if (!rec || rec.meetingId !== meetingId) throw new NotFoundError('Agenda item not found.');
    return rec;
  }

  return {
    canEditMeeting: (userId, roles, meetingId) => (deps.canEditMeeting ? deps.canEditMeeting(userId, roles, meetingId) : Promise.resolve(true)),

    async listAgenda(meetingId) {
      return agenda.listByMeeting(meetingId);
    },

    async getItem(meetingId, itemId) {
      return requireInMeeting(meetingId, itemId);
    },

    async addItem(meetingId, input) {
      const title = (input.title ?? '').trim();
      if (!title) throw new ValidationError('An agenda item needs a title.');
      if (input.expectedMinutes != null && (input.expectedMinutes < 0 || !Number.isFinite(input.expectedMinutes))) {
        throw new ValidationError('Expected minutes must be a positive number.');
      }
      const existing = await agenda.listByMeeting(meetingId);
      const position = existing.length ? Math.max(...existing.map((i) => i.position)) + 1 : 0;
      const rec = await agenda.add({
        meetingId,
        title,
        ownerId: trim(input.ownerId),
        expectedMinutes: input.expectedMinutes ?? null,
        position,
        linkedPrevActionId: trim(input.linkedPrevActionId),
      });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async updateItem(meetingId, itemId, patch) {
      if (patch.title !== undefined && !patch.title.trim()) throw new ValidationError('An agenda item needs a title.');
      if (patch.expectedMinutes != null && (patch.expectedMinutes < 0 || !Number.isFinite(patch.expectedMinutes))) {
        throw new ValidationError('Expected minutes must be a positive number.');
      }
      await requireInMeeting(meetingId, itemId);
      const rec = await agenda.update(itemId, {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.ownerId !== undefined ? { ownerId: trim(patch.ownerId) } : {}),
        ...(patch.expectedMinutes !== undefined ? { expectedMinutes: patch.expectedMinutes } : {}),
      });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async setCompleted(meetingId, itemId, completed) {
      await requireInMeeting(meetingId, itemId);
      const rec = await agenda.update(itemId, { completed });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async removeItem(meetingId, itemId) {
      await requireInMeeting(meetingId, itemId);
      await agenda.remove(itemId);
      deps.onChanged?.(meetingId);
    },

    async reorder(meetingId, orderedIds) {
      const items = await agenda.listByMeeting(meetingId);
      const own = new Set(items.map((i) => i.id));
      const ordered = orderedIds.filter((id) => own.has(id));
      // Append any items the caller didn't mention, preserving their current order.
      const trailing = items.filter((i) => !ordered.includes(i.id)).map((i) => i.id);
      const finalOrder = [...ordered, ...trailing];
      await agenda.setPositions(finalOrder.map((id, index) => ({ id, position: index })));
      deps.onChanged?.(meetingId);
      return agenda.listByMeeting(meetingId);
    },
  };
}
