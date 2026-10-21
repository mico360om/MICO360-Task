import type { ApiClient } from '../lib/api-client';
import type { RecurrenceRule } from '../lib/recurrence';

/** Capabilities a model can serve. "document" = Document Processing. Mirrors the backend. */
export const AI_CAPABILITIES = ['chat', 'ocr', 'vision', 'document', 'embedding'] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const PROVIDER_KINDS = ['openai', 'anthropic', 'ollama', 'custom'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** A ready-made service: connecting one needs only its key. Mirrors the backend's PROVIDER_PRESETS. */
export interface ProviderPreset {
  id: 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'groq' | 'mistral' | 'deepseek' | 'mico360' | 'ollama' | 'custom';
  /** In the list. */
  label: string;
  /** The provider's suggested name. */
  name: string;
  kind: ProviderKind;
  /** Empty: the admin types it. */
  baseUrl: string;
  needsKey: boolean;
  /** Where to get a key. */
  keyUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude)', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Google Gemini', name: 'Google Gemini', kind: 'custom', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', label: 'OpenRouter', name: 'OpenRouter', kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, keyUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'groq', label: 'Groq', name: 'Groq', kind: 'custom', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, keyUrl: 'https://console.groq.com/keys' },
  { id: 'mistral', label: 'Mistral', name: 'Mistral', kind: 'custom', baseUrl: 'https://api.mistral.ai/v1', needsKey: true, keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', name: 'DeepSeek', kind: 'custom', baseUrl: 'https://api.deepseek.com', needsKey: true, keyUrl: 'https://platform.deepseek.com/api_keys' },
  // MICO360 Connect's AI platform: its OpenAI-compatible API on port 5310 under /v1 (see its API guide);
  // keys are issued in its console under AI Platform → Applications & keys.
  { id: 'mico360', label: 'MICO360 AI (our AI platform)', name: 'MICO360 AI', kind: 'custom', baseUrl: 'http://ai.mico360.com:5310/v1', needsKey: true },
  { id: 'ollama', label: 'Ollama (your own server)', name: 'Ollama', kind: 'ollama', baseUrl: 'http://localhost:11434', needsKey: false },
  { id: 'custom', label: 'Other (OpenAI-compatible)', name: '', kind: 'custom', baseUrl: '', needsKey: false },
];

/**
 * Does this address send the API key and the prompts across a network unencrypted? Plain http to
 * anything but this computer or a private (office) address does.
 */
export function sendsUnencrypted(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (!m) return true;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return !(a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254));
}

/** The label shown for a provider: its preset's, else its kind. */
export function providerLabel(p: { preset?: string | null; kind: ProviderKind }): string {
  const preset = PROVIDER_PRESETS.find((x) => x.id === p.preset);
  if (preset && preset.id !== 'custom') return preset.name;
  return p.kind === 'custom' ? 'OpenAI-compatible' : (PROVIDER_PRESETS.find((x) => x.id === p.kind)?.name ?? p.kind);
}

/** Human labels for the capability keys (used in the UI). */
export const CAPABILITY_LABELS: Record<AiCapability, string> = {
  chat: 'Chat',
  ocr: 'OCR',
  vision: 'Vision',
  document: 'Document Processing',
  embedding: 'Embeddings',
};

/** Provider as returned to clients — the API key is never included, only whether one is set + a hint. */
export interface RedactedProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  apiBaseUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  /** The ready-made service it was connected from (older providers have none). */
  preset?: ProviderPreset['id'] | null;
  /** When its model list last loaded, and why the last try failed. */
  lastSyncedAt?: string | null;
  lastSyncAttemptAt?: string | null;
  lastSyncError?: string | null;
  /** Its recommended chat model, among the models it offers. */
  recommendedModelId?: string | null;
}

export interface AiModelParameters {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  [key: string]: unknown;
}

