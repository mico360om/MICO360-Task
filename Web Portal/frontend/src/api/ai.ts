import type { ApiClient } from '../lib/api-client';

/** Capabilities a model can serve. "document" = Document Processing. Mirrors the backend. */
export const AI_CAPABILITIES = ['chat', 'ocr', 'vision', 'document', 'embedding'] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const PROVIDER_KINDS = ['openai', 'anthropic', 'ollama', 'custom'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

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
  createdAt: string;
  updatedAt: string;
}

export interface AiConfig {
  providers: RedactedProvider[];
  models: AiModel[];
  defaults: Partial<Record<AiCapability, string | null>>;
}

export interface ProviderInput {
  name: string;
  kind: ProviderKind;
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

    setDefault: (capability: AiCapability, modelId: string | null) =>
      cfg(client.put<{ data: AiConfig }>(`/ai/defaults/${capability}`, { modelId })),

    // ── Product-facing AI features (any signed-in user) ──
    /** Break a task into checklist steps. */
    breakdown: (title: string, description?: string) =>
      client.post<{ data: { items: string[] } }>('/ai/breakdown', { title, description }).then((r) => r.data.items),
    /** Turn a free-text note into a structured task draft. */
    parseTask: (text: string, today?: string) =>
      client.post<{ data: AiTaskDraft }>('/ai/parse-task', { text, ...(today ? { today } : {}) }).then((r) => r.data),
    /** Concise project status summary. */
    summary: (name: string, stats: AiProjectStats, sampleTitles?: string[]) =>
      client.post<{ data: { summary: string } }>('/ai/summary', { name, stats, sampleTitles }).then((r) => r.data.summary),
    /** Suggest a priority + reason for a task. */
    suggestPriority: (title: string, description?: string, dueDate?: string | null) =>
      client.post<{ data: AiPrioritySuggestion }>('/ai/suggest-priority', { title, description, dueDate }).then((r) => r.data),
  };
}

export interface AiTaskDraft {
  title: string;
  dueDate: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | null;
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
