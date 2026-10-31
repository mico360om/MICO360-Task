import type { FastifyRequest } from 'fastify';
import { HttpError } from '../../lib/http-errors';
import type { CompanyAccess } from './company-access';
import { COMPANY_WORDS } from './company-rules';

/**
 * The company a person picked in the top bar, sent on every call as `X-Company-Id: <companyId>`
 * (absent = "All my companies"). It only narrows lists, counts, exports, search and MICO AI; routes
 * that open one item ignore it. A pick the person can't use is refused (403), never widened, so
 * figures never mix scopes — the clients then clear the pick and read again.
 */
export const COMPANY_HEADER = 'x-company-id';

export class CompanyNotAvailableError extends HttpError {
  constructor() {
    super(COMPANY_WORDS.notAvailable, 'COMPANY_NOT_AVAILABLE', 403);
  }
}

const PICK_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

/** The header's value, trimmed (empty → null). Anything that isn't id-shaped is refused. */
export function rawPickOf(req: FastifyRequest): string | null {
  const header = req.headers[COMPANY_HEADER];
  const value = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
  if (value === '') return null;
  if (!PICK_SHAPE.test(value)) throw new CompanyNotAvailableError();
  return value;
}

export type PickOf = (req: FastifyRequest) => Promise<string | null>;

/** Reads and checks a signed-in request's pick once (memoised per request). */
export function createPickResolver(access: Pick<CompanyAccess, 'checkPick'>): PickOf {
  const seen = new WeakMap<FastifyRequest, Promise<string | null>>();
  return (req) => {
    const known = seen.get(req);
    if (known) return known;
    const user = req.user;
    const result = user
      ? (async () => access.checkPick({ id: user.id, roles: user.roles }, rawPickOf(req)))()
      : Promise.reject(new Error('The picked company is read only on signed-in routes.'));
    seen.set(req, result);
    return result;
  };
}

/** No company module wired (unit tests): every request is "All my companies". */
export const NO_PICK: PickOf = async () => null;
