import type { ApiClient } from '../lib/api-client';
import type { WebBuild } from '../lib/release';

/** The deployed server's version and when it was deployed (admins also get the technical details). */
export interface DeployedVersion {
  version: string;
  /** When the running server was built at deployment (ISO). */
  deployedAt: string;
  commit?: string | null;
  source?: 'build' | 'development';
  nodeVersion?: string;
  uptimeSeconds?: number;
  environment?: string;
}

export interface ReleaseSections {
  features: string[];
  improvements: string[];
  fixes: string[];
  /** Admins only. */
  security?: string[];
}

export interface ReleaseEntry {
  version: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  sections: ReleaseSections;
  /** For everyone but admins: whether the release had security fixes (listed to admins only). */
  securityUpdates?: boolean;
}

export function aboutApi(client: ApiClient) {
  return {
    version: () => client.get<{ data: DeployedVersion }>('/version').then((r) => r.data),
    releases: () => client.get<{ data: ReleaseEntry[] }>('/releases').then((r) => r.data),
  };
}

/**
 * The web app as deployed now (build-info.json beside it), read past every cache. Null when it
 * can't be read (a development server, or an older deployment without the file).
 */
export async function deployedWebBuild(): Promise<WebBuild | null> {
  try {
    const res = await fetch(`/build-info.json?t=${Date.now()}`, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<WebBuild>;
    return typeof body.version === 'string' && typeof body.builtAt === 'string' ? { version: body.version, builtAt: body.builtAt } : null;
  } catch {
    return null;
  }
}
