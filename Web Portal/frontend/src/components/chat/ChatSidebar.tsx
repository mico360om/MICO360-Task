import { useRef, useState, type ReactNode } from 'react';
import type { ApiMessage, ConversationPrefs } from '../../api/chat';
import { SearchableSelect, type SelectOption } from '../ui/SearchableSelect';
import { previewOf, type InboxRow } from '../../lib/chat-model';
import { Menu, type MenuItem } from './Popover';
import { SearchResults } from './SearchResults';
import { ChannelTile, PresenceAvatar } from './parts';
import type { ProjectLook } from '../ProjectAvatar';
import { ArchiveIcon, BackIcon, BellIcon, BellOffIcon, ChevronIcon, CloseIcon, MoreIcon, PlusIcon, SearchIcon, StarIcon, VolumeIcon, VolumeOffIcon } from './icons';

export type SectionKey = 'favorites' | 'channels' | 'directs' | 'archived';

export interface ChatSidebarProps {
  hidden: boolean;
  sections: { favorites: InboxRow[]; channels: InboxRow[]; directs: InboxRow[]; archived: InboxRow[]; archivedUnread: number };
  activeKey: string | null;
  openingKey: string | null;
  query: string;
  onQuery: (q: string) => void;
  messageSearch: boolean;
  onMessageSearch: (on: boolean) => void;
  onPickResult: (m: ApiMessage) => void;
  titleOf: (conversationId: string) => string;
  collapsed: Record<string, boolean>;
  onToggleSection: (key: SectionKey) => void;
  onOpen: (row: InboxRow) => void;
  onPrefs: (row: InboxRow, patch: Partial<ConversationPrefs>) => void;
  myId: string;
  nameOf: (userId: string) => string;
  avatarOf: (userId: string) => string | null;
  isOnline: (userId?: string | null) => boolean;
  projectOf: (projectId?: string) => ProjectLook | undefined;
  soundOn: boolean;
  onToggleSound: () => void;
  dmOpen: boolean;
  onToggleDm: () => void;
  dmOptions: SelectOption[];
  onStartDm: (userId: string) => void;
  loadingProjects: boolean;
  loadingInbox: boolean;
  projectsError: (() => void) | null;
  inboxError: (() => void) | null;
}

