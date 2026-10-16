import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { FieldLabel, FieldError, fieldClass } from '../ui/Field';
import { AI_CAPABILITIES, CAPABILITY_LABELS, type AiCapability, type AiModel, type ModelTestResult, type RedactedProvider } from '../../api/ai';
import { ProviderBadge, Switch, errMsg, failed, inUseFor, plural, type SectionProps } from './shared';

/** The models each provider offers: switch on the ones people can use, test them, add one by name. */
export function ModelsSection({ config, apply, api }: SectionProps) {
  return (
    <section aria-labelledby="ai-models-h">
      <div className="mb-3">
        <h2 id="ai-models-h" className="font-display text-lg font-bold text-ink">Models</h2>
        <p className="text-sm text-ink-2">
          Switch on the models people can use. Switched-off and unavailable models are hidden from users and the API.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {config.providers.map((p) => (
          <ProviderModels key={p.id} provider={p} config={config} apply={apply} api={api} />
        ))}
        {config.providers.length === 0 ? <p className="text-sm text-ink-3">Connect a provider first: its models appear here.</p> : null}
      </div>

      {config.providers.length > 0 ? <AddModelByName config={config} apply={apply} api={api} /> : null}
    </section>
  );
}

type Filter = 'all' | 'on' | AiCapability;
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'on', label: 'On' },
  { id: 'chat', label: 'Chat' },
  { id: 'vision', label: 'Vision' },
  { id: 'embedding', label: 'Embeddings' },
];

/**
 * One provider's models. Switched-on and recommended models come first; the rest fold away until
 * asked for, or until a search or filter looks for them.
 */
