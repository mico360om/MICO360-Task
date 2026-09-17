import { isStrongPassword } from '../../lib/password-policy';
import { WeakPasswordError } from './errors';

export interface BootstrapAdminInput {
  email: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface BootstrapUserRepo {
  /** True if at least one user with the ADMIN role already exists. */
  anyAdminExists(): Promise<boolean>;
  createAdmin(data: {
    email: string;
    username: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
  }): Promise<{ id: string }>;
}

export interface BootstrapServiceDeps {
  users: BootstrapUserRepo;
  hashPassword: (plain: string) => Promise<string>;
}

export function createBootstrapService({ users, hashPassword }: BootstrapServiceDeps) {
  /**
   * Create the first administrator for a fresh production install. Idempotent:
   * does nothing if any admin already exists, so it can be run safely on deploy.
   */
  async function ensureFirstAdmin(input: BootstrapAdminInput): Promise<{ created: boolean; id?: string }> {
    if (await users.anyAdminExists()) return { created: false };
    if (!isStrongPassword(input.password)) throw new WeakPasswordError();
    const passwordHash = await hashPassword(input.password);
    const { id } = await users.createAdmin({
      email: input.email,
      username: input.username,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
    });
    return { created: true, id };
  }

  return { ensureFirstAdmin };
}

export type BootstrapService = ReturnType<typeof createBootstrapService>;
