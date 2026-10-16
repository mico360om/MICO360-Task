import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { ReleaseFile } from './build-info';

export interface AboutRouteDeps {
  release: ReleaseFile & { source: 'build' | 'development' };
  guard: AuthGuard;
}

const isAdmin = (req: FastifyRequest) => (req.user?.roles ?? []).includes('ADMIN');

/**
 * The deployed version (the footer on every page) and the version history (the About page).
 * Signed-in users only. Security fixes are listed to admins; everyone else learns only that a
 * release had some. Never cached: after a deployment the next request must tell the new version.
 */
export async function registerAboutRoutes(app: FastifyInstance, deps: AboutRouteDeps): Promise<void> {
  const { release, guard } = deps;
  const startedAt = Date.now();

  app.get('/version', { preHandler: guard.authenticate }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const base = { version: release.build.version, deployedAt: release.build.builtAt };
    if (!isAdmin(req)) return { data: base };
    return {
      data: {
        ...base,
        commit: release.build.commit,
        source: release.source,
        nodeVersion: process.version,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        environment: process.env.NODE_ENV ?? 'development',
      },
    };
  });

  app.get('/releases', { preHandler: guard.authenticate }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (isAdmin(req)) return { data: release.releases };
    return {
      data: release.releases.map((r) => {
        const { security, ...rest } = r.sections;
        return { version: r.version, date: r.date, sections: rest, securityUpdates: security.length > 0 };
      }),
    };
  });
}
