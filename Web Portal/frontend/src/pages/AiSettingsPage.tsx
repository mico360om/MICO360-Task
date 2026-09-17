import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { FieldLabel, FieldError, fieldClass } from '../components/ui/Field';
import { apiClient } from '../api/client';
import { ApiError } from '../lib/api-client';
import {
  aiApi,
  AI_CAPABILITIES,
  PROVIDER_KINDS,
  CAPABILITY_LABELS,
  type AiConfig,
  type AiCapability,
  type AiModel,
  type ProviderKind,
  type RedactedProvider,
} from '../api/ai';

const QK = ['ai-config'] as const;

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export function AiSettingsPage() {
  const api = aiApi(apiClient);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QK, queryFn: () => api.getConfig() });
  const apply = (data: AiConfig) => qc.setQueryData(QK, data);
  const config = q.data;

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="AI Management"
        subtitle="Configure AI providers, models and defaults. Changes apply immediately — no restart. Every change is recorded in the audit log."
      />

      {q.isLoading ? (
        <p className="text-ink-2">Loading…</p>
      ) : q.isError ? (
        <p role="alert" className="card p-5 text-danger">
          Couldn’t load AI settings (admin only).
        </p>
      ) : config ? (
        <div className="flex flex-col gap-8">
          <ProvidersSection config={config} apply={apply} api={api} />
          <ModelsSection config={config} apply={apply} api={api} />
          <DefaultsSection config={config} apply={apply} api={api} />
        </div>
      ) : null}
    </div>
  );
}

type Api = ReturnType<typeof aiApi>;
interface SectionProps {
  config: AiConfig;
  apply: (c: AiConfig) => void;
  api: Api;
}

// ── Providers ────────────────────────────────────────────────────────────────
function ProvidersSection({ config, apply, api }: SectionProps) {
  return (
    <section aria-labelledby="ai-providers-h">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ai-providers-h" className="font-display text-lg font-bold text-ink">
            Providers &amp; API access
          </h2>
          <p className="text-sm text-ink-2">The services that supply models. API keys are stored securely and never shown again.</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {config.providers.map((p) => (
          <ProviderCard key={p.id} provider={p} apply={apply} api={api} />
        ))}
        {config.providers.length === 0 ? (
          <p className="text-sm text-ink-3">No providers yet — add one below.</p>
        ) : null}
      </div>

      <AddProviderForm apply={apply} api={api} />
    </section>
  );
}

function KindBadge({ kind }: { kind: ProviderKind }) {
  return (
    <span className="rounded-md bg-ground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-2">{kind}</span>
  );
}

