import { memo, useRef, useState } from 'react';
import { fileUrl, type ApiChatAttachment } from '../../api/chat';
import { Avatar } from '../ui/Avatar';
import { tokenizeMentions } from '../../lib/mentions';
import { downloadNameFor } from '../../lib/download';
import { MAX_MESSAGE_LENGTH, formatSize, type ReceiptStatus, type ShownMessage } from '../../lib/chat-model';
import { ReactionPopover } from './EmojiPicker';
import { Menu, type MenuItem } from './Popover';
import { AlertIcon, ClockIcon, CopyIcon, DownloadIcon, EditIcon, FileIcon, MoreIcon, ReplyIcon, SmileIcon, Ticks, TrashIcon } from './icons';

/** Show the character counter once a draft gets close to the limit. */
export const COUNTER_FROM = 3500;

/** What a message row can ask the page to do. One stable object, so rows only redraw when their message changes. */
export interface MessageActions {
  reply: (m: ShownMessage) => void;
  react: (m: ShownMessage, emoji: string) => void;
  copy: (m: ShownMessage) => void;
  startEdit: (m: ShownMessage) => void;
  saveEdit: (id: string, body: string) => Promise<boolean>;
  cancelEdit: () => void;
  remove: (m: ShownMessage) => void;
  retry: (m: ShownMessage) => void;
  discard: (m: ShownMessage) => void;
  /** Put an unsent message's text back in the box to change it. */
  editUnsent: (m: ShownMessage) => void;
  jumpTo: (messageId: string) => void;
  openImage: (a: ApiChatAttachment) => void;
  /** Touch screens: show this message's actions (null hides them). */
  reveal: (messageId: string | null) => void;
}

export interface MessageItemProps {
  m: ShownMessage;
  mine: boolean;
  groupStart: boolean;
  groupEnd: boolean;
  authorName: string;
  authorAvatar: string | null;
  receipt?: { status: ReceiptStatus; seenBy?: number };
  canEdit: boolean;
  canDelete: boolean;
  editing: boolean;
  highlighted: boolean;
  /** Its actions are showing (touch screens, after a tap). */
  revealed: boolean;
  myId: string;
  myUsername: string;
  knownUsernames: readonly string[];
  nameOf: (userId: string) => string;
  actions: MessageActions;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Trailing punctuation that belongs to the sentence, not to a web address in it. */
const TRAILING = /[.,;:!?)\]}'"»]+$/;

/** Plain text with its http(s) addresses turned into links (nothing else is ever linked). */
function linkify(text: string, mine: boolean) {
  const parts = text.split(/(https?:\/\/[^\s<>]+)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const tail = TRAILING.exec(part)?.[0] ?? '';
    const url = tail ? part.slice(0, -tail.length) : part;
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${mine ? 'text-white' : 'text-brand'}`}>
          {url}
        </a>
        {tail}
      </span>
    );
  });
}

/** The text with @mentions marked, adapted to the bubble it sits in. */
function renderBody(body: string, knownUsernames: readonly string[], myUsername: string, mine: boolean) {
  return tokenizeMentions(body, knownUsernames).map((tok, i) => {
    if (tok.type === 'mention' && tok.username) {
      const isMe = tok.username === myUsername;
      // In your own (brand-coloured) bubble the mention sits on a darker chip, readable in both themes.
      const cls = mine ? 'bg-black/20 text-white' : isMe ? 'bg-brand/15 text-brand' : 'text-brand';
      return <span key={i} className={`rounded px-0.5 font-semibold ${cls}`}>{tok.value}</span>;
    }
    return <span key={i}>{linkify(tok.value, mine)}</span>;
  });
}

const RECEIPT_LABEL: Record<ReceiptStatus, string> = {
  queued: 'Waiting for connection',
  sending: 'Sending',
  failed: 'Not sent',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
};

/** Where your message stands, as ticks (and the words for assistive tech and on hover). */
function Receipt({ status, seenBy, onBubble = true }: { status: ReceiptStatus; seenBy?: number; onBubble?: boolean }) {
  const label = status === 'read' && seenBy ? `Seen by ${seenBy}` : RECEIPT_LABEL[status];
  // On your brand-coloured bubble the ticks are light; beside a file (on the page) they use the text tones.
  const quiet = onBubble ? 'text-white/80' : 'text-ink-2';
  const seen = onBubble ? 'text-sky-200' : 'text-info';
  if (status === 'queued' || status === 'sending') {
    return (
      <span role="img" aria-label={label} title={label} className={`inline-flex ${quiet}`}>
        <ClockIcon size={12} />
      </span>
    );
  }
  if (status === 'failed') return null;
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex items-center gap-0.5 ${status === 'read' ? seen : quiet}`}>
      <Ticks double={status !== 'sent'} bold={status === 'read'} />
      {seenBy ? <span className="text-[10px] font-semibold tabular-nums">{seenBy}</span> : null}
    </span>
  );
}