export interface AiModel {
  id: string;
  providerId: string;
  modelKey: string;
  displayName: string;
  capabilities: AiCapability[];
  parameters: AiModelParameters;
  concurrencyLimit: number;
  enabled: boolean;
  available: boolean;
  /** When the provider released it (seconds since 1970), if it says. */
  created?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiConfig {
  providers: RedactedProvider[];
  models: AiModel[];
  defaults: Partial<Record<AiCapability, string | null>>;
  /** The model "Automatic" uses now for each capability (null: nothing usable). */
  automatic?: Partial<Record<AiCapability, string | null>>;
}

export interface ProviderInput {
  name: string;
  kind: ProviderKind;
  preset?: ProviderPreset['id'];
  apiBaseUrl: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface ProviderPatch {
  name?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface ModelInput {
  providerId: string;
  modelKey: string;
  displayName?: string;
  capabilities: AiCapability[];
  parameters?: AiModelParameters;
  concurrencyLimit?: number;
  enabled?: boolean;
}

export interface ModelPatch {
  displayName?: string;
  capabilities?: AiCapability[];
  parameters?: AiModelParameters;
  concurrencyLimit?: number;
  enabled?: boolean;
}

export interface SyncResult {
  detected: number;
  added: number;
  config: AiConfig;
}

/** A model test: it answered (and how fast), or the provider's reason it didn't. */
export type ModelTestResult = { ok: true; ms: number; reply: string } | { ok: false; message: string };

/** Admin AI Management client — every mutation returns the fresh (redacted) config. */
export function aiApi(client: ApiClient) {
  const cfg = <T extends { data: AiConfig }>(p: Promise<T>) => p.then((r) => r.data);
  return {
    getConfig: () => client.get<{ data: AiConfig }>('/ai/config').then((r) => r.data),

    addProvider: (input: ProviderInput) => cfg(client.post<{ data: AiConfig }>('/ai/providers', input)),
    updateProvider: (id: string, patch: ProviderPatch) => cfg(client.put<{ data: AiConfig }>(`/ai/providers/${id}`, patch)),
    removeProvider: (id: string) => cfg(client.del<{ data: AiConfig }>(`/ai/providers/${id}`)),
    syncProvider: (id: string) => client.post<{ data: SyncResult }>(`/ai/providers/${id}/sync`).then((r) => r.data),

    addModel: (input: ModelInput) => cfg(client.post<{ data: AiConfig }>('/ai/models', input)),
    updateModel: (id: string, patch: ModelPatch) => cfg(client.put<{ data: AiConfig }>(`/ai/models/${id}`, patch)),
    setModelEnabled: (id: string, enabled: boolean) => cfg(client.patch<{ data: AiConfig }>(`/ai/models/${id}/enabled`, { enabled })),
    removeModel: (id: string) => cfg(client.del<{ data: AiConfig }>(`/ai/models/${id}`)),
    testModel: (id: string) => client.post<{ data: ModelTestResult }>(`/ai/models/${id}/test`).then((r) => r.data),

    setDefault: (capability: AiCapability, modelId: string | null) =>
      cfg(client.put<{ data: AiConfig }>(`/ai/defaults/${capability}`, { modelId })),

    // ── Product-facing AI features (any signed-in user) ──
    /** Break a task into checklist steps. */
    breakdown: (title: string, description?: string) =>
      client.post<{ data: { items: string[] } }>('/ai/breakdown', { title, description }).then((r) => r.data.items),
    /** Turn a free-text note into a structured task draft. */
    parseTask: (text: string, today?: string) =>
      client.post<{ data: AiTaskDraft }>('/ai/parse-task', { text, ...(today ? { today } : {}) }).then((r) => r.data),
    /** Fill the meeting form from a sentence. */
    parseMeeting: (text: string, today?: string) =>
      client.post<{ data: AiMeetingDraft }>('/ai/parse-meeting', { text, ...(today ? { today } : {}) }).then((r) => r.data),
    /** Propose a meeting's agenda (the server adds the project's open tasks and the last meeting's leftovers). */
    draftAgenda: (input: AiDraftAgendaInput) => client.post<{ data: { items: AiAgendaItem[] } }>('/ai/draft-agenda', input).then((r) => r.data.items),
    /** A short description for the meeting's invitation. */
    writeMeetingDescription: (input: { title: string; agenda?: string[]; text?: string }) =>
      client.post<{ data: { description: string } }>('/ai/write-meeting-description', input).then((r) => r.data.description),
    /** Concise project status summary. */
    summary: (name: string, stats: AiProjectStats, sampleTitles?: string[]) =>
      client.post<{ data: { summary: string } }>('/ai/summary', { name, stats, sampleTitles }).then((r) => r.data.summary),
    /** Suggest a priority + reason for a task. */
    suggestPriority: (title: string, description?: string, dueDate?: string | null) =>
      client.post<{ data: AiPrioritySuggestion }>('/ai/suggest-priority', { title, description, dueDate }).then((r) => r.data),
  };
}

/** What a plain-English note fills in; a field the note says nothing about is null (or absent, from an older server). */
export interface AiTaskDraft {
  title: string;
  description?: string | null;
  dueDate: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | null;
  recurrence?: RecurrenceRule | null;
  /** One of the person's projects, by id; the server never suggests one outside their list. */
  project?: { id: string; code: string; number: string | null; name: string } | null;
}
/** What a sentence fills in on the meeting form (company time); empty where it says nothing. */
export interface AiMeetingDraft {
  title: string;
  description: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  /** HH:MM, 24-hour */
  startTime: string | null;
  minutes: number | null;
  recurrence: RecurrenceRule | null;
  project: { id: string; code: string; number: string | null; name: string } | null;
  location: string | null;
  onlineLink: string | null;
  people: {
    found: Array<{ id: string; name: string }>;
    /** A name more than one person goes by: the person chooses. */
    choices: Array<{ said: string; options: Array<{ id: string; name: string }> }>;
    notFound: string[];
  };
  guests: Array<{ email: string; name: string }>;
  agenda: string[];
}
export interface AiDraftAgendaInput {
  title: string;
  description?: string;
  text?: string;
  projectId?: string | null;
  startAt: string;
  minutes: number;
  /** The invited portal users, the organizer included: the only possible leads. */
  peopleIds: string[];
  /** An existing meeting: its series' previous meeting gives the leftovers. */
  meetingId?: string;
}
export interface AiAgendaItem {
  title: string;
  ownerId: string | null;
  minutes: number;
}
export interface AiProjectStats {
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
}
export interface AiPrioritySuggestion {
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  reason: string;
}
