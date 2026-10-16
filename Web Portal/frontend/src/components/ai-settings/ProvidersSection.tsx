import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { FieldLabel, FieldError, fieldClass } from '../ui/Field';
import { relativeTime } from '../../lib/relative-time';
import { PROVIDER_PRESETS, type AiConfig, type ProviderPreset, type RedactedProvider } from '../../api/ai';
import { AI_CONFIG_KEY, ProviderBadge, errMsg, failed, plural, type SectionProps } from './shared';

/** The services that supply models: one card each, then the form that connects another. */
export function ProvidersSection({ config, apply, api }: SectionProps) {
  return (
    <section aria-labelledby="ai-providers-h">
      <div className="mb-3">
        <h2 id="ai-providers-h" className="font-display text-lg font-bold text-ink">
          Providers &amp; API access
        </h2>
        <p className="text-sm text-ink-2">
          The services that supply models. Each one’s models load by themselves and are checked again every day. API keys are stored
          encrypted and never shown again.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {config.providers.map((p) => (
          <ProviderCard key={p.id} provider={p} apply={apply} api={api} />
        ))}
        {config.providers.length === 0 ? <p className="text-sm text-ink-3">No providers yet. Connect one below.</p> : null}
      </div>

      <ConnectProviderForm config={config} apply={apply} api={api} />
    </section>
  );
}

