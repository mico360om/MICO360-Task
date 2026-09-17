import {
  boardDateFromKey,
  boardDateKey,
  planCarryForward,
  type CarryForwardConfig,
  type CarryLogEntry,
  type CarryTask,
} from './board-date';

/** Data access the daily carry-forward sweep needs (kept minimal so the logic stays pure/testable). */
export interface CarryForwardRepo {
  /** Candidate tasks with a board day before `beforeAnchor` (still-open filtering is done in logic). */
  listCarryCandidates(beforeAnchor: Date): Promise<CarryTask[]>;
  /** Move one task onto a new board day and append a carry-forward history entry. */
  applyCarry(id: string, toAnchor: Date, entry: CarryLogEntry): Promise<void>;
}

export interface CarryForwardServiceDeps {
  repo: CarryForwardRepo;
  /** Resolves the current config (enabled + which statuses) — read from settings each run. */
  config: () => Promise<CarryForwardConfig>;
  /** Company time zone that defines when "a new day" starts. */
  timeZone: string;
  now?: () => Date;
}

/**
 * Moves still-open tasks left on past days onto today's board (per-date boards). Completed tasks are
 * never touched (they stay on their completion day). Idempotent per day: a task already on today is
 * skipped, so running the sweep more than once in a day is safe.
 */
export function createCarryForwardService({ repo, config, timeZone, now = () => new Date() }: CarryForwardServiceDeps) {
  async function run(atNow: Date = now()): Promise<{ carried: number }> {
    const cfg = await config();
    if (!cfg.enabled) return { carried: 0 };
    const todayKey = boardDateKey(atNow, timeZone);
    const todayAnchor = boardDateFromKey(todayKey);
    const candidates = await repo.listCarryCandidates(todayAnchor);
    const plans = planCarryForward(candidates, todayKey, cfg, timeZone, atNow);
    for (const p of plans) {
      await repo.applyCarry(p.id, todayAnchor, p.logEntry);
    }
    return { carried: plans.length };
  }
  return { run };
}

export type CarryForwardService = ReturnType<typeof createCarryForwardService>;
