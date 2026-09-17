import { useState } from 'react';
import {
  BUILT_IN_VIEWS,
  loadCustomViews,
  saveView,
  deleteView,
  filtersEqual,
  hasActiveFilters,
  type SavedView,
  type TaskFilters,
} from '../lib/savedViews';

export interface SavedViewsBarProps {
  current: TaskFilters;
  onApply: (filters: TaskFilters) => void;
}

/** Saved filter presets for My Tasks — built-in views plus the user's own (persisted locally). */
export function SavedViewsBar({ current, onApply }: SavedViewsBarProps) {
  const [custom, setCustom] = useState<SavedView[]>(() => loadCustomViews());
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const views = [...BUILT_IN_VIEWS, ...custom];
  const activeId = views.find((v) => filtersEqual(current, v.filters))?.id;
  const canSave = hasActiveFilters(current);

  function commitSave() {
    const n = name.trim();
    if (!n) return;
    setCustom(saveView(n, current));
    setName('');
    setSaving(false);
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Views</span>
      {views.map((v) => {
        const active = v.id === activeId;
        return (
          <span key={v.id} className={`inline-flex items-center rounded-full border text-xs font-medium transition-colors ${active ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30 hover:text-ink'}`}>
            <button onClick={() => onApply(v.filters)} className="py-1 pl-2.5 pr-1.5">
              {v.builtIn ? <span aria-hidden className="mr-1">★</span> : null}
              {v.name}
            </button>
            {!v.builtIn ? (
              <button
                onClick={() => setCustom(deleteView(v.id))}
                aria-label={`Delete view ${v.name}`}
                className="pr-2 text-ink-3 transition-colors hover:text-danger"
              >
                ×
              </button>
            ) : null}
          </span>
        );
      })}

      {saving ? (
        <form
          onSubmit={(e) => { e.preventDefault(); commitSave(); }}
          className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-surface px-1.5 py-0.5"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this view…"
            className="w-32 rounded-full bg-transparent px-1.5 py-0.5 text-xs text-ink outline-none"
          />
          <button type="submit" disabled={name.trim() === ''} className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-50">Save</button>
          <button type="button" onClick={() => { setSaving(false); setName(''); }} aria-label="Cancel" className="px-1 text-ink-3 hover:text-ink">×</button>
        </form>
      ) : canSave ? (
        <button
          onClick={() => setSaving(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand"
        >
          <span aria-hidden>＋</span> Save view
        </button>
      ) : null}
    </div>
  );
}
