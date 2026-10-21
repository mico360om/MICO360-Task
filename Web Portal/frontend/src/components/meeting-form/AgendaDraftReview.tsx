import { useState } from 'react';
import type { AiAgendaItem } from '../../api/ai';
import { Button } from '../ui/Button';

/** The AI's drafted agenda, to tick through before anything is added (all ticked to start with). */
export function AgendaDraftReview({
  items,
  leadName,
  onAdd,
  onDismiss,
  busy = false,
}: {
  items: AiAgendaItem[];
  leadName: (id: string | null) => string | null;
  onAdd: (chosen: AiAgendaItem[]) => void;
  onDismiss: () => void;
  busy?: boolean;
}) {
  const [ticked, setTicked] = useState(() => items.map(() => true));
  return (
    <div role="group" aria-label="Drafted agenda" className="rounded-xl border border-brand/20 bg-brand/[0.04] p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-2">Drafted agenda</p>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => {
          const lead = leadName(item.ownerId);
          return (
            <li key={`${i}-${item.title}`}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 hover:bg-ground">
                <input
                  type="checkbox"
                  checked={ticked[i]}
                  aria-label={`${item.title} — ${lead ?? 'no lead'}, ${item.minutes} min`}
                  onChange={() => setTicked((t) => t.map((x, j) => (j === i ? !x : x)))}
                  className="mt-0.5 h-4 w-4 flex-none accent-brand"
                />
                <span className="min-w-0 text-sm">
                  <bdi className="break-words font-medium text-ink">{item.title}</bdi>
                  <span className="block text-xs text-ink-2">
                    {lead ? <bdi>{lead}</bdi> : 'No lead'} · {item.minutes} min
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-2.5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onDismiss} className="min-h-[36px] rounded-lg px-3 text-sm font-semibold text-ink-2 hover:bg-ground">Dismiss</button>
        <Button type="button" size="sm" loading={busy} disabled={!ticked.some(Boolean)} onClick={() => onAdd(items.filter((_, i) => ticked[i]))} className="min-h-[36px]">
          Add selected
        </Button>
      </div>
    </div>
  );
}
