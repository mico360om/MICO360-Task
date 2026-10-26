import { ValidationError } from '../../lib/http-errors';
import { todayKey } from '../../lib/due-date';
import type { AiConfigRepository } from './ai-config-repository';
import { effectiveModel, type AiConfig, type AiModel } from './ai-config';
import { complete, COMPLETION_TIMEOUT_MS, type ChatModel } from './ai-completion';
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
  /**
   * The active portal users a described meeting may invite (first name, last name and username
   * only go in the prompt). Without it, nobody is matched.
   */
  listPeople?: () => Promise<MeetingCandidate[]>;
  repo: AiConfigRepository;
  fetchImpl?: typeof fetch;
  /** Per-user request budget. Default 10 a minute, 200 a day. */
  limits?: Partial<AiUsageLimits>;
  /** Company time zone: "today" for date parsing and the daily budget. Default Asia/Muscat. */
  timeZone?: string;
  /** Allow provider URLs on private / internal hosts (e.g. a local Ollama). Default false. */
  allowPrivateHosts?: boolean;
  /** Abort a provider call after this long. Default 120 seconds (a model may be loading); the minutes draft gets 180. */
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
  listPeople,
  fetchImpl,
  limits,
  timeZone = 'Asia/Muscat',
  allowPrivateHosts = false,
  timeoutMs = COMPLETION_TIMEOUT_MS,
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

  /**
   * One completion with the default chat model. `json`: the answer is parsed as JSON, so a provider
   * that can hold the model to JSON is asked to (MICO360 AI); `wait` overrides the time allowed.
   */
  async function run(
    system: string,
    prompt: string,
    maxTokens: number | undefined,
    requester?: AiRequester,
    opts: { json?: boolean; wait?: number; signal?: AbortSignal; dailyOnly?: boolean } = {},
  ): Promise<string> {
    const { model, chat } = resolveChatModel(await repo.load());
    if (requester) {
      if (opts.dailyOnly) usage.takeDaily(requester.userId);
      else usage.take(requester.userId);
    }
    const release = await gate.acquire(model.id, model.concurrencyLimit);
    try {
      return await complete(chat, { system, prompt, maxTokens, json: opts.json }, doFetch, { timeoutMs: opts.wait ?? timeoutMs, allowPrivateHosts, signal: opts.signal });
    } finally {
      release();
    }
  }

  /** Is a chat model set up and usable? (MICO AI says so on its page before anyone types.) */
  async function chatReady(): Promise<boolean> {
    return effectiveModel(await repo.load(), 'chat') !== null;
  }

  /**
   * One model call for MICO AI's tool loop: the default chat model, its concurrency slot and the
   * configured wait, with the caller's stop. With a requester, the call counts against the person's
   * daily AI limit, the same one every AI feature uses; the minute counted the question once
   * (startMicoAiQuestion), so a question of several steps never fails halfway on the minute.
   */
  async function chat(input: { system: string; prompt: string; maxTokens?: number; json?: boolean; signal?: AbortSignal }, requester?: AiRequester): Promise<string> {
    return run(input.system, input.prompt, input.maxTokens, requester, { json: input.json, signal: input.signal, dailyOnly: true });
  }

  /** A MICO AI question starts: it counts once against the minute; throws (429) when the minute or the day is used up. */
  function startMicoAiQuestion(userId: string): void {
    usage.startQuestion(userId);
  }

  /** Break a task into 3–7 short checklist steps. */
  async function breakdownTask(input: { title: string; description?: string }, requester?: AiRequester): Promise<string[]> {
    const text = await run(
      'You break a work task into a short, actionable checklist. Reply with ONLY JSON: {"steps": [3 to 7 short imperative steps, each under ~10 words]}. No numbering, no commentary.',
      `Title: ${input.title}\nDescription: ${input.description?.trim() || '(none)'}`,
      512,
      requester,
      { json: true },
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
  /** The person's projects for a prompt (not archived ones), and the prompt lines listing them. */
  async function promptProjects(requester?: AiRequester): Promise<{ projects: DescribableProject[]; projectList: string }> {
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
    return { projects, projectList };
  }

  async function parseTask(input: { text: string; today?: string }, requester?: AiRequester): Promise<DescribedTask> {
    // "Today" is the company-local date: before 04:00 in Muscat the UTC date is still yesterday.
    const today = input.today ?? todayKey(timeZone, now());
    const { projects, projectList } = await promptProjects(requester);
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
      { json: true },
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

  /**
   * Fill the new-meeting form from a sentence: only what it says of the title, day, time, length,
   * repeat, project, place, link, people, guests and agenda. People are matched among the active
   * users by the ids the model gives, checked against that list; a name more than one person goes
   * by comes back as a choice, never a guess. Emails and links are kept only if the sentence has them.
   */
  async function parseMeeting(input: { text: string; today?: string }, requester?: AiRequester): Promise<DescribedMeeting> {
    const today = input.today ?? todayKey(timeZone, now());
    const { projects, projectList } = await promptProjects(requester);
    // Everyone active is checked for shared names; the first 300 (by name) are listed for the model.
    const everyone = (listPeople ? await listPeople() : [])
      .map((p) => ({ ...p, name: `${p.firstName} ${p.lastName}`.trim() || p.username }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const people = everyone.slice(0, MAX_PROMPT_PEOPLE);
    const peopleList = people.length ? `\nPeople (id | name | username), one per line:\n${people.map((p) => `${p.id} | ${p.name} | ${p.username}`).join('\n')}` : '';
    const text = await run(
      [
        `Fill in a meeting from the user's sentence. Today is ${today}; times are company time. Reply with ONLY JSON:`,
        '{"title": string, "description": string|null, "date": "YYYY-MM-DD"|null, "startTime": "HH:MM" (24-hour)|null, "minutes": number|null,',
        ' "repeat": null | {"freq": "DAILY"|"WEEKLY"|"MONTHLY"|"QUARTERLY"|"YEARLY", "interval": number, "weekdays"?: number[] (0=Sunday…6=Saturday, WEEKLY only), "dayOfMonth"?: number (MONTHLY/QUARTERLY), "until"?: "YYYY-MM-DD", "count"?: number},',
        ' "project": string|null, "location": string|null, "onlineLink": string|null,',
        ' "people": [{"said": string, "ids": string[]}], "guests": [{"email": string, "name": string}], "agenda": string[]}.',
        'Title: concise, without date, time, people or project words. Description: only details the sentence gives beyond the title; else null.',
        'date: resolve relative days like "Monday" or "tomorrow"; null if none. minutes: how long it lasts; null if not said. Repeat: only if the sentence says it repeats; else null.',
        'location: a place written in the sentence; onlineLink: a link written in the sentence; else null.',
        people.length
          ? 'people: each person named, "said" as written; "ids": every id from the people list whose name could be them (several if unsure, none if nobody fits).'
          : 'people: each person named, with "ids": [].',
        'guests: email addresses written in the sentence, each with the name given for it, else "". agenda: the topics the sentence lists; else [].',
        projects.length ? 'project: the code of the project from the list the meeting is about; null if none fits.' : 'project: null.',
      ].join('\n') + projectList + peopleList,
      input.text,
      900,
      requester,
      { json: true },
    );
    const obj = parseJsonObject(text);
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    // No title from the model: none is suggested (the sentence itself, e.g. "move it to Tuesday", isn't one).
    const title = str(obj.title, 300);
    const rawDescription = str(obj.description, 4000);
    const description = rawDescription && normalise(rawDescription) !== normalise(title ?? '') ? rawDescription : null;
    const minutes = typeof obj.minutes === 'number' && Number.isInteger(obj.minutes) && obj.minutes >= 5 && obj.minutes <= 720 ? obj.minutes : null;
    const match = matchProject(input.text, typeof obj.project === 'string' ? obj.project : null, projects);
    const link = str(obj.onlineLink, 2000);
    return {
      title,
      description,
      date: isDay(obj.date) ? obj.date : null,
      startTime: typeof obj.startTime === 'string' && HHMM.test(obj.startTime) ? obj.startTime : null,
      minutes,
      recurrence: toRepeatRule(obj.repeat),
      project: match ? { id: match.id, code: match.code, number: match.number, name: match.name } : null,
      location: str(obj.location, 200),
      onlineLink: link && /^https?:\/\//i.test(link) && input.text.includes(link) ? link : null,
      people: matchPeople(obj.people, everyone),
      guests: guestsIn(input.text, obj.guests),
      agenda: (Array.isArray(obj.agenda) ? obj.agenda : []).map((a) => str(a, 300)).filter((a): a is string => !!a).slice(0, MAX_AGENDA_POINTS),
    };
  }

  /**
   * Propose a meeting's agenda from what was typed, the project's open tasks and the last meeting's
   * leftovers. Each item gets a lead from the invited people (anyone else is dropped) and minutes,
   * scaled so the items fit the meeting's length.
   */
  async function draftAgenda(input: DraftAgendaInput, requester?: AiRequester): Promise<DraftedAgendaItem[]> {
    const lines = [
      `Meeting: ${input.title}`,
      input.description?.trim() ? `Description: ${input.description.trim()}` : '',
      input.text?.trim() ? `What the organizer wrote: ${input.text.trim()}` : '',
      `Length: ${input.minutes} minutes`,
      input.people.length ? `People (id | name), one per line:\n${input.people.map((p) => `${p.id} | ${p.name}`).join('\n')}` : 'People: none listed',
      input.tasks.length ? `Open project tasks (key | title | why):\n${input.tasks.map((t) => `${t.key} | ${t.title} | ${t.reason}`).join('\n')}` : '',
      input.leftovers.length ? `Left open by the last meeting:\n${input.leftovers.map((l) => `${l.kind === 'action' ? 'Action item' : 'Agenda item'}: ${l.title}`).join('\n')}` : '',
    ].filter(Boolean);
    const text = await run(
      [
        'You plan business meetings. Propose up to 12 agenda items for the meeting below, drawing on what the organizer wrote, the open project tasks and what the last meeting left open.',
        'Write in the language the organizer wrote in. Each title is short (under 10 words); never invent names, dates or numbers.',
        'Reply with ONLY JSON: {"items": [{"title": string, "ownerId": an id from the people list or null, "minutes": number}]}.',
        'The minutes of all agenda items together must fit the meeting length.',
      ].join('\n'),
      lines.join('\n\n'),
      900,
      requester,
      { json: true },
    );
    const raw = parseJsonObject(text).items;
    const invited = new Set(input.people.map((p) => p.id));
    const items = (Array.isArray(raw) ? raw : [])
      .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {}))
      .map((v) => ({
        title: typeof v.title === 'string' ? v.title.trim().slice(0, 300) : '',
        ownerId: typeof v.ownerId === 'string' && invited.has(v.ownerId) ? v.ownerId : null,
        minutes: typeof v.minutes === 'number' && Number.isFinite(v.minutes) && v.minutes >= 1 ? Math.round(v.minutes) : null,
      }))
      .filter((i) => i.title)
      // At most 12, and no more items than the meeting has minutes (each gets at least one).
      .slice(0, Math.min(MAX_DRAFT_AGENDA, input.minutes));
    if (items.length === 0) throw new ValidationError('The AI didn’t suggest an agenda. Try again, or add the items yourself.');
    const share = Math.max(1, Math.round(input.minutes / items.length));
    const asked = items.map((i) => i.minutes ?? share);
    const total = asked.reduce((s, m) => s + m, 0);
    const scale = total > input.minutes ? input.minutes / total : 1;
    return items.map((i, n) => ({ title: i.title, ownerId: i.ownerId, minutes: Math.max(1, Math.floor(asked[n]! * scale)) }));
  }

  /** A short description for a meeting's invitation, from its title, agenda and what was typed. */
  async function writeMeetingDescription(input: { title: string; agenda?: string[]; text?: string }, requester?: AiRequester): Promise<string> {
    const text = await run(
      [
        'You write the description of a business meeting invitation: 1 to 3 sentences on its purpose and what it covers.',
        'Write in the language the organizer wrote in (Arabic or English). Use only what is given: never invent names, dates or numbers.',
        'Reply with ONLY JSON: {"description": string}.',
      ].join('\n'),
      [
        `Meeting: ${input.title}`,
        input.agenda?.length ? `Agenda:\n${input.agenda.map((a) => `- ${a}`).join('\n')}` : '',
        input.text?.trim() ? `What the organizer wrote: ${input.text.trim()}` : '',
      ].filter(Boolean).join('\n\n'),
      500,
      requester,
      { json: true },
    );
    const description = parseJsonObject(text).description;
    const out = typeof description === 'string' ? description.trim().slice(0, 2000) : '';
    if (!out) throw new ValidationError('The AI didn’t write a description. Try again, or write it yourself.');
    return out;
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
      { json: true },
    );
    const obj = parseJsonObject(text);
    const priority = PRIORITIES.includes(obj.priority as Priority) ? (obj.priority as Priority) : 'NORMAL';
    const reason = typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 140) : '';
    return { priority, reason };
  }

  /**
   * Draft a meeting's final minutes from its facts (see meetings/final-minutes minutesFacts). The
   * model is told to write only what the facts support. Returns its JSON; the caller checks it.
   */
  async function draftMinutes(facts: string, requester?: AiRequester, opts: { signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
    const text = await run(
      [
        'You write the final minutes of a business meeting. Use only the facts given: never invent names, dates, numbers or decisions.',
        'Write concise, professional sentences, in the language the notes are written in.',
        'Reply with ONLY JSON: {"summary": string (2-4 sentences: the purpose and the outcome),',
        ' "discussion": [{"topic": string (an agenda item, or "Other points"), "text": string (what was discussed, 1-4 sentences)}],',
        ' "decisions": string[], "risks": string[] (risks, issues and open questions), "nextSteps": string[] (each "action — owner, by date" when known)}.',
        'Leave a list empty when the facts give nothing for it.',
      ].join('\n'),
      facts,
      2500,
      requester,
      // A long answer: ~2,500 tokens at ~35 a second, after a cold load, is well over 2 minutes.
      { json: true, wait: Math.max(timeoutMs, MINUTES_TIMEOUT_MS), signal: opts.signal },
    );
    const obj = parseJsonObject(text);
    if (Object.keys(obj).length === 0) throw new ValidationError('The AI’s draft couldn’t be read. Try again, or start from the notes.');
    return obj;
  }

  return { breakdownTask, parseTask, parseMeeting, draftAgenda, writeMeetingDescription, summarizeProject, suggestPriority, draftMinutes, chatReady, chat, startMicoAiQuestion };
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

/** An active portal user a described meeting may invite. */
export interface MeetingCandidate {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
}

/** What a sentence fills in on the new-meeting form (null or empty where it says nothing). */
export interface DescribedMeeting {
  title: string | null;
  description: string | null;
  /** YYYY-MM-DD, company time. */
  date: string | null;
  /** HH:MM, 24-hour, company time. */
  startTime: string | null;
  minutes: number | null;
  recurrence: RecurrenceRule | null;
  project: { id: string; code: string; number: string | null; name: string } | null;
  location: string | null;
  onlineLink: string | null;
  people: {
    found: Array<{ id: string; name: string; username: string }>;
    /** A name that fits more than one person: they choose. */
    choices: Array<{ said: string; options: Array<{ id: string; name: string; username: string }> }>;
    notFound: string[];
  };
  guests: Array<{ email: string; name: string }>;
  agenda: string[];
}

/** What Draft agenda works from (the server gathers the tasks and leftovers). */
export interface DraftAgendaInput {
  title: string;
  description?: string;
  text?: string;
  /** The meeting's length: the items' minutes are fitted to it. */
  minutes: number;
  /** The invited portal users (the organizer included): the only possible leads. */
  people: Array<{ id: string; name: string }>;
  tasks: Array<{ key: string; title: string; reason: 'overdue' | 'blocked' | 'due' }>;
  leftovers: Array<{ title: string; kind: 'action' | 'agenda' }>;
}

export interface DraftedAgendaItem {
  title: string;
  ownerId: string | null;
  minutes: number;
}

const MAX_DRAFT_AGENDA = 12;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** At most this many people are listed in the prompt (each one is a line). */
const MAX_PROMPT_PEOPLE = 300;
const MAX_AGENDA_POINTS = 10;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * The model's people, checked: only ids of active people count. A name more than one person goes by
 * is a choice even when the model picked one of them. So is a one-word name that isn't exactly the
 * person the model picked ("Omer", "عمر" for Omar) when others share that person's first name: that
 * is a guess. One id is found; none is "not found".
 */
function matchPeople(value: unknown, people: Array<MeetingCandidate & { name: string }>): DescribedMeeting['people'] {
  const order = new Map(people.map((p, i) => [p.id, i]));
  const out: DescribedMeeting['people'] = { found: [], choices: [], notFound: [] };
  for (const entry of (Array.isArray(value) ? value : []).slice(0, 50)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const said = typeof e.said === 'string' ? e.said.trim().slice(0, 100) : '';
    if (!said) continue;
    const ids = (Array.isArray(e.ids) ? e.ids : []).filter((id): id is string => typeof id === 'string' && order.has(id));
    const n = normalise(said);
    const named = (p: MeetingCandidate & { name: string }) => [p.firstName, p.lastName, p.username, p.name].some((x) => normalise(x) === n);
    const sameName = people.filter(named).map((p) => p.id);
    let chosen = [...new Set([...ids, ...(sameName.length > 1 ? sameName : [])])];
    if (chosen.length === 1 && !n.includes(' ')) {
      const only = people[order.get(chosen[0]!)!]!;
      const namesakes = people.filter((p) => normalise(p.firstName) === normalise(only.firstName)).map((p) => p.id);
      if (!named(only) && namesakes.length > 1) chosen = namesakes;
    }
    const options = chosen
      .sort((a, b) => order.get(a)! - order.get(b)!)
      .map((id) => ({ id, name: people[order.get(id)!]!.name, username: people[order.get(id)!]!.username }));
    if (options.length === 1) {
      if (!out.found.some((f) => f.id === options[0]!.id)) out.found.push(options[0]!);
    } else if (options.length > 1) out.choices.push({ said, options });
    else out.notFound.push(said);
  }
  return out;
}

/** The email addresses written in the sentence, named as the model says, else from the part before the @. */
function guestsIn(sentence: string, value: unknown): DescribedMeeting['guests'] {
  const named = new Map<string, string>();
  for (const g of Array.isArray(value) ? value : []) {
    if (!g || typeof g !== 'object') continue;
    const { email, name } = g as Record<string, unknown>;
    if (typeof email === 'string' && typeof name === 'string' && name.trim()) named.set(email.trim().toLowerCase(), name.trim().slice(0, 200));
  }
  const seen = new Set<string>();
  const guests: DescribedMeeting['guests'] = [];
  for (const email of sentence.match(EMAIL) ?? []) {
    const key = email.toLowerCase();
    if (seen.has(key) || guests.length >= 50) continue;
    seen.add(key);
    guests.push({ email, name: named.get(key) ?? email.split('@')[0]! });
  }
  return guests;
}

/** The minutes draft is the one long answer: it gets 3 minutes, as MICO360 AI's guide advises for long text. */
const MINUTES_TIMEOUT_MS = 180_000;

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
