import { ValidationError } from '../../lib/http-errors';
import { todayKey } from '../../lib/due-date';
import type { AiConfigRepository } from './ai-config-repository';
import { effectiveModel, type AiConfig, type AiModel } from './ai-config';
import { complete, type ChatModel } from './ai-completion';
import { createSafeFetch } from './ai-network';
import { createAiUsageLimiter, createConcurrencyGate, type AiUsageLimits } from './ai-limits';
import { isValidRule, type RecurrenceRule } from '../tasks/recurrence';

/** A project a person can add tasks to, as "Describe it in plain English" may suggest it. */
export interface DescribableProject {
  id: string;
  code: string;
  number: string | null;
  name: string;
  status: string;
}

export interface AiFeatureServiceDeps {
  /**
   * The projects the person may add tasks to (archived ones are left out here), so a described
   * task can suggest one. Without it, no project is suggested.
   */
  listProjectsFor?: (user: { id: string; roles: string[] }) => Promise<DescribableProject[]>;
  repo: AiConfigRepository;
  fetchImpl?: typeof fetch;
  /** Per-user request budget. Default 10 a minute, 200 a day. */
  limits?: Partial<AiUsageLimits>;
  /** Company time zone: "today" for date parsing and the daily budget. Default Asia/Muscat. */
  timeZone?: string;
  /** Allow provider URLs on private / internal hosts (e.g. a local Ollama). Default false. */
  allowPrivateHosts?: boolean;
  /** Abort a provider call after this long. Default 60 seconds. */
  timeoutMs?: number;
  /** How long a request may wait for a free slot under the model's concurrency limit. Default 20 seconds. */
  slotWaitMs?: number;
  now?: () => Date;
}

/** The signed-in user an AI request is made for (per-user limits; their roles decide which projects they see). */
export interface AiRequester {
  userId: string;
  roles?: string[];
}

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
type Priority = (typeof PRIORITIES)[number];

export interface ProjectSummaryInput {
  name: string;
  stats: { total: number; completed: number; inProgress: number; overdue: number };
  sampleTitles?: string[];
}

/**
 * Product-facing AI features (task breakdown, natural-language task capture, project status
 * summary, priority suggestion). Each resolves the admin-configured default *chat* model from
 * the AI config and calls the provider — so the AI Management screen actually drives behaviour.
 */
