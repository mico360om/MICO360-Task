/** Review Focus 5: on a shared phone, who may see Management is asked per person, and is "no" until the server says yes. */
import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';
import { managementAccessKey, managementAccessOf } from './management-access';

it('access is kept per person and is "no" until the server says yes', () => {
  expect(managementAccessKey('u1')).toEqual(['management-access', 'u1']);
  expect(managementAccessKey('u1')).not.toEqual(managementAccessKey('u2'));
  expect(managementAccessKey(null)).toEqual(['management-access', '']);
  expect(managementAccessOf(false, undefined)).toBe(false);
  expect(managementAccessOf(false, { allowed: true })).toBe(true);
  expect(managementAccessOf(false, { allowed: 'yes' })).toBe(false);
  expect(managementAccessOf(false, null)).toBe(false);
  expect(managementAccessOf(true, undefined)).toBe(true);
});

it('the access query is never put in the offline copy', () => expect(src('core/management-queries.ts')).not.toMatch(/readCache|offline|persist|reads\.read/));

it('the access query is the website’s: per person, asked only for someone who isn’t an administrator, kept a minute, tried twice more', () => {
  const q = src('core/management-queries.ts');
  expect(q).toMatch(/queryKey: managementAccessKey\(userId\)/);
  expect(q).toMatch(/enabled: !!userId && !isAdmin/);
  expect(q).toMatch(/staleTime: 60_000/);
  expect(q).toMatch(/retry: 2/);
  expect(q).toMatch(/resources\.management\.access\(\)/);
  // Stage 3 Task 6: the resource is Management's whole API now; access keeps its request and type.
  expect(src('lib/resources.ts')).toMatch(/management: managementApi\(client\),/);
  expect(src('lib/management-api.ts')).toMatch(/access: \(o\?: CallOpts\) => client\.get<Envelope<\{ allowed: boolean; scope: ManagementScope \| null \}>>\('\/management\/access', o\)/);
});
