import type { AnswerSchema } from './ai-completion';

/**
 * b1: the JSON Schemas MICO360 AI holds six features' answers to (its guide, §5 "JSON output": the
 * platform passes the schema to the AI engine, which only lets the model write what fits). Kept simple,
 * as the guide asks — `type`, `properties`, `required`, `enum`, `items` — and each well under its 16,000
 * characters (ai-schemas.test). The features still check every answer as before (the second check):
 * a schema shapes what the model writes, it is not checked again by the platform.
 *
 * Only MICO360 AI is sent them; other providers are asked in the prompt, as before.
 */

const str = { type: 'string' };
/** The same, or null ("not said"): a type list, the simplest form (no anyOf). */
const nullable = (schema: { type: string; enum?: unknown[] } & Record<string, unknown>) => ({
  ...schema,
  type: [schema.type, 'null'],
  ...(schema.enum ? { enum: [...schema.enum, null] } : {}),
});
const day = { type: 'string', description: 'YYYY-MM-DD' };
const PRIORITY = { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] };
const REPEAT = nullable({
  type: 'object',
  properties: {
    freq: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] },
    interval: { type: 'integer' },
    weekdays: { type: 'array', items: { type: 'integer' }, description: '0=Sunday … 6=Saturday, WEEKLY only' },
    dayOfMonth: { type: 'integer', description: 'MONTHLY or QUARTERLY' },
    until: day,
    count: { type: 'integer' },
  },
  required: ['freq', 'interval'],
});

const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({ type: 'object', properties, required });

/** Describe a task ("Describe it in plain English"). */
export const TASK_SCHEMA: AnswerSchema = {
  name: 'task',
  schema: object({
    title: str,
    description: nullable(str),
    dueDate: nullable(day),
    priority: nullable(PRIORITY),
    repeat: REPEAT,
    project: nullable({ type: 'string', description: 'The code of a project from the list' }),
  }),
};

/** Describe a meeting (the new-meeting form's sentence). */
export const MEETING_SCHEMA: AnswerSchema = {
  name: 'meeting',
  schema: object({
    title: nullable(str),
    description: nullable(str),
    date: nullable(day),
    startTime: nullable({ type: 'string', description: 'HH:MM, 24-hour' }),
    minutes: nullable({ type: 'integer' }),
    repeat: REPEAT,
    project: nullable(str),
    location: nullable(str),
    onlineLink: nullable(str),
    people: { type: 'array', items: object({ said: str, ids: { type: 'array', items: str } }) },
    guests: { type: 'array', items: object({ email: str, name: str }) },
    agenda: { type: 'array', items: str },
  }),
};

/** Suggest a priority. */
export const PRIORITY_SCHEMA: AnswerSchema = {
  name: 'priority',
  schema: object({ priority: PRIORITY, reason: str }),
};

/** Draft a meeting's agenda. */
export const AGENDA_SCHEMA: AnswerSchema = {
  name: 'agenda',
  schema: object({
    items: { type: 'array', items: object({ title: str, ownerId: nullable(str), minutes: { type: 'integer' } }) },
  }),
};

/** Draft the final minutes (Final MOM). */
export const MINUTES_SCHEMA: AnswerSchema = {
  name: 'minutes',
  schema: object({
    summary: str,
    discussion: { type: 'array', items: object({ topic: str, text: str }) },
    decisions: { type: 'array', items: str },
    risks: { type: 'array', items: str },
    nextSteps: { type: 'array', items: str },
  }),
};

/**
 * MICO AI's reply: one action (run a tool, ask, answer, propose changes). One flat object — the guide
 * asks for simple schemas — whose `action` decides which other fields count; the loop's own reader
 * (mico-ai-loop parseAction) still checks the reply as before.
 */
export const MICO_AI_ACTION_SCHEMA: AnswerSchema = {
  name: 'mico_ai_action',
  schema: object(
    {
      action: { type: 'string', enum: ['tool', 'clarify', 'answer', 'propose'] },
      name: { type: 'string', description: 'tool: the tool to run' },
      args: { type: 'object', description: 'tool: its arguments' },
      question: { type: 'string', description: 'clarify: the question' },
      options: { type: 'array', items: str, description: 'clarify: 2 to 4 short options' },
      text: { type: 'string', description: 'answer or propose: the words' },
      tables: {
        type: 'array',
        items: object({ title: str, fromResult: str, columns: { type: 'array', items: str } }, ['fromResult']),
      },
      sources: { type: 'array', items: str },
      unavailable: { type: 'boolean' },
      followUps: { type: 'array', items: str },
      changes: { type: 'array', items: { type: 'object' }, description: 'propose: the change objects' },
    },
    ['action'],
  ),
};

/** Every schema a feature sends (the size test reads them all). */
export const ANSWER_SCHEMAS: AnswerSchema[] = [TASK_SCHEMA, MEETING_SCHEMA, PRIORITY_SCHEMA, AGENDA_SCHEMA, MINUTES_SCHEMA, MICO_AI_ACTION_SCHEMA];

/**
 * Safety net: does an answer fit the schema it was asked for? Read as the features read it (the first
 * object, past prose or a code fence), then checked against the keywords the schemas use — `type`
 * (one or a list), `enum`, `required`, `properties` and `items`. Not a full JSON Schema checker: just
 * enough to tell a strict answer from one the platform did not hold to the schema.
 */
export function fitsSchema(text: string, schema: Record<string, unknown>): boolean {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let value: unknown;
  try {
    value = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    return false;
  }
  return fits(value, schema);
}

function fits(value: unknown, schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return true;
  const s = schema as { type?: unknown; enum?: unknown; required?: unknown; properties?: unknown; items?: unknown };
  if (Array.isArray(s.enum) && !s.enum.some((e) => e === value)) return false;
  if (s.type !== undefined && !(Array.isArray(s.type) ? s.type : [s.type]).some((t) => isType(value, t))) return false;
  if (isType(value, 'object')) {
    const o = value as Record<string, unknown>;
    if (Array.isArray(s.required) && s.required.some((k) => typeof k === 'string' && !Object.prototype.hasOwnProperty.call(o, k))) return false;
    if (s.properties && typeof s.properties === 'object') {
      for (const [k, sub] of Object.entries(s.properties as Record<string, unknown>)) {
        if (Object.prototype.hasOwnProperty.call(o, k) && !fits(o[k], sub)) return false;
      }
    }
  }
  if (Array.isArray(value) && s.items) return value.every((v) => fits(v, s.items));
  return true;
}

function isType(value: unknown, type: unknown): boolean {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}