function ProviderModels({ provider: p, config, apply, api }: { provider: RedactedProvider } & SectionProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState(false);

  const rec = p.recommendedModelId ?? null;
  const inUse = inUseFor(config, 'chat');
  const models = config.models.filter((m) => m.providerId === p.id);
  const sorted = [...models].sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) ||
      Number(b.id === rec) - Number(a.id === rec) ||
      Number(b.available) - Number(a.available) ||
      a.displayName.localeCompare(b.displayName),
  );
  const term = query.trim().toLowerCase();
  const matching = sorted.filter(
    (m) =>
      (!term || m.displayName.toLowerCase().includes(term) || m.modelKey.toLowerCase().includes(term)) &&
      (filter === 'all' || (filter === 'on' ? m.enabled : m.capabilities.includes(filter))),
  );
  const browsing = !term && filter === 'all';
  const featured = matching.filter((m) => m.enabled || m.id === rec);
  const shown = browsing && !expanded ? (featured.length > 0 ? featured : matching.slice(0, 5)) : matching;
  const folded = matching.length - shown.length;
  const on = models.filter((m) => m.enabled).length;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-ground/50 px-4 py-2">
        <span className="text-sm font-semibold text-ink">{p.name}</span>
        <ProviderBadge provider={p} />
        <span className="text-xs text-ink-3">
          {on} on · {plural(models.length, 'model')}
        </span>
      </div>

      {models.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`Search ${p.name} models`}
            placeholder="Search models"
            className={fieldClass(false, 'min-w-0 flex-1 basis-48 py-1.5')}
          />
          <div role="group" aria-label={`Show ${p.name} models`} className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`min-h-[2rem] rounded-lg px-2.5 text-xs font-semibold transition-colors ${filter === f.id ? 'bg-brand text-white' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {models.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-3">
          {p.lastSyncError ? 'No models could be loaded.' : 'No models yet.'} Refresh the provider, or add one by name below.
        </p>
      ) : matching.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-3">No models match.</p>
      ) : (
        <ul aria-label={`${p.name} models`} className="divide-y divide-line">
          {shown.map((m) => (
            <ModelRow key={m.id} model={m} recommended={m.id === rec} inUse={m.id === inUse} apply={apply} api={api} />
          ))}
        </ul>
      )}

      {browsing && (folded > 0 || expanded) ? (
        <div className="border-t border-line px-4 py-2">
          <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={() => setExpanded((x) => !x)}>
            {expanded ? 'Show fewer' : `Show ${plural(folded, 'more model')}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The most requests a model may run at once (the server's limit). */
const CONCURRENCY_MAX = 64;

function ModelRow({
  model: m,
  recommended,
  inUse,
  apply,
  api,
}: { model: AiModel; recommended: boolean; inUse: boolean } & Omit<SectionProps, 'config'>) {
  const [problem, setProblem] = useState<string | null>(null);
  const [test, setTest] = useState<ModelTestResult | null>(null);
  const clear = () => setProblem(null);
  const mEnabled = useMutation({
    mutationFn: (enabled: boolean) => api.setModelEnabled(m.id, enabled),
    onMutate: clear,
    onSuccess: apply,
    onError: (e) => setProblem(failed('Couldn’t save that change.', e)),
  });
  const mConcurrency = useMutation({
    mutationFn: (n: number) => api.updateModel(m.id, { concurrencyLimit: n }),
    onMutate: clear,
    onSuccess: apply,
    onError: (e) => setProblem(failed('Couldn’t save the concurrency limit.', e)),
  });
  const mRemove = useMutation({
    mutationFn: () => api.removeModel(m.id),
    onMutate: clear,
    onSuccess: apply,
    onError: (e) => setProblem(failed(`Couldn’t remove “${m.displayName}”.`, e)),
  });
  const mTest = useMutation({
    mutationFn: () => api.testModel(m.id),
    onMutate: () => setTest(null),
    onSuccess: setTest,
    onError: (e) => setTest({ ok: false, message: errMsg(e) }),
  });

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-1.5">
          <span data-model-name className="font-medium text-ink">{m.displayName}</span>
          {recommended ? <span className="rounded bg-success-soft px-1.5 py-0.5 text-[11px] font-semibold text-success">Recommended</span> : null}
          {inUse ? <span className="rounded bg-brand px-1.5 py-0.5 text-[11px] font-semibold text-white">In use for chat</span> : null}
          {!m.available ? (
            <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase text-warning" title="The provider no longer offers it">
              Unavailable
            </span>
          ) : null}
        </div>
        {m.displayName !== m.modelKey ? <p className="truncate font-mono text-xs text-ink-3">{m.modelKey}</p> : null}
        <div className="mt-1 flex flex-wrap gap-1">
          {m.capabilities.map((c) => (
            <span key={c} className="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">{CAPABILITY_LABELS[c]}</span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {m.capabilities.includes('chat') ? (
          <Button size="sm" variant="secondary" aria-label={`Test ${m.displayName}`} loading={mTest.isPending} onClick={() => mTest.mutate()}>
            Test
          </Button>
        ) : null}

        <label className="flex items-center gap-1 text-xs text-ink-2" title="The most requests this model runs at once">
          <span className="text-ink-3">At once</span>
          <input
            type="number"
            min={1}
            max={CONCURRENCY_MAX}
            defaultValue={m.concurrencyLimit}
            aria-label={`Concurrency limit for ${m.displayName}`}
            onBlur={(e) => {
              // The box shows what will really be stored: a whole number from 1 to 64.
              const typed = Number(e.target.value);
              const n = Number.isFinite(typed) && e.target.value !== '' ? Math.min(CONCURRENCY_MAX, Math.max(1, Math.round(typed))) : m.concurrencyLimit;
              e.target.value = String(n);
              if (n !== m.concurrencyLimit) mConcurrency.mutate(n);
            }}
            className="w-14 rounded-md border border-line bg-surface px-2 py-1 text-sm tabular-nums text-ink"
          />
        </label>

        <Switch on={m.enabled} label={`Use ${m.displayName}`} disabled={mEnabled.isPending} onChange={(v) => mEnabled.mutate(v)} />

        <button
          type="button"
          aria-label={`Remove ${m.displayName}`}
          onClick={() => { if (confirm(`Remove model “${m.displayName}”?`)) mRemove.mutate(); }}
          className="rounded px-1.5 text-lg leading-none text-ink-3 hover:bg-ground hover:text-danger"
        >
          ×
        </button>
      </div>

      <div aria-live="polite" className="basis-full empty:hidden">
        {mTest.isPending ? <p className="text-xs text-ink-3">Asking the model…</p> : null}
        {test?.ok ? <p className="text-xs font-medium text-success">Works · answered in {(test.ms / 1000).toFixed(1)} s</p> : null}
        {test && !test.ok ? (
          <p className="text-xs text-danger">
            <span className="font-semibold">Didn’t work: </span>
            <span>{test.message}</span>
          </p>
        ) : null}
      </div>
      {problem ? <p role="alert" className="basis-full text-xs font-medium text-danger">{problem}</p> : null}
    </li>
  );
}

/** For a model the provider doesn't list (rare): type its name. */
function AddModelByName({ config, apply, api }: SectionProps) {
  const [providerId, setProviderId] = useState(config.providers[0]?.id ?? '');
  const [modelKey, setModelKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [caps, setCaps] = useState<AiCapability[]>(['chat']);
  const [errors, setErrors] = useState<{ modelKey?: string; caps?: string }>({});

  const mAdd = useMutation({
    mutationFn: () =>
      api.addModel({ providerId, modelKey: modelKey.trim(), displayName: displayName.trim() || undefined, capabilities: caps }),
    onSuccess: (c) => { apply(c); setModelKey(''); setDisplayName(''); setCaps(['chat']); setErrors({}); },
  });

  const toggleCap = (c: AiCapability) => setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: { modelKey?: string; caps?: string } = {};
    if (!modelKey.trim()) next.modelKey = 'Model name is required.';
    if (caps.length === 0) next.caps = 'Select at least one capability.';
    setErrors(next);
    if (Object.keys(next).length === 0) mAdd.mutate();
  };

  return (
    <details className="card group mt-3">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-ink">Add a model by name</summary>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3 border-t border-line p-4">
        <p className="text-sm text-ink-2">Only needed for a model the provider doesn’t list. Use the exact name the provider gives it.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="am-provider" required>Provider</FieldLabel>
            <select id="am-provider" value={providerId} onChange={(e) => setProviderId(e.target.value)} className={fieldClass(false)}>
              {config.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="am-key" required>Model name</FieldLabel>
            <input
              id="am-key"
              value={modelKey}
              aria-required="true"
              aria-invalid={errors.modelKey ? true : undefined}
              onChange={(e) => { setModelKey(e.target.value); if (errors.modelKey) setErrors((x) => ({ ...x, modelKey: undefined })); }}
              placeholder="e.g. gpt-4o-mini"
              className={fieldClass(!!errors.modelKey)}
            />
            <FieldError>{errors.modelKey}</FieldError>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="am-display">Display name</FieldLabel>
            <input id="am-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Optional" className={fieldClass(false)} />
          </div>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-ink">
            Capabilities<span aria-hidden="true" className="ml-0.5 font-semibold text-danger">*</span>
          </legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {AI_CAPABILITIES.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm text-ink-2">
                <input type="checkbox" className="accent-brand" checked={caps.includes(c)} onChange={() => toggleCap(c)} aria-label={CAPABILITY_LABELS[c]} />
                {CAPABILITY_LABELS[c]}
              </label>
            ))}
          </div>
          <FieldError>{errors.caps}</FieldError>
        </fieldset>
        {mAdd.isError ? <FieldError>{errMsg(mAdd.error)}</FieldError> : null}
        <div>
          <Button type="submit" loading={mAdd.isPending}>Add model</Button>
        </div>
      </form>
    </details>
  );
}
