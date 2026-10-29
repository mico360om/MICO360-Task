import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { aboutApi, deployedWebBuild, type ReleaseEntry } from '../api/about';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { LoadError } from '../components/ui/LoadError';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { RUNNING_BUILD, formatLastUpdated } from '../lib/release';

const SECTIONS: { key: keyof ReleaseEntry['sections']; title: string; adminOnly?: boolean }[] = [
  { key: 'features', title: 'New features' },
  { key: 'improvements', title: 'Improvements' },
  { key: 'security', title: 'Security', adminOnly: true },
  { key: 'fixes', title: 'Bug fixes' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-10-16' → '16 October 2026'. */
const releaseDay = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : date);

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * About MICO360 Tasks: the version running and when it was last updated, and every release with its
 * new features, improvements and bug fixes. Admins also see each release's security fixes and the
 * technical details of what is deployed (the server's and the web app's builds, and whether they match).
 */
export function AboutPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const timeZone = useCompanyTimeZone();
  const versionQ = useQuery({ queryKey: ['app-version'], queryFn: () => aboutApi(apiClient).version() });
  const releasesQ = useQuery({ queryKey: ['app-releases'], queryFn: () => aboutApi(apiClient).releases() });
  const webQ = useQuery({ queryKey: ['web-build'], queryFn: deployedWebBuild, enabled: isAdmin });
  const v = versionQ.data;
  const releases = releasesQ.data ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="About MICO360 Tasks" subtitle="The version you are using, and what each release changed." />

      <Card className="mb-6 p-5">
        {v ? (
          <>
            <h2 className="font-display text-xl font-bold text-ink">Version {v.version}</h2>
            <p className="mt-1 text-sm text-ink-2">Last updated {formatLastUpdated(v.deployedAt, timeZone)}</p>
          </>
        ) : versionQ.isError ? (
          <LoadError what="the version" onRetry={() => void versionQ.refetch()} />
        ) : (
          // Shaped like what arrives (for an administrator, the technical details too), so the
          // version history under it doesn't jump down.
          <div aria-busy="true">
            <div className="skeleton h-7 w-40" />
            <div className="skeleton mt-2 h-4 w-56 max-w-full" />
            {isAdmin ? (
              <div className="mt-4 border-t border-line pt-4">
                <div className="skeleton h-[12.5rem] w-full" />
              </div>
            ) : null}
          </div>
        )}

        {isAdmin && v ? (
          <section aria-labelledby="about-tech" className="mt-4 border-t border-line pt-4">
            <h3 id="about-tech" className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Technical details
            </h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ink-2">Server</dt>
              <dd className="text-ink">
                v{v.version}, built {formatLastUpdated(v.deployedAt, timeZone)}
                {v.source === 'development' ? ' (running from source: no build information)' : ''}
              </dd>
              <dt className="text-ink-2">Web app</dt>
              <dd className="text-ink">
                v{RUNNING_BUILD.version}, built {formatLastUpdated(RUNNING_BUILD.builtAt, timeZone)}
                {webQ.data && webQ.data.builtAt !== RUNNING_BUILD.builtAt ? ` — v${webQ.data.version} has since been deployed; reload to use it` : ''}
              </dd>
              <dt className="text-ink-2">Code revision</dt>
              <dd className="font-mono text-ink">{v.commit ?? 'not recorded'}</dd>
              {v.environment ? (
                <>
                  <dt className="text-ink-2">Environment</dt>
                  <dd className="text-ink">{v.environment}</dd>
                </>
              ) : null}
              {v.nodeVersion ? (
                <>
                  <dt className="text-ink-2">Node.js</dt>
                  <dd className="text-ink">{v.nodeVersion}</dd>
                </>
              ) : null}
              {typeof v.uptimeSeconds === 'number' ? (
                <>
                  <dt className="text-ink-2">Running for</dt>
                  <dd className="text-ink">{uptime(v.uptimeSeconds)}</dd>
                </>
              ) : null}
            </dl>
            <p className={`mt-3 text-sm font-medium ${v.version === RUNNING_BUILD.version ? 'text-success' : 'text-danger'}`}>
              {v.version === RUNNING_BUILD.version
                ? 'The server and web app are in step.'
                : `The server (v${v.version}) and web app (v${RUNNING_BUILD.version}) are different versions: deploy them together.`}
            </p>
          </section>
        ) : null}
      </Card>

      <h2 className="mb-3 font-display text-lg font-bold text-ink">Version history</h2>
      {releasesQ.isError ? (
        <LoadError what="the version history" onRetry={() => void releasesQ.refetch()} />
      ) : releasesQ.isLoading ? (
        // Release cards' worth of room (the history is long): the footer no longer jumps away.
        <div role="status" aria-label="Loading the version history" className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : releases.length === 0 ? (
        <p className="text-sm text-ink-2">No release notes yet.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {releases.map((r) => (
            <li key={r.version}>
              <article aria-labelledby={`release-${r.version}`} className="card p-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 id={`release-${r.version}`} className="font-display text-lg font-bold text-ink">
                    v{r.version}
                  </h3>
                  <span className="text-sm text-ink-2">{releaseDay(r.date)}</span>
                  {r.version === v?.version ? <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">Current</span> : null}
                </div>
                {SECTIONS.filter((s) => (s.adminOnly ? isAdmin : true)).map((s) => {
                  const items = r.sections[s.key] ?? [];
                  if (items.length === 0) return null;
                  return (
                    <section key={s.key} className="mt-3">
                      <h4 className="text-sm font-semibold text-ink">{s.title}</h4>
                      <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-ink-2">
                        {items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
                {!isAdmin && r.securityUpdates ? <p className="mt-3 text-sm text-ink-2">Includes security updates.</p> : null}
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
