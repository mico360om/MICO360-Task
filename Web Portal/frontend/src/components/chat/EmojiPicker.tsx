import { useMemo, useState } from 'react';
import { EMOJI_GROUPS, QUICK_REACTIONS, searchEmoji } from '../../lib/emoji';
import { Popover } from './Popover';

/** A searchable grid of emoji; picking one calls `onPick` (the popover stays the caller's to close). */
export function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  const [q, setQ] = useState('');
  const found = useMemo(() => searchEmoji(q), [q]);
  return (
    <div className="w-[17.5rem] max-w-[calc(100vw-2rem)]">
      <div className="border-b border-line p-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search emoji"
          placeholder="Search emoji"
          className="w-full rounded-lg border border-line bg-ground px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>
      <div className="max-h-56 overflow-y-auto p-1.5">
        {found.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-ink-2">No emoji match “{q.trim()}”.</p>
        ) : (
          EMOJI_GROUPS.map((group) => {
            const list = found.filter((e) => e.group === group);
            if (list.length === 0) return null;
            return (
              <div key={group}>
                <p className="px-1.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">{group}</p>
                <div className="grid grid-cols-8">
                  {list.map((e) => (
                    <button
                      key={e.char}
                      type="button"
                      onClick={() => onPick(e.char)}
                      aria-label={`${e.char} ${e.words.split(' ')[0]}`}
                      title={e.words.split(' ').slice(0, 2).join(' ')}
                      className="grid h-8 w-8 place-items-center rounded-lg text-lg transition-colors hover:bg-ground focus-visible:bg-ground"
                    >
                      {e.char}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** The emoji picker for the message box. */
export function EmojiPopover({ anchor, onPick, onClose }: { anchor: HTMLElement | null; onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} label="Emoji" align="end">
      <EmojiGrid onPick={onPick} />
    </Popover>
  );
}

/** Quick reactions, with the full picker one click away. */
export function ReactionPopover({ anchor, onPick, onClose }: { anchor: HTMLElement | null; onPick: (emoji: string) => void; onClose: () => void }) {
  const [more, setMore] = useState(false);
  const pick = (emoji: string) => {
    onClose();
    onPick(emoji);
  };
  return (
    <Popover anchor={anchor} onClose={onClose} label="Add a reaction" initialFocus="button">
      <div className="flex items-center gap-0.5 p-1.5">
        {QUICK_REACTIONS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => pick(e)}
            aria-label={`React with ${e}`}
            className="grid h-9 w-9 place-items-center rounded-full text-xl transition-transform hover:scale-110 hover:bg-ground focus-visible:bg-ground"
          >
            {e}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          aria-label="More emoji"
          className="ms-0.5 grid h-9 w-9 place-items-center rounded-full border border-line text-sm font-semibold text-ink-2 hover:border-brand hover:text-brand"
        >
          +
        </button>
      </div>
      {more ? <div className="border-t border-line"><EmojiGrid onPick={pick} /></div> : null}
    </Popover>
  );
}
