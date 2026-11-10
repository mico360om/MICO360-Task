import { z } from 'zod';

/**
 * 1.23.12 (zod 4 upgrade, security fix GHSA-mrhx-c7xc-m3w5): the words of a failed check stay those
 * the API has always given. They reach people — the New account dialogs (website and Android app)
 * show a field's first problem, and a refused inspection form shows its own first words only when
 * they aren't one of these general ones — and the API's 400 `details` carry them to the website, the
 * app and the extension. zod 4 rewords every default message ("Required" became "Invalid input:
 * expected string, received undefined"), so this puts zod 3's English words back for the problems a
 * schema has no words of its own for. A schema's own words (`.min(1, 'Enter a title.')`) still win.
 *
 * Loaded once by the server (app.ts, config/env.ts) and by the test setup; `z.config` is global.
 */

type RawIssue = Parameters<z.core.$ZodErrorMap>[0];

/** zod 3's name for what was received (its getParsedType). */
function receivedOf(data: unknown): string {
  switch (typeof data) {
    case 'undefined':
      return 'undefined';
    case 'number':
      return Number.isNaN(data) ? 'nan' : 'number';
    case 'object':
      if (Array.isArray(data)) return 'array';
      if (data === null) return 'null';
      if (typeof (data as { then?: unknown }).then === 'function' && typeof (data as { catch?: unknown }).catch === 'function') return 'promise';
      if (data instanceof Map) return 'map';
      if (data instanceof Set) return 'set';
      if (data instanceof Date) return 'date';
      return 'object';
    default:
      return typeof data; // string, boolean, function, bigint, symbol
  }
}

/** zod 3's list of choices: 'A' | 'B' (texts quoted, numbers not). */
const joinValues = (values: readonly unknown[], separator = ' | ') => values.map((v) => (typeof v === 'string' ? `'${v}'` : String(v))).join(separator);

/** zod 4's name for an expected type, as zod 3 said it. */
const EXPECTED: Record<string, string> = { record: 'object', tuple: 'array' };

/** The kind of schema that raised a problem (enum, literal, …). */
const kindOf = (issue: RawIssue): string | undefined => (issue.inst as { _zod?: { def?: { type?: string } } } | undefined)?._zod?.def?.type;

export const zodMessages: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined) return 'Required';
      if (issue.expected === 'date' && issue.input instanceof Date) return 'Invalid date';
      if (issue.expected === 'int') return 'Expected integer, received float';
      if (issue.expected === 'number' && typeof issue.input === 'number' && !Number.isNaN(issue.input) && !Number.isFinite(issue.input)) return 'Number must be finite';
      return `Expected ${EXPECTED[issue.expected] ?? issue.expected}, received ${receivedOf(issue.input)}`;
    }
    case 'invalid_value': {
      if (kindOf(issue) === 'enum') {
        if (issue.input === undefined) return 'Required';
        return typeof issue.input === 'string'
          ? `Invalid enum value. Expected ${joinValues(issue.values)}, received '${issue.input}'`
          : `Expected ${joinValues(issue.values)}, received ${receivedOf(issue.input)}`;
      }
      if (issue.values.length === 1) return `Invalid literal value, expected ${JSON.stringify(issue.values[0], (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}`;
      return 'Invalid input';
    }
    case 'unrecognized_keys':
      return `Unrecognized key(s) in object: ${joinValues(issue.keys, ', ')}`;
    case 'invalid_union':
      if (issue.discriminator !== undefined && Array.isArray(issue.options) && issue.options.length > 0) return `Invalid discriminator value. Expected ${joinValues(issue.options)}`;
      return 'Invalid input';
    case 'invalid_format': {
      switch (issue.format) {
        case 'regex':
          return 'Invalid';
        case 'starts_with':
          return `Invalid input: must start with "${String(issue.prefix)}"`;
        case 'ends_with':
          return `Invalid input: must end with "${String(issue.suffix)}"`;
        case 'includes':
          return `Invalid input: must include "${String(issue.includes)}"`;
        case 'ipv4':
        case 'ipv6':
          return 'Invalid ip';
        case 'guid':
          return 'Invalid uuid';
        default:
          return `Invalid ${issue.format}`;
      }
    }
    case 'too_small': {
      const { minimum: min, exact, inclusive } = issue;
      switch (issue.origin) {
        case 'array':
          return `Array must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'more than'} ${min} element(s)`;
        case 'string':
          return `String must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'over'} ${min} character(s)`;
        case 'number':
        case 'int':
        case 'bigint':
          return `Number must be ${exact ? 'exactly equal to ' : inclusive ? 'greater than or equal to ' : 'greater than '}${min}`;
        case 'date':
          return `Date must be ${exact ? 'exactly equal to ' : inclusive ? 'greater than or equal to ' : 'greater than '}${new Date(Number(min))}`;
        default:
          return 'Invalid input';
      }
    }
    case 'too_big': {
      const { maximum: max, exact, inclusive } = issue;
      switch (issue.origin) {
        case 'array':
          return `Array must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'less than'} ${max} element(s)`;
        case 'string':
          return `String must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'under'} ${max} character(s)`;
        case 'number':
        case 'int':
          return `Number must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${max}`;
        case 'bigint':
          return `BigInt must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${max}`;
        case 'date':
          return `Date must be ${exact ? 'exactly' : inclusive ? 'smaller than or equal to' : 'smaller than'} ${new Date(Number(max))}`;
        default:
          return 'Invalid input';
      }
    }
    case 'not_multiple_of':
      return `Number must be a multiple of ${issue.divisor}`;
    case 'invalid_key':
      // zod 3 reported a map key's own problem; zod 4 wraps it (its first problem's words).
      return issue.issues[0]?.message ?? 'Invalid input';
    case 'custom':
      return 'Invalid input';
    default:
      return undefined; // zod's own words
  }
};

z.config({ customError: zodMessages });
