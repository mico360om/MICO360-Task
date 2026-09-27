import { ValidationError } from '../../lib/http-errors';
import { todayKey } from '../../lib/due-date';
import type { AiConfigRepository } from './ai-config-repository';
import { usableModels, type AiConfig, type AiModel } from './ai-config';
import { complete, type ChatModel } from './ai-completion';
import { createSafeFetch } from './ai-network';
import { createAiUsageLimiter, createConcurrencyGate, type AiUsageLimits } from './ai-limits';

export interface AiFeatureServiceDeps {
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

/** The signed-in user an AI request is made for (per-user limits). */
export interface AiRequester {
  userId: string;
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
    const usable = usableModels(config, 'chat');
    if (usable.length === 0) {
      throw new ValidationError('AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.');
    }
    const model = usable.find((m) => m.id === config.defaults.chat) ?? usable[0]!;
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

  /** Turn a free-text note into a structured task (title + optional due date + priority). */
  async function parseTask(
    input: { text: string; today?: string },
    requester?: AiRequester,
  ): Promise<{ title: string; dueDate: string | null; priority: Priority | null }> {
    // "Today" is the company-local date: before 04:00 in Muscat the UTC date is still yesterday.
    const today = input.today ?? todayKey(timeZone, now());
    const text = await run(
      `Extract a single task from the user's note. Today is ${today}. Reply with ONLY JSON: {"title": string, "dueDate": string|null (YYYY-MM-DD, resolve relative dates like "Friday"/"tomorrow"), "priority": "LOW"|"NORMAL"|"HIGH"|"URGENT"|null}. Keep the title concise; drop date/priority words from it.`,
      input.text,
      256,
      requester,
    );
    const obj = parseJsonObject(text);
    const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : input.text.trim();
    const dueDate = typeof obj.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.dueDate) ? obj.dueDate : null;
    const priority = PRIORITIES.includes(obj.priority as Priority) ? (obj.priority as Priority) : null;
    return { title, dueDate, priority };
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
