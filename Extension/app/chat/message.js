/**
 * One chat message, as the web shows it (components/chat/MessageItem.tsx), for the extension's
 * thread: who wrote it and when, the message it answers, its text, its files (a picture opens full
 * size in a new tab, a document downloads), its reactions with who reacted, and — for one still on
 * its way — whether it is being sent, kept on this device, or wasn't sent (with Retry and Discard).
 * Only this server's own files are linked or shown.
 */
import { el } from '../dom.js';
import { attachmentUrl, fileKind, KIND_LABEL } from '../../src/file-kind.js';
import { formatSize, reactionLabel } from '../../src/chat.js';

const fullTime = (iso) => {
  try {
    return new Date(iso).toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

/**
 * When a message was sent, as a clock time (as on the web) — "14:05" today, "Yesterday 09:12", else
 * the date with it. It never goes out of date while the conversation stays open (a message is only
 * drawn again when it changes).
 */
export function messageTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return clock;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${clock}`;
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return `${date}, ${clock}`;
}

/** What decides whether a message's node must be drawn again. */
export function messageSignature(m) {
  return JSON.stringify([
    m.body, m.editedAt, m.deletedAt, m.pending, m.error || null, m.replyTo || null,
    (m.attachments || []).map((a) => [a.id, a.url]), (m.reactions || []).map((r) => [r.emoji, r.userIds]),
    (m.pendingFiles || []).map((f) => f.name),
  ]);
}

function fileNode(a, opts) {
  const href = attachmentUrl(opts.apiBase, a.url);
  const name = a.fileName || 'File';
  const size = formatSize(a.sizeBytes || 0);
  const kind = fileKind(a.mimeType, name);
  if (!href) return el('span', { class: 'chat-file', dir: 'auto' }, `${name} (${size})`);
  if (kind === 'image') {
    return el('a', { class: 'chat-picture', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${name}`, title: `Open ${name}` },
      el('img', { src: href, alt: name, loading: 'lazy' }));
  }
  return el('a', { class: 'chat-file', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Download ${name} (${size})`, title: `Download ${name}` },
    el('span', { class: `td-thumb kind-${kind}`, 'aria-hidden': 'true' }, KIND_LABEL[kind]),
    el('span', { class: 'chat-file-name', dir: 'auto' }, name),
    el('span', { class: 'muted chat-file-size' }, size));
}

function pendingFileNode(f, m) {
  const going = m.pending === 'sending';
  return el('div', { class: 'chat-file chat-file-pending' },
    el('span', { class: 'td-thumb', 'aria-hidden': 'true' }, going ? '…' : '!'),
    el('span', { class: 'chat-file-name', dir: 'auto' }, f.name),
    el('span', { class: 'muted chat-file-size' }, formatSize(f.size || 0)),
    going ? el('progress', { class: 'td-progress', 'aria-label': `Uploading ${f.name}` }) : null);
}

function quote(q, opts) {
  const who = q.userId === opts.me ? 'You' : opts.nameOf(q.userId);
  const text = q.deleted ? 'This message was deleted.' : String(q.body || '').replace(/\s+/g, ' ');
  return el('div', { class: `chat-quote${q.deleted ? ' deleted' : ''}` },
    el('span', { class: 'sr-only' }, 'Replying to '),
    el('span', { class: 'chat-quote-who', dir: 'auto' }, who),
    el('span', { class: 'sr-only' }, ': '),
    el('span', { class: 'chat-quote-text', dir: 'auto' }, text));
}

/**
 * `opts`: { me, nameOf(userId), apiBase, onRetry(m), onDiscard(m) }. `m.pending` is true for a
 * message kept on this device (the offline queue), or 'sending' / 'failed' for one sent from here.
 */
export function messageNode(m, opts) {
  const deleted = !!m.deletedAt;
  const mine = m.userId === opts.me;
  const hasText = !deleted && String(m.body || '').trim().length > 0;
  const edited = !!m.editedAt && !deleted;
  const files = deleted ? [] : m.attachments || [];
  const pendingFiles = deleted ? [] : m.pendingFiles || [];
  const state = m.pending === true ? 'saved on this device, not sent yet' : m.pending === 'sending' ? 'sending…' : null;
  return el('div', { class: `msg${mine ? ' mine' : ''}${m.pending === 'failed' ? ' failed' : ''}`, dataset: { messageId: m.id } },
    el('div', { class: 'mh' },
      el('span', { class: 'author', dir: 'auto' }, mine ? 'You' : opts.nameOf(m.userId)),
      el('time', { class: 'time', datetime: m.createdAt, title: fullTime(m.createdAt) }, messageTime(m.createdAt)),
      edited ? el('span', { class: 'time' }, '(edited)') : null,
      state ? el('span', { class: 'time' }, `· ${state}`) : null),
    !deleted && m.replyTo ? quote(m.replyTo, opts) : null,
    deleted ? el('div', { class: 'txt deleted' }, 'This message was deleted.') : hasText ? el('div', { class: 'txt', dir: 'auto' }, m.body) : null,
    files.length || pendingFiles.length
      ? el('div', { class: 'chat-files' }, files.map((a) => fileNode(a, opts)), pendingFiles.map((f) => pendingFileNode(f, m)))
      : null,
    !deleted && m.reactions && m.reactions.length
      ? el('ul', { class: 'chat-reactions', 'aria-label': 'Reactions' }, m.reactions.map((r) => {
        const label = reactionLabel(r, opts);
        return el('li', { class: 'chat-reaction' + (r.userIds.includes(opts.me) ? ' mine' : '') },
          el('span', { role: 'img', 'aria-label': label, title: label.slice(label.indexOf(':') + 2) }, `${r.emoji} ${r.userIds.length}`));
      }))
      : null,
    m.pending === 'failed'
      ? el('div', { class: 'chat-failed' },
        el('span', { class: 'error', dir: 'auto' }, `Not sent${m.error ? ` — ${m.error}` : ''}`),
        el('button', { class: 'btn sm', type: 'button', onClick: () => opts.onRetry(m) }, 'Retry'),
        el('button', { class: 'btn sm ghost', type: 'button', onClick: () => opts.onDiscard(m) }, 'Discard'))
      : null,
  );
}
