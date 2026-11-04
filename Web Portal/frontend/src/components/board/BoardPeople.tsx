import { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { membersApi } from '../../api/members';
import { usersApi } from '../../api/users';
import type { ApiProject } from '../../api/projects';
import { useAuthStore } from '../../stores/auth-store';
import { BOARD_ROLE_LABEL, boardPeople, facesOf } from '../../lib/board-people';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { Avatar } from '../ui/Avatar';
import { AnchoredPopover } from '../ui/AnchoredPopover';

/** A phone (below the sm width): three faces. */
const PHONE = '(max-width: 39.9375em)';

/**
 * Who can open this board (1.22): a row of faces — the owner, the named manager and the team, up to
 * eight (three on a phone), then "+N" — that opens the full list with each person's role. Whoever
 * runs the project, and administrators, can go from there to the project's Team tab.
 */
export function BoardPeople({ project }: { project: ApiProject }) {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const phone = useMediaQuery(PHONE);
  const membersQ = useQuery({ queryKey: ['members', project.id], queryFn: () => membersApi(apiClient).list(project.id) });
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const people = useMemo(
    () => boardPeople(project, Array.isArray(membersQ.data) ? membersQ.data : [], Array.isArray(directoryQ.data) ? directoryQ.data : []),
    [project, membersQ.data, directoryQ.data],
  );
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const canManage = isAdmin || project.canManage === true;

  if (!membersQ.data) return membersQ.isLoading ? <span className="skeleton block h-9 w-24 rounded-full" aria-hidden="true" /> : null;
  const { shown, more } = facesOf(people, phone ? 3 : 8);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`People on this project: ${people.length}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Who can open this board"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 flex-none items-center rounded-full border border-line bg-surface py-1 pe-2 ps-1.5 transition-colors hover:border-brand/40 [@media(pointer:coarse)]:h-11"
      >
        <span className="flex items-center -space-x-1 rtl:space-x-reverse" aria-hidden="true">
          {shown.map((p) => (
            <span key={p.id} data-face className="inline-flex rounded-full ring-2 ring-surface">
              <Avatar name={p.name} src={p.avatarUrl} size="sm" />
            </span>
          ))}
        </span>
        {more > 0 ? <span className="ms-1.5 text-xs font-semibold tabular-nums text-ink-2" aria-hidden="true">+{more}</span> : null}
        {people.length === 0 ? <span className="px-1 text-xs font-medium text-ink-2" aria-hidden="true">No one yet</span> : null}
      </button>
      {open ? (
        <AnchoredPopover anchor={trigger} labelledBy={titleId} onClose={() => setOpen(false)} className="w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-line bg-surface p-3 shadow-lift">
          <h3 id={titleId} tabIndex={-1} data-popover-heading className="text-sm font-bold text-ink outline-none">
            People on this project
          </h3>
          <p className="mb-2 text-xs text-ink-2">{people.length === 1 ? '1 person can open this board.' : `${people.length} people can open this board.`}</p>
          {/* A long team scrolls here: Tab reaches it, so the arrow keys scroll it too. */}
          <ul tabIndex={0} aria-label="People" className="-mx-1 flex max-h-[min(22rem,50vh)] flex-col overflow-y-auto overscroll-contain rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
            {people.map((p) => (
              <li key={p.id} className="flex min-h-[2.5rem] items-center gap-2.5 rounded-lg px-1 py-1">
                <Avatar name={p.name} src={p.avatarUrl} size="md" />
                <bdi className="min-w-0 flex-1 truncate text-sm text-ink" title={p.name}>{p.name}</bdi>
                <span
                  className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${p.role === 'MEMBER' ? 'bg-ground text-ink-2' : 'bg-brand/10 text-brand'}`}
                >
                  {BOARD_ROLE_LABEL[p.role]}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-line pt-2 text-xs text-ink-2">Administrators can open every board.</p>
          {canManage ? (
            <Link
              to={`/projects/${encodeURIComponent(project.id)}?tab=team`}
              data-popover-action
              className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm font-semibold text-brand transition-colors hover:border-brand [@media(pointer:coarse)]:!min-h-11"
            >
              Manage team
            </Link>
          ) : null}
        </AnchoredPopover>
      ) : null}
    </>
  );
}
