import type { CompanyStatus } from './company-rules';
import type { WorkingHours } from '../settings/settings-service';
import type { UserStatus } from '../users/user-repository';

/** The day a company's week starts on: 0 Sunday, 1 Monday, 6 Saturday. */
export type WeekStart = 0 | 1 | 6;

/**
 * A company as stored. `weekStart`, `workingHours`, `senderName` and `logoUrl` are null until an
 * administrator sets them: null means "the site's value" (System Settings, MAIL_FROM, the built-in
 * logo). Every company uses the site's time zone (owner, 31 Oct: all companies are in Oman for now).
 */
export interface CompanyRecord {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  weekStart: WeekStart | null;
  workingHours: WorkingHours | null;
  senderName: string | null;
  status: CompanyStatus;
  archivedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCompanyData {
  name: string;
  code: string;
  weekStart?: WeekStart | null;
  workingHours?: WorkingHours | null;
  senderName?: string | null;
  createdById: string | null;
}

export type CompanyPatch = Partial<Pick<CompanyRecord, 'name' | 'code' | 'logoUrl' | 'weekStart' | 'workingHours' | 'senderName' | 'status' | 'archivedAt'>>;

/** One of a company's people (the Companies page's People panel). */
export interface CompanyPerson {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  status: UserStatus;
  /** It is their primary company (their emails' branding). */
  isPrimary: boolean;
}

/** One of a company's projects (the Companies page's Projects panel). */
export interface CompanyProject {
  id: string;
  code: string;
  name: string;
  /** It is the project's main company (the project's branding). */
  isMain: boolean;
  /** Its own status is ARCHIVED, or every one of its companies is archived. */
  archived: boolean;
}

export interface CompanyRepository {
  /** Every company, A–Z by name. */
  list(): Promise<CompanyRecord[]>;
  findById(id: string): Promise<CompanyRecord | null>;
  /** The company with this name, ignoring case. */
  findByName(name: string): Promise<CompanyRecord | null>;
  findByCode(code: string): Promise<CompanyRecord | null>;
  create(data: NewCompanyData): Promise<CompanyRecord>;
  update(id: string, patch: CompanyPatch): Promise<CompanyRecord>;
  /** How many companies are active on the site. */
  countActive(): Promise<number>;
  /** People (not deleted) and projects (not deleted) per company. */
  counts(companyIds: string[]): Promise<Map<string, { people: number; projects: number }>>;
  /** The company's people (deleted ones too: their access is what changes). */
  memberIds(companyId: string): Promise<string[]>;
  /** The company's projects (deleted ones too). */
  projectIds(companyId: string): Promise<string[]>;
  /** The company's people (not deleted), A–Z by name. */
  people(companyId: string): Promise<CompanyPerson[]>;
  /** The company's projects (not deleted), A–Z by name. */
  projects(companyId: string): Promise<CompanyProject[]>;
  /** The person's ACTIVE companies, A–Z by name. */
  activeOf(userId: string): Promise<CompanyRecord[]>;
  /** The person's primary company (null: none). */
  primaryOf(userId: string): Promise<string | null>;
  /** Puts people in a company (people already in it are left alone); how many joined. */
  addMembers(companyId: string, userIds: string[], addedById: string | null): Promise<number>;
  /** Takes a person out of a company; whether they were in it. */
  removeMember(companyId: string, userId: string): Promise<boolean>;
}