function ProviderCard({ provider: p, apply, api }: { provider: RedactedProvider } & Omit<SectionProps, 'config'>) {
  const [sync, setSync] = useState<{ msg: string; error?: boolean } | null>(null);
  const [editKey, setEditKey] = useState(false);
  const [key, setKey] = useState('');

  const mToggle = useMutation({ mutationFn: (enabled: boolean) => api.updateProvider(p.id, { enabled }), onSuccess: apply });
  const mSaveKey = useMutation({
    mutationFn: (apiKey: string) => api.updateProvider(p.id, { apiKey }),
    onSuccess: (c) => { apply(c); setEditKey(false); setKey(''); },
  });
  const mRemove = useMutation({ mutationFn: () => api.removeProvider(p.id), onSuccess: apply });
  const mSync = useMutation({
    mutationFn: () => api.syncProvider(p.id),
    onSuccess: (res) => { apply(res.config); setSync({ msg: `Detected ${res.detected} · ${res.added} added` }); },
    onError: (e) => setSync({ msg: errMsg(e), error: true }),
  });

  return (
    <div data-provider={p.id} className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-ink">{p.name}</span>
            <KindBadge kind={p.kind} />
            {!p.enabled ? (
              <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger">Disabled</span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-ink-2">{p.apiBaseUrl}</p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-ink-2">
          <input
            type="checkbox"
            className="accent-brand"
            checked={p.enabled}
            aria-label={`${p.enabled ? 'Disable' : 'Enable'} provider ${p.name}`}
            onChange={(e) => mToggle.mutate(e.target.checked)}
          />
          Enabled
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span className="text-ink-3">API key:</span>
        {p.hasApiKey ? <span className="font-mono">{p.apiKeyHint}</span> : <span className="italic text-ink-3">not set</span>}
        {!editKey ? (
          <button type="button" className="text-brand hover:underline" onClick={() => setEditKey(true)}>
            {p.hasApiKey ? 'Replace' : 'Add key'}
          </button>
        ) : null}
      </div>

      {editKey ? (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={key}
            autoComplete="off"
            aria-label={`API key for ${p.name}`}
            placeholder="Paste new API key"
            onChange={(e) => setKey(e.target.value)}
            className={fieldClass(false, 'min-w-0 flex-1')}
          />
          <Button size="sm" loading={mSaveKey.isPending} disabled={!key.trim()} onClick={() => mSaveKey.mutate(key.trim())}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditKey(false); setKey(''); }}>
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <div aria-live="polite" className={`text-xs ${sync?.error ? 'text-danger' : 'text-ink-2'}`}>
          {mSync.isPending ? 'Syncing…' : sync?.msg}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" loading={mSync.isPending} onClick={() => { setSync(null); mSync.mutate(); }}>
            Sync models
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            loading={mRemove.isPending}
            onClick={() => { if (confirm(`Remove provider “${p.name}” and all its models?`)) mRemove.mutate(); }}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddProviderForm({ apply, api }: Omit<SectionProps, 'config'>) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProviderKind>('openai');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [errors, setErrors] = useState<{ name?: string; url?: string }>({});

  const mAdd = useMutation({
    mutationFn: () => api.addProvider({ name: name.trim(), kind, apiBaseUrl: url.trim(), apiKey: apiKey.trim() || undefined }),
    onSuccess: (c) => { apply(c); setName(''); setUrl(''); setApiKey(''); setKind('openai'); setErrors({}); },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: { name?: string; url?: string } = {};
    if (!name.trim()) next.name = 'Provider name is required.';
    if (!/^https?:\/\//i.test(url.trim())) next.url = 'A valid http(s) URL is required.';
    setErrors(next);
    if (Object.keys(next).length === 0) mAdd.mutate();
  };

  return (
    <form onSubmit={submit} className="card mt-3 flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-ink">Add a provider</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="ap-name" required>Provider name</FieldLabel>
          <input
            id="ap-name"
            value={name}
            required
            aria-required="true"
            aria-invalid={errors.name ? true : undefined}
            onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }}
            placeholder="e.g. OpenAI"
            className={fieldClass(!!errors.name)}
          />
          <FieldError>{errors.name}</FieldError>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="ap-kind" required>Kind</FieldLabel>
          <select id="ap-kind" value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)} className={fieldClass(false)}>
            {PROVIDER_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="ap-url" required>API base URL</FieldLabel>
          <input
            id="ap-url"
            value={url}
            required
            aria-required="true"
            aria-invalid={errors.url ? true : undefined}
            onChange={(e) => { setUrl(e.target.value); if (errors.url) setErrors((x) => ({ ...x, url: undefined })); }}
            placeholder="https://api.openai.com/v1"
            className={fieldClass(!!errors.url)}
          />
          <FieldError>{errors.url}</FieldError>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="ap-key">API key</FieldLabel>
          <input
            id="ap-key"
            type="password"
            value={apiKey}
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Optional — stored securely"
            className={fieldClass(false)}
          />
        </div>
      </div>
      {mAdd.isError ? <FieldError>{errMsg(mAdd.error)}</FieldError> : null}
      <div>
        <Button type="submit" loading={mAdd.isPending}>Add provider</Button>
      </div>
    </form>
  );
}

// ── Models ───────────────────────────────────────────────────────────────────
function ModelsSection({ config, apply, api }: SectionProps) {
  const byProvider = (id: string) => config.models.filter((m) => m.providerId === id);
  const providerName = (id: string) => config.providers.find((p) => p.id === id)?.name ?? 'Unknown';

  return (
    <section aria-labelledby="ai-models-h">
      <div className="mb-3">
        <h2 id="ai-models-h" className="font-display text-lg font-bold text-ink">Models</h2>
        <p className="text-sm text-ink-2">Enable the models people can use. Disabled or unavailable models are hidden from users and APIs.</p>
      </div>

      <div className="flex flex-col gap-4">
        {config.providers.map((p) => {
          const models = byProvider(p.id);
          return (
            <div key={p.id} className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line bg-ground/50 px-4 py-2">
                <span className="text-sm font-semibold text-ink">{p.name}</span>
                <KindBadge kind={p.kind} />
                <span className="text-xs text-ink-3">{models.length} model{models.length === 1 ? '' : 's'}</span>
              </div>
              {models.length === 0 ? (
                <p className="px-4 py-3 text-sm text-ink-3">No models yet — add one below or use “Sync models”.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {models.map((m) => (
                    <ModelRow key={m.id} model={m} apply={apply} api={api} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {config.providers.length === 0 ? (
          <p className="text-sm text-ink-3">Add a provider first to manage its models.</p>
        ) : null}
      </div>

      {config.providers.length > 0 ? <AddModelForm config={config} apply={apply} api={api} providerName={providerName} /> : null}
    </section>
  );
}

function ModelRow({ model: m, apply, api }: { model: AiModel } & Omit<SectionProps, 'config'>) {
  const mEnabled = useMutation({ mutationFn: (enabled: boolean) => api.setModelEnabled(m.id, enabled), onSuccess: apply });
  const mConcurrency = useMutation({ mutationFn: (n: number) => api.updateModel(m.id, { concurrencyLimit: n }), onSuccess: apply });
  const mRemove = useMutation({ mutationFn: () => api.removeModel(m.id), onSuccess: apply });

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-ink">{m.modelKey}</span>
          {!m.available ? (
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning" title="Not offered by the provider at last sync">
              Unavailable
            </span>
          ) : null}
        </div>
        {m.displayName !== m.modelKey ? <p className="truncate text-xs text-ink-3">{m.displayName}</p> : null}
        <div className="mt-1 flex flex-wrap gap-1">
          {m.capabilities.map((c) => (
            <span key={c} className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">{CAPABILITY_LABELS[c]}</span>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-1 text-xs text-ink-2" title="Max concurrent requests">
        <span className="text-ink-3">conc.</span>
        <input
          type="number"
          min={1}
          max={64}
          defaultValue={m.concurrencyLimit}
          aria-label={`Concurrency limit for ${m.modelKey}`}
          onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== m.concurrencyLimit) mConcurrency.mutate(n); }}
          className="w-14 rounded-md border border-line bg-surface px-2 py-1 text-sm tabular-nums text-ink"
        />
      </label>

      <button
        type="button"
        aria-label={`${m.enabled ? 'Disable' : 'Enable'} ${m.modelKey}`}
        aria-pressed={m.enabled}
        disabled={mEnabled.isPending}
        onClick={() => mEnabled.mutate(!m.enabled)}
        className={[
          'relative h-5 w-9 rounded-full transition-colors',
          m.enabled ? 'bg-brand' : 'bg-line',
          mEnabled.isPending ? 'opacity-60' : '',
        ].join(' ')}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${m.enabled ? 'left-4' : 'left-0.5'}`} />
      </button>

      <button
        type="button"
        aria-label={`Remove ${m.modelKey}`}
        onClick={() => { if (confirm(`Remove model “${m.modelKey}”?`)) mRemove.mutate(); }}
        className="rounded px-1.5 text-ink-3 hover:bg-ground hover:text-danger"
      >
        ×
      </button>
    </li>
  );
}

function AddModelForm({ config, apply, api, providerName }: SectionProps & { providerName: (id: string) => string }) {
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

  const toggleCap = (c: AiCapability) =>
    setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: { modelKey?: string; caps?: string } = {};
    if (!modelKey.trim()) next.modelKey = 'Model key is required.';
    if (caps.length === 0) next.caps = 'Select at least one capability.';
    setErrors(next);
    if (Object.keys(next).length === 0) mAdd.mutate();
  };

  return (
    <form onSubmit={submit} className="card mt-3 flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-ink">Add a model</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="am-provider" required>Provider</FieldLabel>
          <select id="am-provider" value={providerId} onChange={(e) => setProviderId(e.target.value)} className={fieldClass(false)}>
            {config.providers.map((p) => (
              <option key={p.id} value={p.id}>{providerName(p.id)}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="am-key" required>Model key</FieldLabel>
          <input
            id="am-key"
            value={modelKey}
            required
            aria-required="true"
            aria-invalid={errors.modelKey ? true : undefined}
            onChange={(e) => { setModelKey(e.target.value); if (errors.modelKey) setErrors((x) => ({ ...x, modelKey: undefined })); }}
            placeholder="e.g. gpt-4o"
            className={fieldClass(!!errors.modelKey)}
          />
          <FieldError>{errors.modelKey}</FieldError>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="am-display">Display name</FieldLabel>
          <input
            id="am-display"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Optional"
            className={fieldClass(false)}
          />
        </div>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-ink">Capabilities<span aria-hidden="true" className="ml-0.5 font-semibold text-danger">*</span></legend>
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
  );
}

// ── Defaults ─────────────────────────────────────────────────────────────────
function DefaultsSection({ config, apply, api }: SectionProps) {
  const mSetDefault = useMutation({
    mutationFn: ({ cap, modelId }: { cap: AiCapability; modelId: string | null }) => api.setDefault(cap, modelId),
    onSuccess: apply,
  });

  return (
    <section aria-labelledby="ai-defaults-h">
      <div className="mb-3">
        <h2 id="ai-defaults-h" className="font-display text-lg font-bold text-ink">Default models</h2>
        <p className="text-sm text-ink-2">The model used for each capability unless a request asks for another. Only enabled models can be a default.</p>
      </div>

      <div className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {AI_CAPABILITIES.map((cap) => {
          const options = config.models.filter((m) => m.enabled && m.capabilities.includes(cap));
          const value = config.defaults[cap] ?? '';
          const inputId = `ai-default-${cap}`;
          return (
            <div key={cap} className="flex flex-col gap-1">
              <FieldLabel htmlFor={inputId}>{CAPABILITY_LABELS[cap]}</FieldLabel>
              <select
                id={inputId}
                aria-label={`Default ${CAPABILITY_LABELS[cap]} model`}
                value={value}
                disabled={options.length === 0 || mSetDefault.isPending}
                onChange={(e) => mSetDefault.mutate({ cap, modelId: e.target.value || null })}
                className={fieldClass(false)}
              >
                <option value="">{options.length === 0 ? 'No enabled models' : 'None'}</option>
                {options.map((m) => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {mSetDefault.isError ? <FieldError>{errMsg(mSetDefault.error)}</FieldError> : null}
    </section>
  );
}