function ReplyQuote({ quote, mine, nameOf, onJump }: { quote: NonNullable<ShownMessage['replyTo']>; mine: boolean; nameOf: (id: string) => string; onJump: () => void }) {
  const who = nameOf(quote.userId);
  const text = quote.deleted ? 'This message was deleted.' : quote.body.replace(/\s+/g, ' ');
  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`Reply to ${who}: ${text} — show that message`}
      className={`mb-1 block w-full min-w-0 rounded-lg border-s-[3px] px-2.5 py-1 text-start text-xs transition-colors ${
        mine ? 'border-white/70 bg-black/15 text-white/90 hover:bg-black/25' : 'border-brand/60 bg-ground text-ink-2 hover:bg-line/50'
      }`}
    >
      <span dir="auto" className={`block truncate font-semibold ${mine ? 'text-white' : 'text-ink'}`}>{who}</span>
      <span dir="auto" className={`line-clamp-2 [overflow-wrap:anywhere] ${quote.deleted ? 'italic' : ''}`}>{text}</span>
    </button>
  );
}

function Attachments({ m, mine, onOpenImage }: { m: ShownMessage; mine: boolean; onOpenImage: (a: ApiChatAttachment) => void }) {
  const files = m.attachments;
  const pending = m.pendingFiles ?? [];
  if (files.length === 0 && pending.length === 0) return null;
  return (
    <div className={`mt-1 flex max-w-full flex-col gap-1.5 ${mine ? 'items-end' : 'items-start'}`}>
      {files.map((a) =>
        a.mimeType.startsWith('image/') ? (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpenImage(a)}
            aria-label={`Open ${a.fileName}`}
            className="block max-w-full overflow-hidden rounded-xl border border-line bg-ground transition-opacity hover:opacity-90"
          >
            <img src={fileUrl(a.url)} alt={a.fileName} loading="lazy" className="max-h-64 max-w-full object-contain sm:max-w-xs" />
          </button>
        ) : (
          <a
            key={a.id}
            href={fileUrl(a.url)}
            download={downloadNameFor(a.fileName)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Download ${a.fileName} (${formatSize(a.sizeBytes)})`}
            className="flex max-w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-start text-ink shadow-soft transition-colors hover:border-brand"
          >
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-brand/10 text-brand"><FileIcon size={18} /></span>
            <span className="min-w-0">
              <span dir="auto" className="block truncate text-sm font-medium">{a.fileName}</span>
              <span className="block text-[11px] text-ink-2">{formatSize(a.sizeBytes)}</span>
            </span>
            <span className="ms-1 flex-none text-ink-2"><DownloadIcon size={16} /></span>
          </a>
        ),
      )}
      {pending.map((f) => (
        <div key={f.name} className="w-64 max-w-full overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-soft">
          {f.previewUrl ? <img src={f.previewUrl} alt={f.name} className="max-h-48 w-full object-cover opacity-80" /> : null}
          <div className="flex items-center gap-2.5 px-3 py-2">
            {f.previewUrl ? null : <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-brand/10 text-brand"><FileIcon size={18} /></span>}
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate text-sm font-medium">{f.name}</span>
              <span className="block text-[11px] text-ink-2">{formatSize(f.size)}</span>
            </span>
          </div>
          {m.pending === 'sending' || m.pending === 'queued' ? (
            <div
              role="progressbar"
              aria-label={`Uploading ${f.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(f.progress * 100)}
              className="h-1 bg-line"
            >
              <div className="h-full bg-brand transition-[width] duration-200" style={{ width: `${Math.max(4, Math.round(f.progress * 100))}%` }} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Reactions({ m, mine, myId, nameOf, onReact }: { m: ShownMessage; mine: boolean; myId: string; nameOf: (id: string) => string; onReact: (emoji: string) => void }) {
  if (m.reactions.length === 0) return null;
  return (
    <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
      {m.reactions.map((r) => {
        const reacted = r.userIds.includes(myId);
        const who = r.userIds.map((id) => (id === myId ? 'You' : nameOf(id))).join(', ');
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onReact(r.emoji)}
            aria-pressed={reacted}
            aria-label={`${r.emoji} ${r.userIds.length}`}
            title={who}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
              reacted ? 'border-brand/60 bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand'
            }`}
          >
            <span className="text-sm leading-none">{r.emoji}</span>
            <span className="font-semibold tabular-nums">{r.userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function Editor({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => Promise<boolean>; onCancel: () => void }) {
  const [body, setBody] = useState(initial);
  const [saving, setSaving] = useState(false);
  const length = body.trim().length;
  const tooLong = length > MAX_MESSAGE_LENGTH;
  const save = async () => {
    if (saving || tooLong) return;
    setSaving(true);
    await onSave(body);
    setSaving(false);
  };
  return (
    <div className="flex w-[min(32rem,100%)] min-w-[15rem] flex-col gap-1">
      <textarea
        value={body}
        dir="auto"
        aria-label="Edit message"
        autoFocus
        onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
        aria-invalid={tooLong || undefined}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); }
          if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
        }}
        rows={3}
        className={`w-full resize-y rounded-xl border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:ring-2 ${tooLong ? 'border-danger focus:ring-danger/20' : 'border-line focus:border-brand focus:ring-brand/20'}`}
      />
      <div className="flex items-center gap-3 text-xs">
        <button type="button" onClick={() => void save()} disabled={saving || tooLong} className="rounded-md bg-brand px-2.5 py-1 font-semibold text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="font-medium text-ink-2 hover:text-ink hover:underline">Cancel</button>
        <span className="text-ink-2">Enter to save · Esc to cancel</span>
        {length > COUNTER_FROM ? (
          <span className={`ms-auto tabular-nums ${tooLong ? 'font-semibold text-danger' : 'text-ink-2'}`}>
            {length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const toolButton = 'grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink focus-visible:bg-ground';

/** One message: the bubble, what it answers, its files and reactions, and the actions on it. */
export const MessageItem = memo(function MessageItem({
  m, mine, groupStart, groupEnd, authorName, authorAvatar, receipt, canEdit, canDelete, editing, highlighted, revealed, myId, myUsername, knownUsernames, nameOf, actions,
}: MessageItemProps) {
  const deleted = !!m.deletedAt;
  const hasText = !deleted && m.body.trim().length > 0;
  const [popover, setPopover] = useState<'react' | 'more' | null>(null);
  const reactRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const settled = !m.pending && !m.error;

  const menu: MenuItem[] = [];
  if (hasText) menu.push({ label: 'Copy text', icon: <CopyIcon size={16} />, onSelect: () => actions.copy(m) });
  if (canEdit && hasText) menu.push({ label: 'Edit', icon: <EditIcon size={16} />, onSelect: () => actions.startEdit(m) });
  if (canDelete) menu.push({ label: 'Delete', icon: <TrashIcon size={16} />, danger: true, onSelect: () => actions.remove(m) });

  // Rounded corners, with the corner next to the sender squared off inside a group.
  const shape = mine
    ? `rounded-2xl ${groupStart ? '' : 'rounded-se-md'} ${groupEnd ? '' : 'rounded-ee-md'}`
    : `rounded-2xl ${groupStart ? '' : 'rounded-ss-md'} ${groupEnd ? '' : 'rounded-es-md'}`;
  const tone = mine
    ? `bg-brand text-white ${m.pending ? 'opacity-80' : ''} ${m.pending === 'failed' ? 'ring-2 ring-danger ring-offset-1 ring-offset-surface' : ''}`
    : 'border border-line bg-surface text-ink';

  // Reactions, reply and more. Above the bubble on its inner side, so it never leaves the conversation.
  const toolbar = settled && !deleted && !editing ? (
    <div
      dir="ltr"
      data-toolbar
      className={`absolute bottom-full z-10 mb-1 flex items-center gap-0.5 rounded-xl border border-line bg-surface p-0.5 shadow-soft transition-opacity duration-150 ${
        popover ? 'opacity-100' : revealed ? 'opacity-100' : 'pointer-events-none opacity-0 [@media(hover:hover)]:group-hover/msg:pointer-events-auto [@media(hover:hover)]:group-hover/msg:opacity-100 group-focus-within/msg:pointer-events-auto group-focus-within/msg:opacity-100'
      } ${mine ? 'end-0' : 'start-0'}`}
    >
      <button ref={reactRef} type="button" onClick={() => setPopover((p) => (p === 'react' ? null : 'react'))} aria-label="Add reaction" aria-expanded={popover === 'react'} title="Add reaction" className={toolButton}>
        <SmileIcon size={17} />
      </button>
      <button type="button" onClick={() => actions.reply(m)} aria-label="Reply" title="Reply" className={toolButton}>
        <ReplyIcon size={17} />
      </button>
      {menu.length > 0 ? (
        <button ref={moreRef} type="button" onClick={() => setPopover((p) => (p === 'more' ? null : 'more'))} aria-label="More actions" aria-haspopup="menu" aria-expanded={popover === 'more'} title="More actions" className={toolButton}>
          <MoreIcon size={17} />
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div
      data-message-id={m.id}
      data-highlighted={highlighted ? 'true' : undefined}
      data-revealed={revealed || undefined}
      onClick={(e) => {
        // On a touch screen there is no hover: a tap on the message shows its actions (one at a time).
        if ((e.target as HTMLElement).closest('button, a, textarea')) return;
        actions.reveal(revealed ? null : m.id);
      }}
      className={`group/msg relative flex gap-2 rounded-xl px-1 transition-colors duration-700 ${mine ? 'flex-row-reverse' : ''} ${groupStart ? 'mt-3' : 'mt-0.5'} ${highlighted ? 'bg-brand/10' : ''}`}
    >
      {mine ? null : groupStart ? (
        <span className="mt-5 flex-none" aria-hidden="true"><Avatar name={authorName} size="md" src={authorAvatar} /></span>
      ) : (
        <span className="w-8 flex-none" aria-hidden="true" />
      )}

      <div className={`flex min-w-0 max-w-[85%] flex-col sm:max-w-[75%] xl:max-w-[44rem] ${mine ? 'items-end' : 'items-start'}`}>
        {groupStart && !mine ? (
          <div className="mb-0.5 max-w-full px-1">
            <span dir="auto" className="block truncate text-[13px] font-semibold text-ink">{authorName}</span>
          </div>
        ) : null}

        <div className={`relative flex max-w-full flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {deleted ? (
            <div className="rounded-2xl border border-dashed border-line px-3.5 py-2 text-sm italic text-ink-2">This message was deleted.</div>
          ) : editing ? (
            <Editor initial={m.body} onSave={(body) => actions.saveEdit(m.id, body)} onCancel={actions.cancelEdit} />
          ) : hasText || m.replyTo ? (
            // `overflow-wrap: anywhere` + a width limit: a long word with no spaces (a path, a token)
            // breaks inside the bubble instead of pushing it off the screen.
            <div dir="auto" data-bubble className={`relative min-w-0 max-w-full px-3 py-1.5 text-start text-[0.9375rem] leading-relaxed shadow-soft [overflow-wrap:anywhere] ${shape} ${tone}`}>
              {m.replyTo ? <ReplyQuote quote={m.replyTo} mine={mine} nameOf={nameOf} onJump={() => actions.jumpTo(m.replyTo!.id)} /> : null}
              <span className="whitespace-pre-wrap">{renderBody(m.body, knownUsernames, myUsername, mine)}</span>
              {/* Time, "edited" and ticks float to the end of the last line when there is room. */}
              <span className={`float-end ms-3 mt-1.5 inline-flex translate-y-0.5 items-center gap-1 text-[11px] leading-none ${mine ? 'text-white/85' : 'text-ink-2'}`}>
                {m.editedAt ? <span>Edited</span> : null}
                {m.editedAt ? <span aria-hidden="true">·</span> : null}
                <time dateTime={m.createdAt} title={fullTime(m.createdAt)}>{clockTime(m.createdAt)}</time>
                {mine && receipt ? <Receipt status={receipt.status} seenBy={receipt.seenBy} /> : null}
              </span>
            </div>
          ) : (
            // A file without a caption: no empty bubble, just its time beside the file.
            <span className="sr-only">{`${mine ? 'You' : authorName} sent a file at ${clockTime(m.createdAt)}`}</span>
          )}
          {!deleted ? <Attachments m={m} mine={mine} onOpenImage={actions.openImage} /> : null}
          {!deleted && !hasText && !m.replyTo && (m.attachments.length > 0 || m.pendingFiles?.length) ? (
            <span className="mt-0.5 inline-flex items-center gap-1 px-1 text-[11px] text-ink-2">
              <time dateTime={m.createdAt}>{clockTime(m.createdAt)}</time>
              {mine && receipt ? <Receipt status={receipt.status} seenBy={receipt.seenBy} onBubble={false} /> : null}
            </span>
          ) : null}
          {toolbar}
        </div>

        {!deleted ? <Reactions m={m} mine={mine} myId={myId} nameOf={nameOf} onReact={(e) => actions.react(m, e)} /> : null}

        {m.pending === 'queued' ? (
          <p className="mt-0.5 inline-flex items-center gap-1 px-1 text-[11px] text-ink-2"><ClockIcon size={12} /> Waiting for connection</p>
        ) : null}
        {m.pending === 'failed' ? (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 px-1 text-xs">
            <span dir="auto" className="inline-flex items-center gap-1 font-medium text-danger">
              <AlertIcon size={14} /> Not sent{m.error ? ` — ${m.error}` : ''}
            </span>
            <button type="button" onClick={() => actions.retry(m)} className="rounded-md border border-line px-2 py-0.5 font-semibold text-brand hover:border-brand">Retry</button>
            {m.body && !m.pendingFiles?.length ? (
              <button type="button" onClick={() => actions.editUnsent(m)} className="rounded-md px-2 py-0.5 font-medium text-ink-2 hover:text-ink hover:underline">Edit</button>
            ) : null}
            <button type="button" onClick={() => actions.discard(m)} className="rounded-md px-2 py-0.5 font-medium text-ink-2 hover:text-ink hover:underline">Discard</button>
          </div>
        ) : null}
      </div>

      {popover === 'react' ? <ReactionPopover anchor={reactRef.current} onPick={(e) => actions.react(m, e)} onClose={() => setPopover(null)} /> : null}
      {popover === 'more' ? <Menu anchor={moreRef.current} label="Message actions" items={menu} onClose={() => setPopover(null)} /> : null}
    </div>
  );
});
