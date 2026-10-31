import { describe, it, expect, beforeEach } from 'vitest';
import { createCompanyService, mailFromName, type CompanySiteDefaults } from './company-service';
import { createMemoryCompanyRepository } from './memory-company-repository';

const SITE: CompanySiteDefaults = { timeZone: 'Asia/Muscat', weekStart: 1, workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' }, senderName: 'MICO360 Tasks' };
const admin = { id: 'admin', roles: ['ADMIN'] };

let mem: ReturnType<typeof createMemoryCompanyRepository>;
let svc: ReturnType<typeof createCompanyService>;
let alpha: string;
let beta: string;
let gamma: string;

beforeEach(async () => {
  mem = createMemoryCompanyRepository();
  svc = createCompanyService({ companies: mem.repo, site: async () => SITE });
  beta = (await svc.create({ name: 'Beta Co', code: 'BETA', weekStart: 6 }, admin)).id;
  alpha = (await svc.create({ name: 'Alpha Co', code: 'ALPHA' }, admin)).id;
  gamma = (await svc.create({ name: 'Gamma Co', code: 'GAMMA' }, admin)).id;
  await svc.archive(gamma, admin);
  for (const id of ['cat', 'gus', 'nob']) mem.addPerson({ id, firstName: id, lastName: 'X', username: id, email: `${id}@x.co` });
  await mem.repo.addMembers(beta, ['cat'], null);
  await mem.repo.addMembers(alpha, ['cat'], null);
  await mem.repo.addMembers(gamma, ['gus'], null);
  mem.setPrimary('cat', beta);
  mem.setPrimary('gus', gamma);
});

describe('My companies (GET /me/companies)', () => {
  it('a person’s active companies A–Z, with the site’s values filled in', async () => {
    const mine = await svc.mine({ id: 'cat', roles: ['EMPLOYEE'] });
    expect(mine).toEqual({
      companies: [
        { id: alpha, name: 'Alpha Co', code: 'ALPHA', logoUrl: null, timeZone: 'Asia/Muscat', weekStart: 1, workingHours: SITE.workingHours },
        { id: beta, name: 'Beta Co', code: 'BETA', logoUrl: null, timeZone: 'Asia/Muscat', weekStart: 6, workingHours: SITE.workingHours },
      ],
      primaryCompanyId: beta,
      allArchived: false,
      siteCompanyCount: 2,
    });
  });

  it('someone whose companies are all archived, or who has none, gets an empty list and allArchived', async () => {
    expect(await svc.mine({ id: 'gus', roles: ['EMPLOYEE'] })).toMatchObject({ companies: [], primaryCompanyId: gamma, allArchived: true });
    expect(await svc.mine({ id: 'nob', roles: ['EMPLOYEE'] })).toMatchObject({ companies: [], primaryCompanyId: null, allArchived: true });
  });

  it('administrators get every active company and are never “archived”', async () => {
    const mine = await svc.mine(admin);
    expect(mine.companies.map((c) => c.id)).toEqual([alpha, beta]);
    expect(mine).toMatchObject({ allArchived: false, primaryCompanyId: null, siteCompanyCount: 2 });
  });
});

describe('The sender name of the site', () => {
  it('is the display name in MAIL_FROM, else its address', () => {
    expect(mailFromName('MICO360 Tasks <no-reply@mico360.example>')).toBe('MICO360 Tasks');
    expect(mailFromName('"Prolens" <info@prolens.om>')).toBe('Prolens');
    expect(mailFromName('info@prolens.om')).toBe('info@prolens.om');
  });
});
