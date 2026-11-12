import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../app';
import { createAuthService } from '../modules/auth/auth-service';
import { createTokenService } from '../modules/auth/token-service';
import { validationErrorBody } from './validation-errors';

/**
 * The 400 VALIDATION answer is a contract: the website (CreateUserModal), the Android app
 * (users-admin, meeting-form) and the Chrome extension read `details.fieldErrors` / `formErrors`,
 * and the new-account dialogs show a field's first words to the person. These pins hold the shape
 * AND the words exactly as the API gave them on 1.23.11 (zod 3), so the zod 4 upgrade (security
 * fix GHSA-mrhx-c7xc-m3w5) changes nothing anyone sees.
 */

const failure = (schema: z.ZodType, input: unknown) => {
  const r = schema.safeParse(input);
  if (r.success) throw new Error('expected the check to fail');
  return validationErrorBody(r.error);
};
const details = (formErrors: string[], fieldErrors: Record<string, string[]>) => ({ error: { code: 'VALIDATION', message: 'Invalid input.', details: { formErrors, fieldErrors } } });

describe('400 VALIDATION body — shape and words (pinned from 1.23.11)', () => {
  const cases: Array<[string, () => z.ZodType, unknown, ReturnType<typeof details>]> = [
    ['a missing field', () => z.object({ title: z.string() }), {}, details([], { title: ['Required'] })],
    ['a missing nullable field', () => z.object({ title: z.string().nullable() }), {}, details([], { title: ['Required'] })],
    ['a wrong type', () => z.object({ title: z.string() }), { title: 5 }, details([], { title: ['Expected string, received number'] })],
    ['null for a string', () => z.object({ title: z.string() }), { title: null }, details([], { title: ['Expected string, received null'] })],
    ['an array for an object (the whole body)', () => z.object({ title: z.string() }), [], details(['Expected object, received array'], {})],
    ['a boolean as text', () => z.object({ done: z.boolean() }), { done: 'true' }, details([], { done: ['Expected boolean, received string'] })],
    ['too short', () => z.object({ name: z.string().min(3) }), { name: 'ab' }, details([], { name: ['String must contain at least 3 character(s)'] })],
    ['empty when one is needed', () => z.object({ name: z.string().trim().min(1) }), { name: '  ' }, details([], { name: ['String must contain at least 1 character(s)'] })],
    ['too long', () => z.object({ name: z.string().max(3) }), { name: 'abcd' }, details([], { name: ['String must contain at most 3 character(s)'] })],
    ['too few items', () => z.object({ ids: z.array(z.string()).min(1) }), { ids: [] }, details([], { ids: ['Array must contain at least 1 element(s)'] })],
    ['too many items', () => z.object({ ids: z.array(z.string()).max(1) }), { ids: ['a', 'b'] }, details([], { ids: ['Array must contain at most 1 element(s)'] })],
    ['a number too small', () => z.object({ n: z.number().min(1) }), { n: 0 }, details([], { n: ['Number must be greater than or equal to 1'] })],
    ['a number too big', () => z.object({ n: z.number().max(5) }), { n: 6 }, details([], { n: ['Number must be less than or equal to 5'] })],
    ['not positive', () => z.object({ n: z.number().positive() }), { n: 0 }, details([], { n: ['Number must be greater than 0'] })],
    ['not a whole number', () => z.object({ n: z.number().int() }), { n: 1.5 }, details([], { n: ['Expected integer, received float'] })],
    ['not a number (query text)', () => z.object({ limit: z.coerce.number().int() }), { limit: 'abc' }, details([], { limit: ['Expected number, received nan'] })],
    ['not a date', () => z.object({ at: z.coerce.date() }), { at: 'soon' }, details([], { at: ['Invalid date'] })],
    ['a choice not on the list', () => z.object({ kind: z.enum(['A', 'B']) }), { kind: 'C' }, details([], { kind: ["Invalid enum value. Expected 'A' | 'B', received 'C'"] })],
    ['a choice of the wrong type', () => z.object({ kind: z.enum(['A', 'B']) }), { kind: 1 }, details([], { kind: ["Expected 'A' | 'B', received number"] })],
    ['a missing choice', () => z.object({ kind: z.enum(['A', 'B']) }), {}, details([], { kind: ['Required'] })],
    ['a missing choice in a list item', () => z.object({ signatures: z.array(z.object({ role: z.enum(['INSPECTOR', 'CLIENT']) })) }), { signatures: [{}] }, details([], { signatures: ['Required'] })],
    ['a fixed value', () => z.object({ kind: z.literal('A') }), { kind: 'B' }, details([], { kind: ['Invalid literal value, expected "A"'] })],
    ['one of several fixed numbers', () => z.object({ week: z.union([z.literal(1), z.literal(2)]) }), { week: 3 }, details([], { week: ['Invalid input'] })],
    ['a pattern', () => z.object({ code: z.string().regex(/^[A-Z]+$/) }), { code: 'ab' }, details([], { code: ['Invalid'] })],
    ['a pattern with its own words', () => z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD') }), { day: 'x' }, details([], { day: ['Use YYYY-MM-DD'] })],
    ['an email address', () => z.object({ email: z.string().trim().email().max(191) }), { email: 'nope' }, details([], { email: ['Invalid email'] })],
    ['a web address', () => z.object({ url: z.string().url() }), { url: 'nope' }, details([], { url: ['Invalid url'] })],
    ['a timestamp', () => z.object({ at: z.iso.datetime({ offset: true }) }), { at: 'today' }, details([], { at: ['Invalid datetime'] })],
    ['fields it doesn’t take (strict)', () => z.object({ a: z.string() }).strict(), { a: 'x', b: 1, c: 2 }, details(["Unrecognized key(s) in object: 'b', 'c'"], {})],
    ['a rule with its own words and field', () => z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b, { message: 'a before b', path: ['b'] }), { a: 2, b: 1 }, details([], { b: ['a before b'] })],
    ['a rule without words', () => z.object({ a: z.string() }).refine(() => false), { a: 'x' }, details(['Invalid input'], {})],
    ['a kind that isn’t one', () => z.object({ items: z.array(z.discriminatedUnion('kind', [z.object({ kind: z.literal('CHECK') }), z.object({ kind: z.literal('READING'), unit: z.string() })])) }), { items: [{ kind: 'NOTE' }] }, details([], { items: ["Invalid discriminator value. Expected 'CHECK' | 'READING'"] })],
    ['deep problems count under the top field', () => z.object({ a: z.object({ b: z.string().min(2) }) }), { a: { b: 'x' } }, details([], { a: ['String must contain at least 2 character(s)'] })],
    ['a list item', () => z.object({ ids: z.array(z.string()) }), { ids: ['a', 1] }, details([], { ids: ['Expected string, received number'] })],
    ['a value in a map', () => z.object({ m: z.record(z.string(), z.number()) }), { m: { x: 'y' } }, details([], { m: ['Expected number, received string'] })],
    ['several problems, in order', () => z.object({ a: z.string(), b: z.number().max(1), c: z.enum(['X']) }), { b: 2, c: 'Y' }, details([], { a: ['Required'], b: ['Number must be less than or equal to 1'], c: ["Invalid enum value. Expected 'X', received 'Y'"] })],
  ];

  for (const [name, schema, input, expected] of cases) {
    it(name, () => {
      expect(failure(schema(), input)).toEqual(expected);
    });
  }
});

