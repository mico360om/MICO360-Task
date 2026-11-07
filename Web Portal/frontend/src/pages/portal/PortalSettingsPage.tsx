import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { portalProblem, type PortalNoticeSettings, type PortalNoticeSwitches } from '../../api/portal';
import { Toggle } from '../../components/ui/Toggle';
import { usePortalApi, usePreviewOff } from '../../components/portal/portal-context';
import { portalKeys, usePortalSettings } from '../../components/portal/portal-queries';
import { BackLink, Chip, LoadFailed, Loading, Section, usePortalPageName } from '../../components/portal/portal-ui';

/** The kinds of notice a client may switch off, in the server's order and words. */
const KINDS: { key: keyof PortalNoticeSwitches; label: string; hint: string }[] = [
  { key: 'reply', label: 'Replies to your comments', hint: 'The project team answers a comment you left on a task.' },
  { key: 'signOff', label: 'Tasks ready for your sign-off', hint: 'A task you can accept or send back is finished.' },
  { key: 'minutes', label: 'Approved meeting minutes', hint: 'The minutes of a meeting are approved and shared with you.' },
  { key: 'document', label: 'New documents shared with you', hint: 'The project team shares a file with you on a task.' },
];

/**
 * 1.23.7 The client's notification settings: four switches (email and the bell), each saved as it is
 * pressed; meeting invitations are always sent; and the projects whose team has turned their
 * notifications off.
 */
export function PortalSettingsPage() {
  const id = useId();
  const q = usePortalSettings();
  const api = usePortalApi();
  const off = usePreviewOff();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  usePortalPageName('Notification settings');

  const save = useMutation({
    mutationFn: (patch: Partial<PortalNoticeSwitches>) => api.setSettings(patch),
    // The switch moves at once; it goes back if the server says no.
    onMutate: async (patch) => {
      setStatus(null);
      setProblem(null);
      await qc.cancelQueries({ queryKey: portalKeys.settings });
      const before = qc.getQueryData<PortalNoticeSettings>(portalKeys.settings);
      if (before) qc.setQueryData<PortalNoticeSettings>(portalKeys.settings, { ...before, settings: { ...before.settings, ...patch } });
      return { before };
    },
    onSuccess: (fresh, patch) => {
      qc.setQueryData(portalKeys.settings, fresh);
      const kind = KINDS.find((k) => k.key in patch);
      if (kind) setStatus(`Saved. ${kind.label}: ${fresh.settings[kind.key] ? 'on' : 'off'}.`);
    },
    onError: (err, _patch, context) => {
      if (context?.before) qc.setQueryData(portalKeys.settings, context.before);
      setProblem(portalProblem(err, 'Couldn’t save your choice.'));
    },
  });

  const quiet = q.data?.projects.filter((p) => !p.notify) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <BackLink to="/portal/notifications">Notifications</BackLink>
      <div>
        <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">Notification settings</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-2">Choose what we tell you about, by email and on the bell. Each change is saved as you make it.</p>
      </div>

      {status ? <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{status}</p> : null}
      {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}

      {q.isPending ? (
        <Loading what="your settings" />
      ) : q.isError ? (
        <LoadFailed what="your settings" onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Section title="Tell me about">
            <ul className="divide-y divide-line">
              {KINDS.map((k) => (
                <li key={k.key} className="flex items-center gap-4 py-3 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{k.label}</p>
                    <p id={`${id}-${k.key}`} className="text-xs text-ink-2">{k.hint}</p>
                  </div>
                  {/* In a preview the switch is off; its hint shows on the box around it. */}
                  <span title={off.title} className="flex flex-none">
                    <Toggle
                      on={q.data.settings[k.key]}
                      label={k.label}
                      describedBy={`${id}-${k.key}`}
                      disabled={off.disabled}
                      onChange={() => save.mutate({ [k.key]: !q.data.settings[k.key] })}
                    />
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-4 py-3 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">Meeting invitations</p>
                  <p className="text-xs text-ink-2">Invitations, changes and cancellations always reach you by email, with a calendar file.</p>
                </div>
                <Chip>Always sent</Chip>
              </li>
            </ul>
          </Section>
          {quiet.length ? (
            <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">
              The project team has turned notifications off for:{' '}
              {quiet.map((p, i) => (
                <span key={p.id}>
                  {i > 0 ? ', ' : null}
                  <bdi className="font-semibold text-ink">{p.name}</bdi>
                </span>
              ))}
              . You won’t hear about those projects until the team turns them back on; meeting invitations still reach you.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
