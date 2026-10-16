import { useMutation } from '@tanstack/react-query';
import { FieldLabel, FieldError, fieldClass } from '../ui/Field';
import { AI_CAPABILITIES, CAPABILITY_LABELS, type AiCapability } from '../../api/ai';
import { errMsg, isUsable, type SectionProps } from './shared';

/** What each capability is used for today. */
const USED_FOR: Record<AiCapability, string> = {
  chat: 'Used by the AI features: task steps, describe a task, project summaries and priority suggestions.',
  vision: 'Not used by a feature yet.',
  ocr: 'Not used by a feature yet.',
  document: 'Not used by a feature yet.',
  embedding: 'Not used by a feature yet.',
};

/**
 * The model each capability uses. "Automatic" (the default) picks the recommended switched-on
 * model and moves on by itself when that one goes away; choosing a model pins it.
 */
export function DefaultsSection({ config, apply, api }: SectionProps) {
  const mSetDefault = useMutation({
    mutationFn: ({ cap, modelId }: { cap: AiCapability; modelId: string | null }) => api.setDefault(cap, modelId),
    onSuccess: apply,
  });

  return (
    <section aria-labelledby="ai-defaults-h">
      <div className="mb-3">
        <h2 id="ai-defaults-h" className="font-display text-lg font-bold text-ink">Default models</h2>
        <p className="text-sm text-ink-2">
          Which model each kind of work uses. Automatic picks the recommended switched-on model, and moves to the next one by itself if
          that model goes away. Pick a model to use that one instead.
        </p>
      </div>

      <div className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {AI_CAPABILITIES.map((cap) => {
          const options = config.models.filter((m) => m.enabled && m.capabilities.includes(cap));
          const autoId = config.automatic?.[cap] ?? null;
          const auto = autoId ? config.models.find((m) => m.id === autoId) : undefined;
          const chosenId = config.defaults[cap] ?? null;
          const chosen = chosenId ? config.models.find((m) => m.id === chosenId) : undefined;
          // A chosen model the provider no longer offers (or that is off) isn't used: say what is.
          const stale = chosen && !isUsable(config, chosen.id)
            ? `${chosen.displayName} isn’t available now, so ${auto ? `Automatic’s choice (${auto.displayName}) is used` : 'no model is used'} until it’s back.`
            : null;
          const inputId = `ai-default-${cap}`;
          return (
            <div key={cap} className="flex flex-col gap-1">
              <FieldLabel htmlFor={inputId}>{CAPABILITY_LABELS[cap]}</FieldLabel>
              <select
                id={inputId}
                aria-label={`Default ${CAPABILITY_LABELS[cap]} model`}
                aria-describedby={`${inputId}-use`}
                value={config.defaults[cap] ?? ''}
                disabled={mSetDefault.isPending}
                onChange={(e) => mSetDefault.mutate({ cap, modelId: e.target.value || null })}
                className={fieldClass(false)}
              >
                <option value="">{auto ? `Automatic — ${auto.displayName}` : 'Automatic — no model switched on'}</option>
                {config.providers.map((p) => {
                  const own = options.filter((m) => m.providerId === p.id);
                  return own.length > 0 ? (
                    <optgroup key={p.id} label={p.name}>
                      {own.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName}
                          {m.available ? '' : ' (unavailable)'}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
              {stale ? <p className="text-xs font-medium text-warning">{stale}</p> : null}
              <p id={`${inputId}-use`} className="text-xs text-ink-3">{USED_FOR[cap]}</p>
            </div>
          );
        })}
      </div>
      {mSetDefault.isError ? <FieldError>{errMsg(mSetDefault.error)}</FieldError> : null}
    </section>
  );
}