// 1.23.12: the security fix itself (GHSA-mrhx-c7xc-m3w5, zod >= 4.6.6). A list longer than its limit is refused on
// its length alone, before any of its items are checked — a huge list can no longer make the server check every
// item first. (zod 3 also listed each bad item; the words of the length problem are the same.)
describe('an oversized list is refused before its items are checked', () => {
  it('says only that it is too long', () => {
    const schema = z.object({ ids: z.array(z.string().min(1)).max(2) });
    expect(failure(schema, { ids: ['', 'a', ''] })).toEqual(details([], { ids: ['Array must contain at most 2 element(s)'] }));
  });
  it('does not look at the items of a list over its limit', () => {
    let looked = 0;
    const schema = z.object({ ids: z.array(z.string().refine(() => (looked++, true))).max(100) });
    expect(schema.safeParse({ ids: Array.from({ length: 100_000 }, () => 'x') }).success).toBe(false);
    expect(looked).toBe(0);
    expect(schema.safeParse({ ids: ['x', 'y'] }).success).toBe(true);
    expect(looked).toBe(2);
  });
});

// 1.23.12 (review I1, accepted): zod 4 counts a text's length in characters (Unicode code points), as MySQL's
// VARCHAR does; zod 3 counted UTF-16 units, so an emoji counted twice. The website's own maxLength stops typing at
// the same place as before; only text with emoji or other rare characters is affected, and only in its favour for
// a maximum (a 1-emoji AI search question, under a minimum of 2, is now refused).
describe('text length counts characters', () => {
  it('a maximum counts each emoji once', () => {
    expect(z.string().max(3).safeParse('😀😀😀').success).toBe(true);
    expect(z.string().max(3).safeParse('😀😀😀😀').success).toBe(false);
  });
  it('a minimum counts each emoji once', () => {
    expect(z.string().min(2).safeParse('😀').success).toBe(false);
    expect(z.string().min(2).safeParse('😀😀').success).toBe(true);
  });
});

describe('400 VALIDATION through the server (the real error handler)', () => {
  const tokenService = createTokenService({ accessSecret: 've-a', refreshSecret: 've-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });
  const authService = createAuthService({ users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} }, maxAttempts: 5 });
  const signIn = async (payload: unknown) => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: payload as never });
    await app.close();
    return res;
  };

  it('names every missing field', async () => {
    const res = await signIn({});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(details([], { identifier: ['Required'], password: ['Required'] }));
  });

  it('says what is wrong with each field', async () => {
    const res = await signIn({ identifier: 'x'.repeat(192), password: '', acceptChallenge: 'yes' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(details([], { identifier: ['String must contain at most 191 character(s)'], password: ['String must contain at least 1 character(s)'], acceptChallenge: ['Expected boolean, received string'] }));
  });

  it('a body that isn’t an object is a problem with the whole form', async () => {
    const res = await signIn(['ada', 'pw']);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(details(['Expected object, received array'], {}));
  });
});
