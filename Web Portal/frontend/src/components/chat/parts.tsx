import { useEffect, useState } from 'react';
import { fileUrl, type ApiChatAttachment, type ConversationPrefs } from '../../api/chat';
import { Avatar } from '../ui/Avatar';
import { ProjectAvatar, type ProjectLook } from '../ProjectAvatar';
import { ModalPortal } from '../ui/ModalPortal';
import { useDialog } from '../../hooks/useDialog';
import { downloadNameFor } from '../../lib/download';
import type { ChatConnection } from '../../lib/useChatRealtime';
import { BackIcon, BellIcon, BellOffIcon, CloseIcon, DownloadIcon, HashIcon, MessageIcon, SearchIcon, StarIcon, UsersIcon, WifiOffIcon } from './icons';

/** An avatar with a live online/offline dot. */
export function PresenceAvatar({ name, src, online, size = 'md' }: { name: string; src?: string | null; online: boolean; size?: 'sm' | 'md' }) {
  return (
    <span className="relative inline-flex flex-none" aria-hidden="true">
      <Avatar name={name} size={size} src={src} />
      <span className={`absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-surface ${online ? 'bg-success' : 'bg-ink-3'}`} />
    </span>
  );
}

/** A project channel's tile: the project's own picture (image, icon or initials); a # until the project is known. */
export function ChannelTile({ project, size = 'md' }: { project?: ProjectLook | null; size?: 'sm' | 'md' }) {
  if (project) return <ProjectAvatar project={project} size={size === 'md' ? 'md' : 'sm'} />;
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center rounded-lg text-white ${size === 'md' ? 'h-8 w-8' : 'h-6 w-6'}`}
      style={{ background: 'rgb(var(--c-brand))' }}
    >
      <HashIcon size={size === 'md' ? 15 : 12} />
    </span>
  );
}

const headerButton = (on: boolean) =>
  `grid h-9 w-9 flex-none place-items-center rounded-lg transition-colors ${on ? 'bg-brand/10 text-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`;

export function ConversationHeader({
  title, kind, avatarUrl, project, online, subtitle, subtitleTone, prefs, searchOpen, membersOpen, onBack, onToggleSearch, onToggleMembers, onToggleMute, onToggleFavorite,
}: {
  title: string;
  kind: 'PROJECT' | 'DIRECT';
  avatarUrl?: string | null;
  project?: ProjectLook | null;
  online: boolean;
  subtitle: string;
  subtitleTone: 'online' | 'plain';
  prefs: ConversationPrefs;
  searchOpen: boolean;
  membersOpen: boolean;
  onBack: () => void;
  onToggleSearch: () => void;
  onToggleMembers: () => void;
  onToggleMute: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <header className="flex flex-none items-center gap-2 border-b border-line bg-surface px-2 py-2 sm:px-4">
      <button type="button" onClick={onBack} aria-label="Back to conversations" className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink lg:hidden">
        <BackIcon size={20} />
      </button>
      {kind === 'PROJECT' ? <ChannelTile project={project} /> : <PresenceAvatar name={title} src={avatarUrl} online={online} />}
      <div className="min-w-0 flex-1">
        {/* <bdi>, not dir="auto" on the heading: an Arabic name keeps its own direction without being pushed to the far side. */}
        <h2 title={title} className="truncate text-start font-display text-[0.9375rem] font-bold leading-tight text-ink"><bdi>{title}</bdi></h2>
        <p className={`flex min-w-0 items-center gap-1.5 truncate text-xs ${subtitleTone === 'online' ? 'text-success' : 'text-ink-2'}`}>
          {kind === 'DIRECT' ? <span className={`h-1.5 w-1.5 flex-none rounded-full ${online ? 'bg-success' : 'bg-ink-3'}`} aria-hidden="true" /> : null}
          <span className="truncate">{subtitle}</span>
          {prefs.muted ? <span className="inline-flex flex-none items-center gap-0.5 text-ink-2"><BellOffIcon size={12} /> Muted</span> : null}
        </p>
      </div>
      <div className="flex flex-none items-center gap-0.5">
        <button type="button" onClick={onToggleSearch} aria-pressed={searchOpen} aria-label="Search in conversation" title="Search in conversation" className={headerButton(searchOpen)}>
          <SearchIcon size={18} />
        </button>
        <button type="button" onClick={onToggleMembers} aria-pressed={membersOpen} aria-label="Members" title="Members" className={headerButton(membersOpen)}>
          <UsersIcon size={18} />
        </button>
        <button type="button" onClick={onToggleMute} aria-pressed={prefs.muted} aria-label="Mute notifications" title={prefs.muted ? 'Notifications are muted for this conversation' : 'Mute notifications for this conversation'} className={headerButton(prefs.muted)}>
          {prefs.muted ? <BellOffIcon size={18} /> : <BellIcon size={18} />}
        </button>
        <button type="button" onClick={onToggleFavorite} aria-pressed={prefs.favorite} aria-label="Favorite" title={prefs.favorite ? 'Remove from favorites' : 'Add to favorites'} className={`hidden sm:grid ${headerButton(prefs.favorite)}`}>
          <StarIcon size={18} filled={prefs.favorite} />
        </button>
      </div>
    </header>
  );
}

export interface MemberRow {
  id: string;
  name: string;
  username?: string;
  avatarUrl?: string | null;
  online: boolean;
  presence: string;
  me: boolean;
}

export function MembersPanel({ members, loading, error, onRetry, onMessage, onClose }: {
  members: MemberRow[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onMessage: (userId: string) => void;
  onClose: () => void;
}) {
  const online = members.filter((m) => m.online).length;
  return (
    <aside aria-label="Members" className="absolute inset-y-0 end-0 z-20 flex w-72 max-w-full flex-col border-s border-line bg-surface shadow-lift xl:static xl:z-auto xl:shadow-none">
      <div className="flex flex-none items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-ink">Members</h3>
          <p className="text-xs text-ink-2">{loading ? 'Loading…' : `${members.length} ${members.length === 1 ? 'person' : 'people'} · ${online} online`}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close members" className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink">
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error ? (
          <p role="alert" className="px-2 py-2 text-xs text-danger">
            Couldn’t load the members. <button type="button" onClick={onRetry} className="font-semibold underline">Retry</button>
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ground">
                <PresenceAvatar name={m.name} src={m.avatarUrl} online={m.online} />
                <div className="min-w-0 flex-1">
                  <p dir="auto" title={m.name} className="truncate text-sm font-medium text-ink">{m.name}{m.me ? ' (you)' : ''}</p>
                  <p className={`truncate text-[11px] ${m.online ? 'text-success' : 'text-ink-2'}`}>{m.presence}</p>
                </div>
                {m.me ? null : (
                  <button type="button" onClick={() => onMessage(m.id)} aria-label={`Message ${m.name}`} title={`Message ${m.name}`} className="grid h-8 w-8 flex-none place-items-center rounded-lg text-ink-2 hover:bg-surface hover:text-brand">
                    <MessageIcon size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/** Wait this long before saying the first connection is still being made (it usually takes a moment). */
const CONNECTING_GRACE_MS = 3000;

/** The live connection's state, said only when something is wrong. */
export function ConnectionBanner({ status, waiting }: { status: ChatConnection; waiting: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (status !== 'connecting') return setSlow(false);
    const t = setTimeout(() => setSlow(true), CONNECTING_GRACE_MS);
    return () => clearTimeout(t);
  }, [status]);
  const queued = waiting > 0 ? ` ${waiting} ${waiting === 1 ? 'message is' : 'messages are'} waiting to be sent.` : '';
  const text =
    status === 'offline'
      ? `You’re offline. Messages you send will go out when you’re back online.${queued}`
      : status === 'reconnecting'
        ? `Reconnecting… New messages will appear once the connection is back.${queued}`
        : status === 'connecting' && slow
          ? 'Connecting to live updates…'
          : '';
  return (
    <div role="status" aria-label="Connection status" className={text ? 'flex-none' : 'sr-only'}>
      {text ? (
        <p className={`flex items-center gap-2 border-b px-4 py-1.5 text-xs font-medium ${status === 'offline' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-warning/30 bg-warning-soft text-warning'}`}>
          {status === 'offline' ? <WifiOffIcon size={14} /> : <span className="h-2 w-2 animate-pulse rounded-full bg-warning motion-reduce:animate-none" aria-hidden="true" />}
          {text}
        </p>
      ) : null}
    </div>
  );
}

/** A picture from the conversation, full size, with its download. */
export function ImageViewer({ attachment, onClose }: { attachment: ApiChatAttachment; onClose: () => void }) {
  const ref = useDialog(onClose, { initialFocus: 'container' });
  const url = fileUrl(attachment.url);
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex flex-col bg-black/85 animate-fade-in">
        <div ref={ref} role="dialog" aria-modal="true" aria-label={attachment.fileName} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          <div className="flex flex-none items-center gap-3 px-4 py-3 text-white">
            <p dir="auto" className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.fileName}</p>
            <a href={url} download={downloadNameFor(attachment.fileName) ?? attachment.fileName} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20">
              <DownloadIcon size={16} /> Download
            </a>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 hover:bg-white/20">
              <CloseIcon size={18} />
            </button>
          </div>
          <div className="grid min-h-0 flex-1 place-items-center p-4" onClick={onClose}>
            <img src={url} alt={attachment.fileName} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain shadow-lift" />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