function ProviderCard({ provider: p, apply, api }: { provider: RedactedProvider } & Omit<SectionProps, 'config'>) {
  const qc = useQueryClient();
  const [sync, setSync] = useState<{ msg: string; error?: boolean } | null>(null);
  const [editKey, setEditKey] = useState(false);
  const [key, setKey] = useState('');

  // A change that fails must say so — a switch that silently springs back looks like it worked.
  const [problem, setProblem] = useState<string | null>(null);
  const clear = () => setProblem(null);
  const mToggle = useMutation({
    mutationFn: (enabled: boolean) => api.updateProvider(p.id, { enabled }),
    onMutate: clear,
    onSuccess: apply,
    onError: (e) => setProblem(failed('Couldn’t save that change.', e)),
  });
  const mSaveKey = useMutation({
    mutationFn: (apiKey: string) => api.updateProvider(p.id, { apiKey }),
    onMutate: clear,
    onSuccess: (c) => { apply(c); setEditKey(false); setKey(''); },
    onError: (e) => setProblem(failed('Couldn’t save the API key.', e)),
  });
  const mRemove = useMutation({
    mutationFn: () => api.removeProvider(p.id),
    onMutate: clear,
    onSuccess: apply,
    onError: (e) => setProblem(failed(`Couldn’t remove “${p.name}”.`, e)),
  });
  const mSync = useMutation({
    mutationFn: () => api.syncProvider(p.id),
    onSuccess: (res) => {
      apply(res.config);
      setSync({ msg: `${plural(res.detected, 'model')} offered · ${res.added ? `${res.added} new` : 'nothing new'}` });
    },
    onError: (e) => {
      setSync({ msg: errMsg(e), error: true });
      void qc.invalidateQueries({ queryKey: AI_CONFIG_KEY }); // the provider now notes the problem
    },
  });

  const status = p.lastSyncError
    ? { text: `Couldn’t load the models: ${p.lastSyncError}`, tone: 'text-danger' }
    : p.lastSyncedAt
      ? { text: `Models updated ${relativeTime(p.lastSyncedAt)}`, tone: 'text-ink-3' }
      : { text: 'Models not loaded yet', tone: 'text-ink-3' };

  return (
    <div data-provider={p.id} className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-ink">{p.name}</span>
            <ProviderBadge provider={p} />
            {!p.enabled ? (
              <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-danger">Disabled</span>
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
        <div className="flex flex-wrap items-center gap-2">
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

      <p className={`text-xs ${status.tone}`}>{status.text}</p>
      {problem ? <p role="alert" className="text-xs font-medium text-danger">{problem}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div aria-live="polite" className={`text-xs ${sync?.error ? 'text-danger' : 'text-ink-2'}`}>
          {/* A failed refresh shows once: in the status line above, as soon as the card has it. */}
          {mSync.isPending ? 'Loading the models…' : sync?.error && p.lastSyncError ? null : sync?.msg}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" loading={mSync.isPending} onClick={() => { setSync(null); mSync.mutate(); }}>
            Refresh models
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            aria-label={`Delete ${p.name}`}
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

const presetById = (id: ProviderPreset['id']) => PROVIDER_PRESETS.find((x) => x.id === id)!;

/**
 * Connect a provider: pick the service and paste its key. The name and address of a ready-made
 * service fill themselves in (the address can still be changed), and the models load on connect.
 */
function ConnectProviderForm({ config, apply, api }: SectionProps) {
  const [presetId, setPresetId] = useState<ProviderPreset['id']>('openai');
  const preset = presetById(presetId);
  const [name, setName] = useState(preset.name);
  const [nameEdited, setNameEdited] = useState(false);
  const [url, setUrl] = useState(preset.baseUrl);
  const [changeUrl, setChangeUrl] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [errors, setErrors] = useState<{ name?: string; url?: string; key?: string }>({});
  const [notice, setNotice] = useState<string | null>(null);
  // A local server's address differs per install, and "Other" has none: type it.
  const urlEditable = changeUrl || !preset.baseUrl || preset.id === 'ollama';

  const choose = (id: ProviderPreset['id']) => {
    const next = presetById(id);
    setPresetId(id);
    if (!nameEdited) setName(next.name);
    setUrl(next.baseUrl);
    setChangeUrl(false);
    setErrors({});
    setNotice(null);
  };

  const mAdd = useMutation({
    mutationFn: () =>
      api.addProvider({ name: name.trim(), kind: preset.kind, preset: preset.id, apiBaseUrl: url.trim(), apiKey: apiKey.trim() || undefined }),
    onMutate: () => setNotice(null),
    onSuccess: (c: AiConfig) => {
      const before = new Set(config.providers.map((p) => p.id));
      const added = c.providers.find((p) => !before.has(p.id));
      apply(c);
      setApiKey('');
      setNameEdited(false);
      setName(preset.name);
      setErrors({});
      if (!added) return;
      if (added.lastSyncError) {
        setNotice(`Connected to ${added.name}, but its models couldn’t be loaded: ${added.lastSyncError} You can add models by name below.`);
        return;
      }
      const own = c.models.filter((m) => m.providerId === added.id);
      const on = own.filter((m) => m.enabled).map((m) => m.displayName);
      setNotice(
        `Connected to ${added.name}: ${plural(own.length, 'model')} found.` +
          (on.length ? ` ${on.join(', ')} ${on.length === 1 ? 'is' : 'are'} switched on.` : ''),
      );
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Give the provider a name.';
    if (!/^https?:\/\/\S+/i.test(url.trim())) next.url = 'A valid http(s) address is required.';
    if (preset.needsKey && !apiKey.trim()) next.key = `Paste the API key from ${preset.name}.`;
    setErrors(next);
    if (next.url && !urlEditable) setChangeUrl(true);
    if (Object.keys(next).length === 0) mAdd.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="card mt-3 flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold text-ink">Connect a provider</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="ap-preset">Service</FieldLabel>
          <select id="ap-preset" value={presetId} onChange={(e) => choose(e.target.value as ProviderPreset['id'])} className={fieldClass(false)}>
            {PROVIDER_PRESETS.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="ap-name" required>Name</FieldLabel>
          <input
            id="ap-name"
            value={name}
            aria-required="true"
            aria-invalid={errors.name ? true : undefined}
            onChange={(e) => { setName(e.target.value); setNameEdited(true); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }}
            placeholder="e.g. Our AI service"
            className={fieldClass(!!errors.name)}
          />
          <FieldError>{errors.name}</FieldError>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="ap-key" required={preset.needsKey}>API key</FieldLabel>
          <input
            id="ap-key"
            type="password"
            value={apiKey}
            autoComplete="off"
            aria-required={preset.needsKey ? 'true' : undefined}
            aria-invalid={errors.key ? true : undefined}
            onChange={(e) => { setApiKey(e.target.value); if (errors.key) setErrors((x) => ({ ...x, key: undefined })); }}
            placeholder={preset.needsKey ? 'Paste the key — stored encrypted' : 'Optional'}
            className={fieldClass(!!errors.key)}
          />
          <FieldError>{errors.key}</FieldError>
          {preset.keyUrl ? (
            <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer" className="self-start text-xs text-brand hover:underline">
              Get a key from {preset.name}
            </a>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          {urlEditable ? (
            <>
              <FieldLabel htmlFor="ap-url" required>Address</FieldLabel>
              <input
                id="ap-url"
                value={url}
                aria-required="true"
                aria-invalid={errors.url ? true : undefined}
                onChange={(e) => { setUrl(e.target.value); if (errors.url) setErrors((x) => ({ ...x, url: undefined })); }}
                placeholder="https://api.example.com/v1"
                className={fieldClass(!!errors.url)}
              />
              <FieldError>{errors.url}</FieldError>
            </>
          ) : (
            <>
              <span className="text-sm font-medium text-ink">Address</span>
              <p className="flex min-h-[2.375rem] flex-wrap items-center gap-x-2 text-sm text-ink-2">
                <span className="break-all font-mono text-xs">{url}</span>
                <button type="button" className="text-xs text-brand hover:underline" onClick={() => setChangeUrl(true)}>
                  Change
                </button>
              </p>
            </>
          )}
        </div>
      </div>
      {mAdd.isError ? <FieldError>{errMsg(mAdd.error)}</FieldError> : null}
      {notice ? (
        <p role="status" className="text-sm text-ink-2">{notice}</p>
      ) : null}
      <div>
        <Button type="submit" loading={mAdd.isPending}>Connect &amp; load models</Button>
      </div>
    </form>
  );
}
