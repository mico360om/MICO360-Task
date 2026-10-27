import { ApiError } from '../../lib/api-client';
import { Toggle } from '../ui/Toggle';
import { providerLabel, type aiApi, type AiCapability, type AiConfig, type ProviderKind } from '../../api/ai';

/** The AI Management page's query: the whole (redacted) config. */
export const AI_CONFIG_KEY = ['ai-config'] as const;

export type Api = ReturnType<typeof aiApi>;
export interface SectionProps {
  config: AiConfig;
  apply: (c: AiConfig) => void;
  api: Api;
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/** Why a change did not happen: the server's own reason when it gave one, else "try again". */
export function failed(what: string, e: unknown): string {
  const reason = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.message && !/^Request failed/.test(e.message) ? e.message : 'Please try again.';
  return `${what} ${reason}`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Whether a model can be used now: switched on, still offered, and its provider switched on. */
export function isUsable(config: AiConfig, id: string | null | undefined): boolean {
  const m = id ? config.models.find((x) => x.id === id) : undefined;
  return Boolean(m && m.enabled && m.available && config.providers.find((p) => p.id === m.providerId)?.enabled);
}

/** The model a capability really uses: the chosen default while it is usable, else Automatic's choice. */
export function inUseFor(config: AiConfig, cap: AiCapability): string | null {
  const chosen = config.defaults[cap];
  return chosen && isUsable(config, chosen) ? chosen : (config.automatic?.[cap] ?? null);
}

/** Which service a provider is: "Anthropic", "OpenRouter", "OpenAI-compatible"… */
export function ProviderBadge({ provider }: { provider: { preset?: string | null; kind: ProviderKind } }) {
  return (
    <span className="rounded-md bg-ground px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">{providerLabel(provider)}</span>
  );
}

/** An on/off switch (the shared one, 44px to tap on touch screens). */
export function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return <Toggle on={on} label={label} disabled={disabled} onChange={() => onChange(!on)} />;
}
