import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MentionPerson } from '../../lib/mentions';
import { useMentionAutocomplete } from '../../hooks/useMentionAutocomplete';
import { MentionList } from '../Mentions';
import { MAX_MESSAGE_LENGTH, loadDraft, saveDraft } from '../../lib/chat-model';
import { COUNTER_FROM } from './MessageItem';
import { EmojiPopover } from './EmojiPicker';
import { CloseIcon, PaperclipIcon, ReplyIcon, SendIcon, SmileIcon } from './icons';

/** Tallest the message box grows before it scrolls (matches its `max-h-40`). */
const MAX_HEIGHT_PX = 160;

/** Phones and tablets: Enter makes a new line (there is no Shift key to hold); the Send button sends. */
function touchFirst(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

export interface ComposerProps {
  conversationId: string;
  placeholder: string;
  people: MentionPerson[];
  replyTo: { authorName: string; body: string } | null;
  onCancelReply: () => void;
  /** Send this text; false keeps it in the box (e.g. too long). */
  onSend: (body: string) => boolean;
  /** Send these files, the text going with the first; false keeps the text. */
  onFiles: (files: File[], caption: string) => boolean;
  /** Text put back into this box (an unsent message to change), counted so the same text can come twice. */
  restore: { text: string; n: number } | null;
}

/**
 * The message box. It grows with what you type, keeps an unsent draft for each conversation (also
 * across visits), and sends with Enter on a computer — Shift+Enter starts a new line.
 */
export function Composer({ conversationId, placeholder, people, replyTo, onCancelReply, onSend, onFiles, restore }: ComposerProps) {
  const [draft, setDraftState] = useState(() => loadDraft(conversationId));
  const setDraft = (text: string) => {
    setDraftState(text);
    saveDraft(conversationId, text);
  };
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLButtonElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const mentions = useMentionAutocomplete({ people, value: draft, onChange: setDraft, inputRef: boxRef });

  // The box grows with the draft (up to a limit, then it scrolls) and shrinks back once sent.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [draft]);

  // Answering someone: the cursor goes to the box.
  useEffect(() => {
    if (replyTo) boxRef.current?.focus();
  }, [replyTo]);

  // Only when something new is handed back (a box opened later doesn't take an old hand-back again).
  const restored = useRef(restore?.n ?? 0);
  useEffect(() => {
    if (!restore || restore.n === restored.current) return;
    restored.current = restore.n;
    setDraft(restore.text);
    boxRef.current?.focus();
  }, [restore?.n]);

  const length = draft.trim().length;
  const overLimit = length > MAX_MESSAGE_LENGTH;
  const canSend = length > 0 && !overLimit;

  function send() {
    if (!canSend) return;
    if (onSend(draft)) {
      setDraft('');
      mentions.close();
    }
  }

  function sendFiles(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (onFiles(files, draft.trim())) setDraft('');
  }

  function insertEmoji(emoji: string) {
    const box = boxRef.current;
    const start = box?.selectionStart ?? draft.length;
    const end = box?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // While @mention suggestions are open, Enter picks one instead and never gets here.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !touchFirst()) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && replyTo) {
      onCancelReply();
    }
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); send(); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); sendFiles(e.dataTransfer.files); } }}
      aria-label="Send a message"
      className={`relative flex-none border-t border-line bg-surface px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 ${dragging ? 'ring-2 ring-inset ring-brand/40' : ''}`}
    >
      {replyTo ? (
        <div className="mb-2 flex items-start gap-2 rounded-xl border-s-[3px] border-brand/70 bg-ground px-3 py-1.5">
          <span className="mt-0.5 text-brand"><ReplyIcon size={15} /></span>
          <div className="min-w-0 flex-1">
            <p dir="auto" className="truncate text-xs font-semibold text-ink">{`Replying to ${replyTo.authorName}`}</p>
            <p dir="auto" className="truncate text-xs text-ink-2">{replyTo.body || 'A file'}</p>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="grid h-7 w-7 flex-none place-items-center rounded-lg text-ink-2 hover:bg-surface hover:text-ink">
            <CloseIcon size={15} />
          </button>
        </div>
      ) : null}
      <MentionList mentions={mentions} placement="above" className="ms-12" />
      <div className="flex items-end gap-1.5">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { sendFiles(e.target.files); e.target.value = ''; }} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Attach files (up to 10 MB each)"
          aria-label="Attach files"
          className="grid h-10 w-10 flex-none place-items-center rounded-xl text-ink-2 transition-colors hover:bg-ground hover:text-brand"
        >
          <PaperclipIcon size={19} />
        </button>
        <div className={`flex min-w-0 flex-1 items-end rounded-2xl border bg-ground transition-colors focus-within:bg-surface focus-within:ring-2 ${overLimit ? 'border-danger focus-within:ring-danger/20' : 'border-line focus-within:border-brand focus-within:ring-brand/20'}`}>
          <textarea
            ref={boxRef}
            value={draft}
            {...mentions.inputProps}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length) { e.preventDefault(); sendFiles(files); }
            }}
            rows={1}
            dir="auto"
            aria-label="Message"
            aria-invalid={overLimit || undefined}
            aria-describedby={length > COUNTER_FROM ? 'chat-draft-count' : undefined}
            placeholder={placeholder}
            enterKeyHint="send"
            className="max-h-40 min-h-[42px] min-w-0 flex-1 resize-none bg-transparent px-3.5 py-2.5 text-[0.9375rem] leading-snug text-ink outline-none placeholder:text-ink-2"
          />
          <button
            ref={emojiRef}
            type="button"
            onClick={() => setEmojiOpen((o) => !o)}
            aria-label="Insert emoji"
            aria-expanded={emojiOpen}
            title="Insert emoji"
            className="mb-1 me-1 grid h-8 w-8 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface hover:text-brand"
          >
            <SmileIcon size={19} />
          </button>
        </div>
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          title="Send (Enter)"
          className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-brand-gradient text-white shadow-brand transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none"
        >
          <SendIcon size={18} />
        </button>
      </div>
      {/* The keyboard hint is for computers; on a phone the row only appears for the length counter. */}
      <div className={`${length > COUNTER_FROM ? 'flex' : 'hidden sm:flex'} min-h-[1rem] items-center justify-between gap-2 px-12 pt-0.5 text-[11px] text-ink-2`}>
        <span className="hidden truncate sm:inline">Enter to send · Shift+Enter for a new line · @ to mention</span>
        {length > COUNTER_FROM ? (
          <span id="chat-draft-count" aria-live="polite" className={`ms-auto tabular-nums ${overLimit ? 'font-semibold text-danger' : ''}`}>
            {length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
            {overLimit ? ' — shorten your message to send it' : ''}
          </span>
        ) : null}
      </div>
      {emojiOpen ? (
        <EmojiPopover
          anchor={emojiRef.current}
          onPick={(e) => { insertEmoji(e); setEmojiOpen(false); }}
          onClose={() => setEmojiOpen(false)}
        />
      ) : null}
    </form>
  );
}