/** "14:05" today, "Yesterday", a weekday this week, else a short date. */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function Row({ row, active, opening, myId, nameOf, avatarOf, isOnline, projectOf, onOpen, onPrefs }: {
  row: InboxRow;
  active: boolean;
  opening: boolean;
  myId: string;
  nameOf: (id: string) => string;
  avatarOf: (id: string) => string | null;
  isOnline: (id?: string | null) => boolean;
  projectOf: (projectId?: string) => ProjectLook | undefined;
  onOpen: (row: InboxRow) => void;
  onPrefs: (row: InboxRow, patch: Partial<ConversationPrefs>) => void;
}) {
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const unread = active ? 0 : row.unread; // the open conversation is being read right now
  const preview = previewOf(row.lastMessage, { myId, kind: row.kind, nameOf });
  const items: MenuItem[] = [
    { label: row.prefs.favorite ? 'Remove from favorites' : 'Add to favorites', icon: <StarIcon size={16} filled={row.prefs.favorite} />, onSelect: () => onPrefs(row, { favorite: !row.prefs.favorite }) },
    { label: row.prefs.muted ? 'Unmute notifications' : 'Mute notifications', icon: row.prefs.muted ? <BellIcon size={16} /> : <BellOffIcon size={16} />, onSelect: () => onPrefs(row, { muted: !row.prefs.muted }) },
    { label: row.prefs.archived ? 'Move out of archive' : 'Archive', icon: <ArchiveIcon size={16} />, onSelect: () => onPrefs(row, { archived: !row.prefs.archived }) },
  ];
  return (
    <li className="group/row relative">
      <button
        type="button"
        onClick={() => onOpen(row)}
        aria-current={active ? 'true' : undefined}
        aria-busy={opening || undefined}
        className={`relative flex w-full items-center gap-2.5 rounded-xl py-2 pe-9 ps-2.5 text-start transition-colors ${
          active ? 'bg-brand/10 before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-full before:bg-brand' : 'hover:bg-ground'
        }`}
      >
        {row.kind === 'PROJECT' ? (
          <ChannelTile project={projectOf(row.projectId)} />
        ) : (
          <PresenceAvatar name={row.title} src={row.partnerId ? avatarOf(row.partnerId) : null} online={isOnline(row.partnerId)} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span dir="auto" title={row.title} className={`truncate text-sm ${active ? 'font-semibold text-brand' : unread ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>
              {row.title}
            </span>
            {row.lastMessage ? <span className={`ms-auto flex-none text-[11px] ${unread ? 'font-semibold text-brand' : 'text-ink-2'}`}>{when(row.lastMessage.createdAt)}</span> : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span dir="auto" className={`min-w-0 flex-1 truncate text-xs ${unread ? 'text-ink' : 'text-ink-2'}`}>
              {preview || (row.kind === 'PROJECT' && !row.conversationId ? 'Project channel' : 'No messages yet')}
            </span>
            {row.prefs.muted ? <span title="Muted" aria-label="Muted" role="img" className="flex-none text-ink-2"><BellOffIcon size={13} /></span> : null}
            {unread ? (
              <span aria-label={`${unread} unread`} className={`min-w-[1.25rem] flex-none rounded-full px-1.5 py-px text-center text-[11px] font-bold tabular-nums ${row.prefs.muted ? 'bg-line text-ink' : 'bg-brand text-white'}`}>
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </span>
        </span>
      </button>
      <button
        ref={moreRef}
        type="button"
        onClick={() => setMenu((m) => !m)}
        aria-label={`More options for ${row.title}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        className={`absolute end-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-ink-2 transition-opacity hover:bg-surface hover:text-ink focus-visible:opacity-100 ${
          menu ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100'
        }`}
      >
        <MoreIcon size={16} />
      </button>
      {menu ? <Menu anchor={moreRef.current} label={`Options for ${row.title}`} items={items} onClose={() => setMenu(false)} /> : null}
    </li>
  );
}

function Section({ id, title, count, unread, open, onToggle, children }: { id: SectionKey; title: string; count: number; unread: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div data-section={id} className="mt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`chat-section-${id}`}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-start text-[11px] font-bold uppercase tracking-wide text-ink-2 transition-colors hover:text-ink"
      >
        <span className={`transition-transform ${open ? '' : '-rotate-90 rtl:rotate-90'}`}><ChevronIcon size={14} /></span>
        <span className="flex-1">{title}</span>
        {unread > 0 ? (
          <span aria-label={`${unread} unread`} className="rounded-full bg-brand px-1.5 py-px text-[10px] font-bold normal-case tracking-normal text-white tabular-nums">{unread}</span>
        ) : (
          <span className="font-semibold normal-case tracking-normal text-ink-3">{count}</span>
        )}
      </button>
      {open ? <ul id={`chat-section-${id}`} className="flex flex-col gap-0.5">{children}</ul> : null}
    </div>
  );
}

const iconButton = 'grid h-9 w-9 place-items-center rounded-lg transition-colors';

/** The conversation list: search, then favorites, project channels, direct messages and the archive. */
export function ChatSidebar(p: ChatSidebarProps) {
  const searching = p.query.trim().length > 0;
  const rowProps = { myId: p.myId, nameOf: p.nameOf, avatarOf: p.avatarOf, isOnline: p.isOnline, projectOf: p.projectOf, onOpen: p.onOpen, onPrefs: p.onPrefs };
  const rows = (list: InboxRow[]) => list.map((r) => <Row key={r.key} row={r} active={p.activeKey === r.key} opening={p.openingKey === r.key} {...rowProps} />);
  const isOpen = (key: SectionKey) => searching || !p.collapsed[key];
  const unreadOf = (list: InboxRow[]) => list.reduce((n, r) => n + (p.activeKey === r.key ? 0 : r.unread), 0);
  const nothingFound = searching && !p.messageSearch && p.sections.favorites.length + p.sections.channels.length + p.sections.directs.length + p.sections.archived.length === 0;

  return (
    <aside aria-label="Conversations" className={`min-h-0 flex-col border-line bg-surface lg:border-e ${p.hidden ? 'hidden lg:flex' : 'flex'}`}>
      <div className="flex flex-none items-center gap-1 px-3 pb-2 pt-3">
        <h1 className="flex-1 font-display text-xl font-bold text-ink">Chat</h1>
        <button
          type="button"
          onClick={p.onToggleSound}
          aria-pressed={p.soundOn}
          aria-label="Notification sound"
          title={p.soundOn ? 'Notification sound is on' : 'Notification sound is off'}
          className={`${iconButton} ${p.soundOn ? 'text-brand hover:bg-brand/10' : 'text-ink-2 hover:bg-ground'}`}
        >
          {p.soundOn ? <VolumeIcon size={18} /> : <VolumeOffIcon size={18} />}
        </button>
        <button
          type="button"
          onClick={p.onToggleDm}
          aria-expanded={p.dmOpen}
          aria-label="New direct message"
          title="New direct message"
          className={`${iconButton} ${p.dmOpen ? 'bg-brand/10 text-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
        >
          {p.dmOpen ? <CloseIcon size={18} /> : <PlusIcon size={18} />}
        </button>
      </div>
      {p.dmOpen ? (
        <div className="flex-none px-3 pb-2">
          <SearchableSelect ariaLabel="Start a direct message" value="" placeholder="Message a teammate…" options={p.dmOptions} onChange={(v) => v && p.onStartDm(v)} />
        </div>
      ) : null}
      <div className="flex-none px-3 pb-2">
        <label className="relative block">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-2"><SearchIcon size={16} /></span>
          <input
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && p.query.trim().length >= 2) p.onMessageSearch(true); }}
            aria-label="Search conversations"
            placeholder="Search conversations"
            className="w-full rounded-xl border border-line bg-ground py-2 pe-3 ps-9 text-sm text-ink outline-none transition-colors placeholder:text-ink-2 focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/20"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {p.messageSearch ? (
          <div>
            <button type="button" onClick={() => p.onMessageSearch(false)} className="mb-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10">
              <BackIcon size={14} /> Back to conversations
            </button>
            <SearchResults q={p.query} titleOf={p.titleOf} nameOf={p.nameOf} onPick={p.onPickResult} />
          </div>
        ) : (
          <>
            {searching && p.query.trim().length >= 2 ? (
              <button type="button" onClick={() => p.onMessageSearch(true)} className="mb-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-start text-sm text-brand hover:bg-brand/10">
                <SearchIcon size={16} />
                <span dir="auto" className="min-w-0 truncate">{`Search messages for “${p.query.trim()}”`}</span>
              </button>
            ) : null}
            {nothingFound ? <p className="px-3 py-2 text-xs text-ink-2">No conversations match “{p.query.trim()}”.</p> : null}

            {p.sections.favorites.length > 0 ? (
              <Section id="favorites" title="Favorites" count={p.sections.favorites.length} unread={unreadOf(p.sections.favorites)} open={isOpen('favorites')} onToggle={() => p.onToggleSection('favorites')}>
                {rows(p.sections.favorites)}
              </Section>
            ) : null}

            {!searching || p.sections.channels.length > 0 ? (
              <Section id="channels" title="Project channels" count={p.sections.channels.length} unread={unreadOf(p.sections.channels)} open={isOpen('channels')} onToggle={() => p.onToggleSection('channels')}>
                {p.projectsError ? (
                  <li role="alert" className="px-2.5 py-1 text-xs text-danger">
                    Couldn’t load channels. <button type="button" onClick={p.projectsError} className="font-semibold underline">Retry</button>
                  </li>
                ) : p.loadingProjects ? (
                  <li className="px-2.5 py-1 text-xs text-ink-2">Loading…</li>
                ) : p.sections.channels.length === 0 && !searching ? (
                  <li className="px-2.5 py-1 text-xs text-ink-2">No project channels yet.</li>
                ) : (
                  rows(p.sections.channels)
                )}
              </Section>
            ) : null}

            {!searching || p.sections.directs.length > 0 ? (
              <Section id="directs" title="Direct messages" count={p.sections.directs.length} unread={unreadOf(p.sections.directs)} open={isOpen('directs')} onToggle={() => p.onToggleSection('directs')}>
                {p.inboxError ? (
                  <li role="alert" className="px-2.5 py-1 text-xs text-danger">
                    Couldn’t load your conversations. <button type="button" onClick={p.inboxError} className="font-semibold underline">Retry</button>
                  </li>
                ) : p.loadingInbox ? (
                  <li className="px-2.5 py-1 text-xs text-ink-2">Loading…</li>
                ) : p.sections.directs.length === 0 && !searching ? (
                  <li className="px-2.5 py-1 text-xs text-ink-2">
                    No direct messages yet.{' '}
                    <button type="button" onClick={p.onToggleDm} className="font-semibold text-brand hover:underline">Start one</button>
                  </li>
                ) : (
                  rows(p.sections.directs)
                )}
              </Section>
            ) : null}

            {p.sections.archived.length > 0 ? (
              <Section id="archived" title="Archived" count={p.sections.archived.length} unread={p.sections.archivedUnread} open={isOpen('archived')} onToggle={() => p.onToggleSection('archived')}>
                {rows(p.sections.archived)}
              </Section>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
