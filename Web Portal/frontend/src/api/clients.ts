import type { ApiClient } from '../lib/api-client';
import type { ApiUser, UserStatus, WelcomeOutcome } from './users';
import type { OnboardingStatus } from '../lib/onboarding';

/**
 * 1.23 Client accounts, for administrators: the Clients page and User Management's Role "Client" (one
 * editor, one API). Types follow the server (Web Portal/backend/src/modules/clients/client-accounts.ts
 * and client-grants.ts). Status, delete, password, unlock and the welcome email are User Management's
 * own routes (usersApi), which work for clients too.
 */

/** The two modules a client may be given on a project. */
export interface GrantModules {
  progress: boolean;
  meetings: boolean;
}

/** The four actions (each needs its module: comment and sign off → progress, respond → meetings, download → either). */
export interface GrantActions {
  comment: boolean;
  signOff: boolean;
  respond: boolean;
  download: boolean;
}

/** One project a client may open, and what they may see and do there. */
export interface ClientGrant {
  projectId: string;
  modules: GrantModules;
  actions: GrantActions;
}

/** A project on a client's account, as the server lists it. */
export interface ClientProjectAccess extends ClientGrant {
  code: string;
  name: string;
  /** Its main company's name. */
  company: string | null;
  /** Archived (its own status or all its companies): the portal doesn't show it. */
  archived: boolean;
}

/** A client account. */
export interface ClientAccount {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  organisation: string | null;
  phone: string | null;
  status: UserStatus;
  locked: boolean;
  lastLoginAt: string | null;
  welcomeSentAt: string | null;
  /** Onboarding (an older server sends none). */
  invitedAt?: string | null;
  activatedAt?: string | null;
  emailVerifiedAt?: string | null;
  inviteExpiresAt?: string | null;
  onboarding?: OnboardingStatus;
  createdAt: string;
  roles: string[];
  projects: ClientProjectAccess[];
}

/** A project an administrator may give a client: every live, non-archived project, A–Z. */
export interface ClientProjectOption {
  id: string;
  code: string;
  name: string;
  company: string | null;
}

export interface NewClientInput {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  organisation?: string | null;
  phone?: string | null;
  /** Email them their username and a one-time "Set your password" link (7 days). */
  sendWelcome?: boolean;
  /** Required unless `sendWelcome`. */
  password?: string;
  projects?: ClientGrant[];
}

export interface ClientPatch {
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  organisation?: string | null;
  phone?: string | null;
  /** Exactly these projects (absent: unchanged). */
  projects?: ClientGrant[];
}

/** A new client account, and whether its welcome email went (null: none was asked for). */
export interface CreatedClient {
  client: ClientAccount;
  welcome: WelcomeOutcome | null;
}

/** GET /clients: every client account. */
export const CLIENTS_KEY = ['clients'] as const;
export const clientKey = (id: string) => ['clients', id] as const;
export const CLIENT_PROJECT_OPTIONS_KEY = ['clients', 'project-options'] as const;

/** The Client role, as the server names it. */
export const CLIENT_ROLE = 'CLIENT';
/** A client account has the Client role (and only that one). */
export const isClientRoles = (roles: readonly string[] | null | undefined): boolean => !!roles && roles.includes(CLIENT_ROLE);

/** A client account as User Management's lists and dialogs take a person. */
export function clientAsUser(c: ClientAccount): ApiUser {
  return {
    id: c.id,
    email: c.email,
    username: c.username,
    firstName: c.firstName,
    lastName: c.lastName,
    avatarUrl: null,
    status: c.status,
    roles: c.roles.length ? c.roles : [CLIENT_ROLE],
    locked: c.locked,
    lastLoginAt: c.lastLoginAt,
    welcomeSentAt: c.welcomeSentAt,
    invitedAt: c.invitedAt ?? null,
    activatedAt: c.activatedAt ?? null,
    emailVerifiedAt: c.emailVerifiedAt ?? null,
    inviteExpiresAt: c.inviteExpiresAt ?? null,
    ...(c.onboarding ? { onboarding: c.onboarding } : {}),
    companies: [],
    primaryCompanyId: null,
  };
}

export function clientsApi(client: ApiClient) {
  return {
    list: () => client.get<{ data: ClientAccount[] }>('/clients').then((r) => r.data),
    get: (id: string) => client.get<{ data: ClientAccount }>(`/clients/${encodeURIComponent(id)}`).then((r) => r.data),
    projectOptions: () => client.get<{ data: ClientProjectOption[] }>('/clients/project-options').then((r) => r.data),
    create: (input: NewClientInput): Promise<CreatedClient> =>
      client
        .post<{ data: ClientAccount; meta?: { welcome?: WelcomeOutcome } }>('/clients', input)
        .then((r) => ({ client: r.data, welcome: r.meta?.welcome ?? null })),
    update: (id: string, patch: ClientPatch) => client.put<{ data: ClientAccount }>(`/clients/${encodeURIComponent(id)}`, patch).then((r) => r.data),
  };
}
