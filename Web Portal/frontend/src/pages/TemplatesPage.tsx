import { useRef, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { TEMPLATE_TABS } from '../components/templates/template-tabs';

/**
 * Templates (Workspace): company-wide starting points everyone can use — a tab per kind (the list
 * is TEMPLATE_TABS). The open tab is in the address (?tab=tasks), so a link can open it.
 */
export function TemplatesPage() {
  const [params, setParams] = useSearchParams();
  const tabs = TEMPLATE_TABS;
  const current = tabs.find((t) => t.key === params.get('tab')) ?? tabs[0]!;
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const show = (key: string, focus = false) => {
    setParams(key === tabs[0]!.key ? {} : { tab: key }, { replace: true });
    if (focus) buttons.current.get(key)?.focus();
  };

  // Arrow keys, Home and End move along the tabs (the open one is the only Tab stop).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = tabs.findIndex((t) => t.key === current.key);
    const go = (i: number) => {
      e.preventDefault();
      show(tabs[(i + tabs.length) % tabs.length]!.key, true);
    };
    if (e.key === 'ArrowRight') go(at + 1);
    else if (e.key === 'ArrowLeft') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(tabs.length - 1);
  }

  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Templates" subtitle="Start projects and tasks the same way every time" />
      <div role="tablist" aria-label="Templates" onKeyDown={onKeyDown} className="-mb-px flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => {
          const selected = t.key === current.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                if (el) buttons.current.set(t.key, el);
                else buttons.current.delete(t.key);
              }}
              type="button"
              role="tab"
              id={`templates-tab-${t.key}`}
              aria-controls={`templates-panel-${t.key}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => show(t.key)}
              className={`!min-h-[44px] flex-none border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${selected ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div key={current.key} role="tabpanel" id={`templates-panel-${current.key}`} aria-labelledby={`templates-tab-${current.key}`} className="mt-4">
        {current.element}
      </div>
    </div>
  );
}
