import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { ClientRole } from '../../api/clients';
import { projectsApi, type ProjectClient } from '../../api/projects';
import { ROLE_TONE, ROLE_WORDS } from '../clients/client-access';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { TOUCH_TALL } from '../../lib/touch';

/** An account's status in words, when it isn't active ("Inactive", "Suspended"). */
const statusWord = (status: string) => status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');

/** 1.23.7: the server sends each client's role on the project (an older one doesn't: no badge). */
type ListedClient = ProjectClient & { role?: ClientRole };
const roleOf = (c: ListedClient): ClientRole | null => (c.role && Object.hasOwn(ROLE_WORDS, c.role) ? c.role : null);

/**
 * 1.23 "Clients with access" (the project's Team tab): the client accounts that may open this project
 * in the Client portal, and what each may do — 1.23.7: their role (Viewer, Contributor, Approver or
 * Custom) as a badge by the name, then each permission. Read-only here — administrators change it on
 * the Clients page (the link); everyone else is told to ask one. Nothing for the team when there are
 * none (an administrator sees one quiet line), nor from an older server.
 */
export function ClientsWithAccess({ projectId }: { projectId: string }) {
  const headingId = useId();
  const q = useQuery({ queryKey: ['project-clients', projectId], queryFn: () => projectsApi(apiClient).clients(projectId), enabled: !!projectId, staleTime: 30_000 });
  const data = q.data;
  const clients: ListedClient[] = data && Array.isArray(data.clients) ? data.clients : [];
  const canChange = data?.canChange === true;
  if (!data || !Array.isArray(data.clients) || (clients.length === 0 && !canChange)) return null;

  const manage = (
    <Link to="/admin/clients" className={`inline-flex items-center text-sm font-semibold text-brand hover:underline ${TOUCH_TALL}`}>
      Manage on the Clients page
    </Link>
  );

  return (
    <section aria-labelledby={headingId} className="card mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="eyebrow">
          Clients with access
        </h2>
        {canChange && clients.length > 0 ? manage : null}
      </div>
      {clients.length === 0 ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
          <span>No clients can open this project in the Client portal.</span>
          {manage}
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-2">They sign in to the Client portal and see only what is marked “Show to client”.</p>
          <ul className="mt-2 divide-y divide-line">
            {clients.map((c) => {
              const role = roleOf(c);
              // The server's words start with the role word: shown once, as the badge.
              const words = role && c.access[0] === ROLE_WORDS[role] ? c.access.slice(1) : c.access;
              return (
                <li key={c.id} className="flex items-start gap-3 py-2.5">
                  <span className="flex-none pt-0.5">
                    <Avatar name={c.name} size="md" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <bdi className="text-sm font-semibold text-ink">{c.name}</bdi>
                      {role ? (
                        <Badge tone={ROLE_TONE[role]}>
                          <span className="sr-only">Role: </span>
                          {ROLE_WORDS[role]}
                        </Badge>
                      ) : null}
                      {c.status !== 'ACTIVE' ? <Badge tone="warning">{statusWord(c.status)}</Badge> : null}
                    </p>
                    {c.organisation ? (
                      <p dir="auto" className="text-xs text-ink-2">
                        {c.organisation}
                      </p>
                    ) : null}
                    <ul aria-label={`What ${c.name} may do`} className="mt-1.5 flex flex-wrap gap-1">
                      {words.map((a) => (
                        <li key={a} className="rounded-full bg-ground px-2 py-0.5 text-[11px] font-medium text-ink-2">
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
          {canChange ? null : <p className="mt-2 text-xs text-ink-3">Ask an administrator to change this.</p>}
        </>
      )}
    </section>
  );
}
