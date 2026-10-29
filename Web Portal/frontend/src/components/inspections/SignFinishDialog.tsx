import { useId, useRef, useState } from 'react';
import type { SignatureInput } from '../../api/inspections';
import type { SignatureRole } from '../../lib/inspection-rules';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { SignaturePad, signatureProblem, type SignatureValue } from './SignaturePad';

const ROLE_WORD: Record<SignatureRole, string> = { INSPECTOR: 'Inspector', CLIENT: 'Client', SUPERVISOR: 'Supervisor' };

/**
 * Signing ends the inspection: the inspector always signs; the form may ask for the client's or a
 * supervisor's signature too (needed, or optional). Each signature is drawn, or the typed name
 * (keyboard users, anyone who can't draw), and always carries the signer's typed name; the time is
 * stamped here. Without signal the signatures stay on this phone and it finishes once back online.
 */
export function SignFinishDialog({
  allowed,
  required,
  inspectorName,
  online,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  allowed: SignatureRole[];
  required: SignatureRole[];
  inspectorName: string;
  online: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (signatures: SignatureInput[]) => void;
  onClose: () => void;
}) {
  const ids = { title: useId(), intro: useId() };
  const dialogRef = useDialog(busy ? () => {} : onClose);
  const [values, setValues] = useState<Partial<Record<SignatureRole, SignatureValue | null>>>({});
  const [problems, setProblems] = useState<Partial<Record<SignatureRole, string | null>>>({});
  const firstProblem = useRef<HTMLDivElement>(null);

  const submit = () => {
    const found: Partial<Record<SignatureRole, string | null>> = {};
    for (const role of allowed) found[role] = signatureProblem(values[role] ?? null, required.includes(role));
    setProblems(found);
    const bad = allowed.find((r) => found[r]);
    if (bad) {
      document.getElementById(`sign-${bad}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    const at = new Date().toISOString();
    const signatures: SignatureInput[] = [];
    for (const role of allowed) {
      const v = values[role];
      if (!v || (v.method === 'DRAWN' && !v.image)) continue;
      signatures.push({ role, name: v.name.trim(), method: v.method, ...(v.method === 'DRAWN' ? { image: v.image } : {}), signedAt: at });
    }
    onSubmit(signatures);
  };

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-2 sm:p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ids.title}
          aria-describedby={ids.intro}
          className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height,100vh)-1rem)] w-full max-w-xl animate-scale-in flex-col overflow-hidden"
        >
          <div className="border-b border-line px-5 pb-3 pt-4">
            <h2 id={ids.title} className="font-display text-lg font-semibold text-ink">
              Sign and finish
            </h2>
            <p id={ids.intro} className="mt-1 text-sm leading-relaxed text-ink-2">
              Signing finishes the inspection: its answers can’t be changed after this, and the report is made from them.
              {online ? '' : ' There’s no signal now: the signatures are saved on this phone, and it finishes when you’re back online.'}
            </p>
          </div>
          <div ref={firstProblem} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
            {allowed.map((role) => {
              const needed = required.includes(role);
              return (
                <div key={role} id={`sign-${role}`}>
                  <SignaturePad
                    label={`${ROLE_WORD[role]} signature${needed ? '' : ' (optional)'}`}
                    defaultName={role === 'INSPECTOR' ? inspectorName : ''}
                    required={needed}
                    value={values[role] ?? null}
                    onChange={(v) => {
                      setValues((cur) => ({ ...cur, [role]: v }));
                      if (problems[role]) setProblems((cur) => ({ ...cur, [role]: null }));
                    }}
                    disabled={busy}
                    error={problems[role] ?? null}
                  />
                </div>
              );
            })}
            {error ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={busy} className="[@media(pointer:coarse)]:!min-h-11">
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} className="[@media(pointer:coarse)]:!min-h-11">
              Sign and finish
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
