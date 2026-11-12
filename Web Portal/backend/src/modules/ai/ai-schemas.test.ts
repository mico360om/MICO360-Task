import { describe, it, expect } from 'vitest';
import { AGENDA_SCHEMA, ANSWER_SCHEMAS, fitsSchema, MEETING_SCHEMA, MICO_AI_ACTION_SCHEMA, MINUTES_SCHEMA, PRIORITY_SCHEMA, TASK_SCHEMA } from './ai-schemas';

/** The keywords the guide (§5 "JSON output") asks a schema to keep to, plus descriptions. */
const SIMPLE = new Set(['type', 'properties', 'required', 'enum', 'items', 'description']);

function keywords(schema: unknown, out = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== 'object') return out;
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    out.add(k);
    if (k === 'properties') for (const p of Object.values(v as Record<string, unknown>)) keywords(p, out);
    else if (k === 'items') keywords(v, out);
  }
  return out;
}

describe('b1: the answers MICO360 AI is held to', () => {
  it('each schema is within the platform’s 16,000 characters, with a name OpenAI’s json_schema accepts', () => {
    for (const s of ANSWER_SCHEMAS) {
      expect(JSON.stringify(s.schema).length).toBeLessThan(16_000);
      expect(s.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
  });

  it('each keeps to the simple keywords the guide asks for', () => {
    for (const s of ANSWER_SCHEMAS) for (const k of keywords(s.schema)) expect(SIMPLE.has(k), `${s.name}: ${k}`).toBe(true);
  });

  it('every field each feature reads is in its schema, and "not said" stays possible where it was', () => {
    const props = (s: { schema: Record<string, unknown> }) => s.schema.properties as Record<string, { type: unknown; enum?: unknown[] }>;
    expect(Object.keys(props(TASK_SCHEMA))).toEqual(['title', 'description', 'dueDate', 'priority', 'repeat', 'project']);
    // A note that says nothing of a priority must still be able to leave it empty.
    expect(props(TASK_SCHEMA).priority!.type).toEqual(['string', 'null']);
    expect(props(TASK_SCHEMA).priority!.enum).toContain(null);
    expect(props(TASK_SCHEMA).repeat!.type).toEqual(['object', 'null']);
    expect(Object.keys(props(MEETING_SCHEMA))).toEqual(['title', 'description', 'date', 'startTime', 'minutes', 'repeat', 'project', 'location', 'onlineLink', 'people', 'guests', 'agenda']);
    expect(Object.keys(props(PRIORITY_SCHEMA))).toEqual(['priority', 'reason']);
    expect(Object.keys(props(AGENDA_SCHEMA))).toEqual(['items']);
    expect(Object.keys(props(MINUTES_SCHEMA))).toEqual(['summary', 'discussion', 'decisions', 'risks', 'nextSteps']);
    expect(props(MICO_AI_ACTION_SCHEMA).action!.enum).toEqual(['tool', 'clarify', 'answer', 'propose']);
    expect(MICO_AI_ACTION_SCHEMA.schema.required).toEqual(['action']);
  });
});

describe('safety net: does an answer fit its schema?', () => {
  const task = '{"title":"Call the bank","description":null,"dueDate":"2026-11-12","priority":"HIGH","repeat":null,"project":null}';

  it('an answer as the schema asks fits — prose or a code fence around it too (the features read past them)', () => {
    expect(fitsSchema(task, TASK_SCHEMA.schema)).toBe(true);
    expect(fitsSchema('Here it is:\n```json\n' + task + '\n```', TASK_SCHEMA.schema)).toBe(true);
    expect(fitsSchema('{"priority":"LOW","reason":"r"}', PRIORITY_SCHEMA.schema)).toBe(true);
    expect(fitsSchema('{"items":[{"title":"A","ownerId":null,"minutes":5}]}', AGENDA_SCHEMA.schema)).toBe(true);
    expect(fitsSchema('{"action":"answer","text":"Done."}', MICO_AI_ACTION_SCHEMA.schema)).toBe(true);
    expect(
      fitsSchema(
        '{"title":null,"description":null,"date":null,"startTime":null,"minutes":null,"repeat":{"freq":"WEEKLY","interval":1,"weekdays":[1]},"project":null,"location":null,"onlineLink":null,"people":[],"guests":[],"agenda":["A"]}',
        MEETING_SCHEMA.schema,
      ),
    ).toBe(true);
  });

  it('not JSON, or a list where an object was asked for, does not fit', () => {
    expect(fitsSchema('I could not decide.', PRIORITY_SCHEMA.schema)).toBe(false);
    expect(fitsSchema('{"priority":"LOW",', PRIORITY_SCHEMA.schema)).toBe(false);
    expect(fitsSchema('["LOW"]', PRIORITY_SCHEMA.schema)).toBe(false);
  });

  it('a missing required field, a value outside the list or of the wrong type does not fit', () => {
    expect(fitsSchema('{"priority":"LOW"}', PRIORITY_SCHEMA.schema)).toBe(false);
    expect(fitsSchema('{"priority":"SOMEDAY","reason":"r"}', PRIORITY_SCHEMA.schema)).toBe(false);
    expect(fitsSchema('{"items":[{"title":"A","ownerId":null,"minutes":"five"}]}', AGENDA_SCHEMA.schema)).toBe(false);
    expect(fitsSchema('{"items":[{"title":"A","ownerId":null,"minutes":2.5}]}', AGENDA_SCHEMA.schema)).toBe(false);
    expect(fitsSchema('{"action":"wave"}', MICO_AI_ACTION_SCHEMA.schema)).toBe(false);
    expect(fitsSchema(task.replace('"repeat":null', '"repeat":{"freq":"DAILY"}'), TASK_SCHEMA.schema)).toBe(false);
  });
});