export function createAiFeatureService({
  repo,
  listProjectsFor,
  fetchImpl,
  limits,
  timeZone = 'Asia/Muscat',
  allowPrivateHosts = false,
  timeoutMs = 60_000,
  slotWaitMs = 20_000,
  now = () => new Date(),
}: AiFeatureServiceDeps) {
  const doFetch = fetchImpl ?? createSafeFetch({ allowPrivateHosts });
  const usage = createAiUsageLimiter({ perMinute: limits?.perMinute ?? 10, perDay: limits?.perDay ?? 200 }, timeZone, now);
  const gate = createConcurrencyGate(slotWaitMs);

  function resolveChatModel(config: AiConfig): { model: AiModel; chat: ChatModel } {
    // The admin's default chat model while it is usable, otherwise the recommended one ("Automatic").
    const model = effectiveModel(config, 'chat');
    if (!model) {
      throw new ValidationError('AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.');
    }
    const provider = config.providers.find((p) => p.id === model.providerId)!;
    return { model, chat: { provider, modelKey: model.modelKey, parameters: model.parameters } };
  }

  async function run(system: string, prompt: string, maxTokens: number | undefined, requester?: AiRequester): Promise<string> {
    const { model, chat } = resolveChatModel(await repo.load());
    if (requester) usage.take(requester.userId);
    const release = await gate.acquire(model.id, model.concurrencyLimit);
    try {
      return await complete(chat, { system, prompt, maxTokens }, doFetch, { timeoutMs, allowPrivateHosts });
    } finally {
      release();
    }
  }

  /** Break a task into 3–7 short checklist steps. */
  async function breakdownTask(input: { title: string; description?: string }, requester?: AiRequester): Promise<string[]> {
    const text = await run(
      'You break a work task into a short, actionable checklist. Reply with ONLY a JSON array of 3 to 7 short imperative steps (each under ~10 words). No numbering, no commentary.',
      `Title: ${input.title}\nDescription: ${input.description?.trim() || '(none)'}`,
      512,
      requester,
    );
    const items = parseStringArray(text)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (items.length === 0) throw new ValidationError('The AI response could not be parsed into checklist items.');
    return items;
  }

  /**
   * Turn a free-text note into a task: a title, and only what the note says of a description,
   * due date, priority, repeat and project. The project is one the person can add tasks to: the
   * one whose number or code is written in the note, else the one the model names.
   */
  async function parseTask(input: { text: string; today?: string }, requester?: AiRequester): Promise<DescribedTask> {
    // "Today" is the company-local date: before 04:00 in Muscat the UTC date is still yesterday.
    const today = input.today ?? todayKey(timeZone, now());
    const projects =
      listProjectsFor && requester
        ? (await listProjectsFor({ id: requester.userId, roles: requester.roles ?? [] }))
            .filter((p) => p.status !== 'ARCHIVED')
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, MAX_PROMPT_PROJECTS)
        : [];
    const projectList = projects.length
      ? `\nProjects (code | number | name), one per line:\n${projects.map((p) => `${p.code} | ${p.number ?? '-'} | ${p.name}`).join('\n')}`
      : '';
    const text = await run(
      [
        `Extract a single task from the user's note. Today is ${today}. Reply with ONLY JSON:`,
        '{"title": string, "description": string|null, "dueDate": string|null, "priority": "LOW"|"NORMAL"|"HIGH"|"URGENT"|null,',
        ' "repeat": null | {"freq": "DAILY"|"WEEKLY"|"MONTHLY"|"QUARTERLY"|"YEARLY", "interval": number, "weekdays"?: number[] (0=Sunday…6=Saturday, WEEKLY only), "dayOfMonth"?: number (MONTHLY/QUARTERLY), "until"?: "YYYY-MM-DD", "count"?: number},',
        ' "project": string|null}.',
        'Title: concise, without date, priority, repeat or project words. Description: only details the note gives beyond the title, in a sentence or two; else null.',
        'dueDate: YYYY-MM-DD, resolving relative dates like "Friday" or "tomorrow"; null if none. Repeat: only if the note says the task repeats; else null.',
        projects.length ? 'project: the code of the project from the list the note is about; null if none fits.' : 'project: null.',
      ].join('\n') + projectList,
      input.text,
      600,
      requester,
    );
    const obj = parseJsonObject(text);
    const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : input.text.trim();
    const rawDescription = typeof obj.description === 'string' ? obj.description.trim().slice(0, 4000) : '';
    const description = rawDescription && normalise(rawDescription) !== normalise(title) ? rawDescription : null;
    const dueDate = typeof obj.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.dueDate) ? obj.dueDate : null;
    const priority = PRIORITIES.includes(obj.priority as Priority) ? (obj.priority as Priority) : null;
    const recurrence = toRepeatRule(obj.repeat);
    const match = matchProject(input.text, typeof obj.project === 'string' ? obj.project : null, projects);
    const project = match ? { id: match.id, code: match.code, number: match.number, name: match.name } : null;
    return { title, description, dueDate, priority, recurrence, project };
  }

  /** A concise 2–3 sentence status summary for a project. */
  async function summarizeProject(input: ProjectSummaryInput, requester?: AiRequester): Promise<string> {
    const { name, stats, sampleTitles } = input;
    const pct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
    const summary = await run(
      'You are a delivery manager. Write a concise, plain-language status update in 2–3 sentences: overall progress, what needs attention, and momentum. No headings, no bullet points.',
      [
        `Project: ${name}`,
        `Tasks: ${stats.total} total, ${stats.completed} completed (${pct}%), ${stats.inProgress} in progress, ${stats.overdue} overdue.`,
        sampleTitles?.length ? `Recent items: ${sampleTitles.slice(0, 8).join('; ')}.` : '',
      ].filter(Boolean).join('\n'),
      300,
      requester,
    );
    return summary.trim();
  }

  /** Suggest a priority for a task with a one-line reason. */
  async function suggestPriority(
    input: { title: string; description?: string; dueDate?: string | null },
    requester?: AiRequester,
  ): Promise<{ priority: Priority; reason: string }> {
    const text = await run(
      'You triage task priority. Reply with ONLY JSON: {"priority": "LOW"|"NORMAL"|"HIGH"|"URGENT", "reason": string (max 12 words)}.',
      `Title: ${input.title}\nDescription: ${input.description?.trim() || '(none)'}\nDue: ${input.dueDate || '(none)'}`,
      120,
      requester,
    );
    const obj = parseJsonObject(text);
    const priority = PRIORITIES.includes(obj.priority as Priority) ? (obj.priority as Priority) : 'NORMAL';
    const reason = typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 140) : '';
    return { priority, reason };
  }

  return { breakdownTask, parseTask, summarizeProject, suggestPriority };
}

