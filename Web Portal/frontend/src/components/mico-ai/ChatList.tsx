import { useRef, useState } from 'react';
import type { MicoAiChat } from '../../api/mico-ai';
import { chatGroups, chatTitle } from '../../lib/mico-ai';
import { Menu } from '../chat/Popover';
import { MoreIcon, PlusIcon, SearchIcon } from '../chat/icons';
import { MicoAiMark } from './AnswerParts';

export interface ChatListProps {
  chats: MicoAiChat[];
  activeId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (chat: MicoAiChat) => void;
  timeZone: string;
  loading?: boolean;
  error?: (() => void) | null;
  now?: Date;
}

function ChatRow({ chat, active, onOpen, onRename, onDelete }: { chat: MicoAiChat; active: boolean } & Pick<ChatListProps, 'onOpen' | 'onRename' | 'onDelete'>) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const title = chatTitle(chat);
  const save = (value: string) => {
    setEditing(false);
    const clean = value.replace(/\s+/g, ' ').trim();
    if (clean && clean !== chat.title) onRename(chat.id, clean);
  };
  if (editing) {
    return (
      <li className="px-1 py-0.5">
        <input
          autoFocus
          aria-label="Chat name"
          defaultValue={chat.title}
          maxLength={200}
          dir="auto"
          onKeyDown={(e) => {
            if (e.key === 'Enter') save(e.currentTarget.value);
            else if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          onBlur={(e) => save(e.currentTarget.value)}
          className="w-full rounded-lg border border-brand bg-surface px-2.5 py-1.5 text-sm text-ink outline-none ring-2 ring-brand/20"
        />
      </li>
    );
  }
  return (
    <li className={`group relative flex items-center rounded-lg ${active ? 'bg-surface shadow-soft ring-1 ring-line' : 'hover:bg-surface/70'}`}>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={() => onOpen(chat.id)}
        className={`min-h-9 min-w-0 flex-1 rounded-lg px-2.5 py-2 text-start text-sm ${active ? 'font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}
      >
        <span dir="auto" className="block truncate">{title}</span>
        {chat.match ? (
          <span dir="auto" aria-hidden="true" className="mt-0.5 block truncate text-xs font-normal text-ink-3">{chat.match}</span>
        ) : null}
      </button>
      <button
        ref={more}
        type="button"
        aria-label={`More for ${title}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((v) => !v)}
        className={`me-1 grid h-8 w-8 flex-none place-items-center rounded-md text-ink-2 transition-opacity hover:bg-ground hover:text-ink focus-visible:opacity-100 ${active || menu ? 'opacity-100' : 'opacity-100 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100'}`}
      >
        <MoreIcon size={16} />
      </button>
      {menu ? (
        <Menu
          anchor={more.current}
          label={`Chat ${title}`}
          onClose={() => setMenu(false)}
          items={[
            { label: 'Rename', onSelect: () => setEditing(true) },
            { label: 'Delete…', danger: true, onSelect: () => onDelete(chat) },
          ]}
        />
      ) : null}
    </li>
  );
}

/**
 * MICO AI's own list of chats: New chat, Search chats, and the chats by day, each with Rename and
 * Delete. A slim rail beside the conversation on a wide screen; a sheet from ☰ on a phone or tablet.
 */
export function ChatList({ chats, activeId, query, onQuery, onOpen, onNew, onRename, onDelete, timeZone, loading, error, now = new Date() }: ChatListProps) {
  const groups = chatGroups(chats, now, timeZone);
  return (
    <nav aria-label="Chats" className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 px-3 pb-3 pt-3.5">
        {/* Room on the right for the sheet's Close button (on a phone or tablet). */}
        <div className="flex items-center gap-2.5 pe-11 ps-1 lg:pe-1">
          <MicoAiMark />
          <div className="min-w-0">
            <p className="font-display text-base font-semibold leading-tight text-ink">MICO AI</p>
            <p className="truncate text-xs text-ink-3">Answers from your MICO360 data</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-3 text-sm font-semibold text-white shadow-brand transition-shadow hover:shadow-lift"
        >
          <PlusIcon size={16} />
          New chat
        </button>
        <div className="relative">
          <span className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3">
            <SearchIcon size={15} />
          </span>
          <input
            type="search"
            role="searchbox"
            aria-label="Search chats"
            placeholder="Search chats"
            value={query}
            dir="auto"
            onChange={(e) => onQuery(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface py-1.5 pe-3 ps-8 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line/70 px-2 py-2">
        {error ? (
          <p className="px-2 py-3 text-sm text-danger">
            Your chats couldn’t be loaded.{' '}
            <button type="button" onClick={error} className="font-semibold underline">
              Try again
            </button>
          </p>
        ) : loading && chats.length === 0 ? (
          <p className="px-2 py-3 text-sm text-ink-3">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="px-2 py-3 text-sm text-ink-3">{query.trim() ? `No chats match “${query.trim()}”.` : 'No chats yet. Ask a question to start one.'}</p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="pb-2">
              <h2 className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                {g.label}
              </h2>
              <ul className="space-y-0.5">
                {g.chats.map((c) => (
                  <ChatRow key={c.id} chat={c} active={c.id === activeId} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
      <p className="border-t border-line/70 px-4 py-3 text-xs leading-relaxed text-ink-3">MICO AI only uses what you can see in MICO360 Tasks. Your chats are private to you.</p>
    </nav>
  );
}
