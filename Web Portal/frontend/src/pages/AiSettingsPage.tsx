import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { apiClient } from '../api/client';
import { aiApi, type AiConfig } from '../api/ai';
import { LoadError } from '../components/ui/LoadError';
import { AI_CONFIG_KEY } from '../components/ai-settings/shared';
import { ProvidersSection } from '../components/ai-settings/ProvidersSection';
import { ModelsSection } from '../components/ai-settings/ModelsSection';
import { DefaultsSection } from '../components/ai-settings/DefaultsSection';

/**
 * AI Management (admin): connect providers (their models load by themselves), choose which models
 * people can use, and the default model for each kind of work ("Automatic" unless one is picked).
 */
export function AiSettingsPage() {
  const api = aiApi(apiClient);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: AI_CONFIG_KEY, queryFn: () => api.getConfig() });
  const apply = (data: AiConfig) => qc.setQueryData(AI_CONFIG_KEY, data);
  const config = q.data;

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="AI Management"
        subtitle="Connect AI providers, choose the models people can use, and the defaults. Changes apply immediately — no restart. Every change is recorded in the audit log."
      />

      {q.isLoading ? (
        <p className="text-ink-2">Loading…</p>
      ) : q.isError ? (
        <LoadError what="the AI settings" onRetry={() => void q.refetch()} className="card p-5" />
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