export type AiFeatureService = ReturnType<typeof createAiFeatureService>;

/** What a plain-English note fills in (null where it says nothing). */
export interface DescribedTask {
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: Priority | null;
  recurrence: RecurrenceRule | null;
  project: { id: string; code: string; number: string | null; name: string } | null;
}

/** At most this many projects are listed in the prompt (each one is a line). */
const MAX_PROMPT_PROJECTS = 100;
const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const isDay = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const wholeInt = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined;

/**
 * A model's "repeat" as a rule the task form can use, or null. Only the fields the form edits are
 * kept (frequency, interval, weekdays, day of month, end date or count); anything else is dropped.
 */
export function toRepeatRule(value: unknown): RecurrenceRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!FREQUENCIES.includes(v.freq as (typeof FREQUENCIES)[number])) return null;
  if (typeof v.interval === 'number' && v.interval < 1) return null;
  const rule: RecurrenceRule = { freq: v.freq as RecurrenceRule['freq'], interval: wholeInt(v.interval, 1, 99) ?? 1 };
  if (rule.freq === 'WEEKLY' && Array.isArray(v.weekdays)) {
    const days = [...new Set(v.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (days.length) rule.weekdays = days;
  }
  if ((rule.freq === 'MONTHLY' || rule.freq === 'QUARTERLY') && Number.isInteger(v.dayOfMonth) && (v.dayOfMonth as number) >= 1 && (v.dayOfMonth as number) <= 31) {
    rule.dayOfMonth = v.dayOfMonth as number;
  }
  if (isDay(v.until)) rule.until = v.until;
  else if (Number.isInteger(v.count) && (v.count as number) >= 1) rule.count = Math.min(999, v.count as number);
  return isValidRule(rule) ? rule : null;
}

/**
 * The project a note is about, among the ones the person can use: one whose number is written in
 * the note (any case) or whose code is (in capitals, as codes are written, so the word "web" isn't
 * the WEB project), else the one the model named by code, number or name. Never one outside the list.
 */
export function matchProject<P extends { code: string; number: string | null; name: string }>(
  note: string,
  named: string | null,
  projects: P[],
): P | null {
  const token = (s: string, flags: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, `u${flags}`);
  const written = projects.filter((p) => (p.number && token(p.number, 'i').test(note)) || token(p.code, '').test(note));
  if (written.length === 1) return written[0]!;
  if (named) {
    const n = normalise(named);
    const byName = projects.filter((p) => normalise(p.code) === n || (p.number && normalise(p.number) === n) || normalise(p.name) === n);
    if (byName.length === 1) return byName[0]!;
  }
  return null;
}

// ── Output parsing (LLMs sometimes wrap JSON in prose / code fences) ──────────
/** Extract a JSON string[] from model output, tolerating prose/fences; falls back to line parsing. */
export function parseStringArray(text: string): string[] {
  const arr = tryJson(sliceBetween(text, '[', ']'));
  if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
  // Fallback: treat each non-empty line as an item, stripping bullets/numbering.
  return text
    .split('\n')
    .map((l) => l.replace(/^[\s\-*\d.)\]]+/, '').trim())
    .filter(Boolean);
}

/** Extract the first JSON object from model output, tolerating prose/fences. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const obj = tryJson(sliceBetween(text, '{', '}'));
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
}

function sliceBetween(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
