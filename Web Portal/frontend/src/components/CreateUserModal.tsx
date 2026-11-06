import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';
import { usersApi, type CreatedUser } from '../api/users';
import { CLIENTS_KEY, clientAsUser, clientsApi } from '../api/clients';
import { Button } from './ui/Button';
import { FieldError, FieldLabel, fieldClass } from './ui/Field';
import { useDialog } from '../hooks/useDialog';
import { ApiError } from '../lib/api-client';
import { isStrongPassword, PASSWORD_RULE_ERROR, PASSWORD_RULE_HINT } from '../lib/passwordPolicy';
import { ModalPortal } from './ui/ModalPortal';
import { dialogLayer, dialogPanel, useTwoColumns } from './ui/dialog-size';
import { CompanyChecklist } from './company/CompanyChecklist';
import { useCompanyChoices } from './company/company-admin';
import { useCompanyStore } from '../stores/company-store';
import { ClientAccessEditor } from './clients/ClientAccessEditor';
import { grantsOf, noModuleText, rowsWithoutModule, type AccessRow } from './clients/client-access';
import { accountProblems, RULE_WORDS, type AccountDetails } from '../lib/account-rules';
import { EmailTaken, SameNameWarning, UsernameTaken, useIdentityCheck } from './onboarding/identity';

export interface CreateUserModalProps {
  onClose: () => void;
  /** The new account, and whether its welcome email went. */
  onCreated?: (result: CreatedUser) => void;
  /** "New client" (the Clients page): a client account, no role to choose. */
  clientOnly?: boolean;
  /** Onboarding: "Open account" on a duplicate warning (the page opens that person's Manage account). */
  onOpenAccount?: (id: string) => void;
}

type FieldName = keyof AccountDetails;

type Role = 'EMPLOYEE' | 'ADMIN' | 'CLIENT';

/** Why the server refused the new account, in words that point at the detail to fix. */
function createFailure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'WEAK_PASSWORD') return PASSWORD_RULE_ERROR;
    if (e.code === 'EMAIL_NOT_CONFIGURED') {
      return 'Email isn’t set up on this server, so the welcome email can’t be sent and the account wasn’t created. Give them a temporary password.';
    }
    // Onboarding: the server names the field and whose it is ("This email address is already used by …").
    if (e.code === 'DUPLICATE_USER' && e.message && !/^Request failed/.test(e.message)) return e.message;
    if (e.code === 'DUPLICATE_USER' || e.status === 409) return 'That email or username is already in use. Choose a different one.';
    const fields = (e.details as { fieldErrors?: Record<string, string[] | undefined> } | undefined)?.fieldErrors ?? {};
    if (fields.email?.length) return 'Enter a valid email address, like name@company.com.';
    const [field, messages] = Object.entries(fields).find(([, m]) => m?.length) ?? [];
    if (field && messages?.[0]) return `Check the ${FIELD_NAMES[field] ?? field}: ${messages[0]}`;
    if (e.status === 403) return 'You don’t have permission to create accounts.';
    // The server's own sentence for a detail it refused (a company: "Choose at least one company.").
    if (e.status === 400 && e.message && !/^Request failed/.test(e.message)) return e.message;
  }
  return 'Couldn’t create the account. Please try again.';
}

const FIELD_NAMES: Record<string, string> = {
  firstName: 'first name',
  lastName: 'last name',
  username: 'username',
  password: 'password',
  roleNames: 'role',
  organisation: 'organisation',
  phone: 'phone',
  projects: 'project access',
};

/**
 * Admin dialog to create a new account (name, credentials, role). Used by User Management + Team.
 * 1.23: Role "Client" makes a client account instead (POST /clients): their organisation and phone,
 * and in place of companies the projects they may open in the Client portal, with what they may see
 * and do in each (the one editor the Clients page and Manage account use too).
 */
export function CreateUserModal({ onClose, onCreated, clientOnly = false, onOpenAccount }: CreateUserModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(clientOnly ? 'CLIENT' : 'EMPLOYEE');
  const isClient = role === 'CLIENT';
  const [organisation, setOrganisation] = useState('');
  const [phone, setPhone] = useState('');
  const [access, setAccess] = useState<AccessRow[]>([]);
  // After a save attempt: a project with no module is marked in the editor.
  const [accessChecked, setAccessChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Onboarding: each field's own problem (its rule), said under it after a save attempt.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const firstRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // "Send a welcome email": on unless email isn't set up on this server (then it can't be turned on).
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const emailEnabled = (configQ.data as { emailEnabled?: unknown } | undefined)?.emailEnabled !== false;
  const [welcomeChoice, setWelcomeChoice] = useState(true);
  const sendWelcome = emailEnabled && welcomeChoice;
  // Their companies, once the site has two or more: the picked one ticked to start with (the server's
  // own default). With one company there is no field, and the server gives them that company.
  const companyChoices = useCompanyChoices();
  const pick = useCompanyStore((s) => s.pick);
  const [tickedIds, setTickedIds] = useState<string[] | null>(null);
  const [chosenPrimary, setChosenPrimary] = useState<string | null>(null);
  const companyIds = tickedIds ?? (pick && companyChoices.companies.some((c) => c.id === pick && c.status === 'ACTIVE') ? [pick] : []);
  const primaryCompanyId = chosenPrimary && companyIds.includes(chosenPrimary) ? chosenPrimary : (companyIds[0] ?? null);

  // Onboarding: who already has this email, username or name (asked once the typing pauses).
  const found = useIdentityCheck({ email, username, firstName, lastName, organisation, client: isClient });
  const clearField = (k: FieldName) => setFieldErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  const describe = (k: FieldName, ...more: (string | false | null | undefined)[]) => [`nu-${k}-hint`, fieldErrors[k] ? `nu-${k}-error` : null, ...more].filter(Boolean).join(' ');

  const createMut = useMutation({
    mutationFn: (): Promise<CreatedUser> =>
      isClient
        ? clientsApi(apiClient)
            .create({
              firstName,
              lastName,
              username,
              email,
              organisation: organisation.trim() || null,
              phone: phone.trim() || null,
              ...(password ? { password } : {}),
              sendWelcome,
              projects: grantsOf(access),
            })
            .then((r) => ({ user: clientAsUser(r.client), welcome: r.welcome }))
        : usersApi(apiClient).create({
        firstName,
        lastName,
        username,
        email,
        ...(password ? { password } : {}),
        roleNames: [role],
        sendWelcome,
        ...(companyChoices.show ? { companyIds, primaryCompanyId } : {}),
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['directory'] });
      if (isClient) qc.invalidateQueries({ queryKey: CLIENTS_KEY });
      onCreated?.(result);
      onClose();
    },
    onError: (e) => {
      setError(createFailure(e));
      // The page thought email was set up: ask again, so the option shows as unavailable.
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_CONFIGURED') void qc.invalidateQueries({ queryKey: ['app-config'] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Onboarding: the same rules as the server, said under each field.
    const problems = accountProblems({ firstName, lastName, email, username, ...(isClient ? { phone, organisation } : {}) }, { client: isClient });
    setFieldErrors(problems);
    const first = (['firstName', 'lastName', 'username', 'email', 'organisation', 'phone'] as FieldName[]).find((k) => problems[k]);
    if (first) {
      const missing = !firstName.trim() || !lastName.trim() || !username.trim() || !email.trim() || (isClient && !organisation.trim());
      setError(missing ? 'Fill in every field.' : 'Check the highlighted details.');
      document.getElementById(`nu-${first === 'firstName' ? 'first' : first === 'lastName' ? 'last' : first}`)?.focus();
      return;
    }
    if (found?.email || found?.username) {
      setError(found.email ? 'That email address is already used by another account.' : 'That username is taken. Choose another.');
      return;
    }
    // An employee needs a company (administrators see every company anyway). The server's words.
    if (!isClient && companyChoices.show && role === 'EMPLOYEE' && companyIds.length === 0) {
      setError('Choose at least one company.');
      return;
    }
    // With a welcome email they set their own password; without one, a temporary password is needed.
    if (!password && !sendWelcome) {
      // Only point at the option when it can be turned on.
      setError(
        emailEnabled
          ? 'Enter a temporary password, or turn on “Send a welcome email” so they can set their own.'
          : 'Email isn’t set up on this server, so a welcome email can’t be sent. Give them a temporary password.',
      );
      passwordRef.current?.focus();
      return;
    }
    // Same rule as the server (8+ characters with a letter and a number), so it never rejects what we accept.
    if (password && !isStrongPassword(password)) {
      setError(PASSWORD_RULE_ERROR);
      return;
    }
    // A client's projects each need a module (the server's rule), said before anything is sent.
    if (isClient) {
      setAccessChecked(true);
      const missing = rowsWithoutModule(access);
      if (missing.length > 0) {
        setError(noModuleText(missing));
        return;
      }
    }
    createMut.mutate();
  }

  // Big form (1.22): with companies to choose, 960px and two columns from 1024px — the person on the
  // left, their companies on the right. A one-company site has no companies: a normal form, one column.
  // A client (1.23): the same big form, their project access on the right.
  const companiesShown = companyChoices.show && !isClient;
  const size = companiesShown || isClient ? 'wide' : 'form';
  const twoColumns = useTwoColumns() && (companiesShown || isClient);
  const title = clientOnly ? 'New client' : 'New user';
  const personFields = (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="nu-first" required>First name</FieldLabel>
          <input id="nu-first" ref={firstRef} dir="auto" value={firstName} onChange={(e) => { setFirstName(e.target.value); clearField('firstName'); }} aria-required="true" aria-invalid={fieldErrors.firstName ? true : undefined} aria-describedby={fieldErrors.firstName ? 'nu-firstName-error' : undefined} maxLength={191} className={fieldClass(!!fieldErrors.firstName)} />
          <FieldError id="nu-firstName-error">{fieldErrors.firstName}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="nu-last" required>Last name</FieldLabel>
          <input id="nu-last" dir="auto" value={lastName} onChange={(e) => { setLastName(e.target.value); clearField('lastName'); }} aria-required="true" aria-invalid={fieldErrors.lastName ? true : undefined} aria-describedby={fieldErrors.lastName ? 'nu-lastName-error' : undefined} maxLength={191} className={fieldClass(!!fieldErrors.lastName)} />
          <FieldError id="nu-lastName-error">{fieldErrors.lastName}</FieldError>
        </div>
      </div>
      <SameNameWarning matches={found?.sameName ?? []} onOpen={onOpenAccount} />
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="nu-username" required>Username</FieldLabel>
        <input id="nu-username" value={username} onChange={(e) => { setUsername(e.target.value); clearField('username'); }} autoComplete="off" spellCheck={false} aria-required="true" aria-invalid={fieldErrors.username || found?.username ? true : undefined} aria-describedby={describe('username', found?.username && 'nu-username-taken')} maxLength={32} className={fieldClass(!!fieldErrors.username || !!found?.username)} />
        <p id="nu-username-hint" className="text-xs text-ink-2">{RULE_WORDS.username}</p>
        <FieldError id="nu-username-error">{fieldErrors.username}</FieldError>
        <UsernameTaken id="nu-username-taken" match={found?.username ?? null} onOpen={onOpenAccount} />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="nu-email" required>Email</FieldLabel>
        <input id="nu-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); clearField('email'); }} autoComplete="off" spellCheck={false} aria-required="true" aria-invalid={fieldErrors.email || found?.email ? true : undefined} aria-describedby={describe('email', found?.email && 'nu-email-taken')} maxLength={191} className={fieldClass(!!fieldErrors.email || !!found?.email)} />
        <p id="nu-email-hint" className="text-xs text-ink-2">{RULE_WORDS.email}</p>
        <FieldError id="nu-email-error">{fieldErrors.email}</FieldError>
        <EmailTaken id="nu-email-taken" match={found?.email ?? null} onOpen={onOpenAccount} />
      </div>
      {isClient ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="nu-organisation" required>Organisation</FieldLabel>
            <input id="nu-organisation" dir="auto" value={organisation} onChange={(e) => { setOrganisation(e.target.value); clearField('organisation'); }} maxLength={160} autoComplete="organization" aria-required="true" aria-invalid={fieldErrors.organisation ? true : undefined} aria-describedby={describe('organisation')} className={fieldClass(!!fieldErrors.organisation)} />
            <p id="nu-organisation-hint" className="text-xs text-ink-2">{RULE_WORDS.organisation}</p>
            <FieldError id="nu-organisation-error">{fieldErrors.organisation}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="nu-phone">
              Phone<span className="font-normal text-ink-2"> (optional)</span>
            </FieldLabel>
            <input id="nu-phone" type="tel" dir="ltr" value={phone} onChange={(e) => { setPhone(e.target.value); clearField('phone'); }} maxLength={40} autoComplete="tel" aria-invalid={fieldErrors.phone ? true : undefined} aria-describedby={describe('phone')} className={fieldClass(!!fieldErrors.phone)} />
            <p id="nu-phone-hint" className="text-xs text-ink-2">{RULE_WORDS.phone}</p>
            <FieldError id="nu-phone-error">{fieldErrors.phone}</FieldError>
          </div>
        </div>
      ) : null}
      <div className="flex items-start gap-2.5 rounded-lg border border-line bg-ground/60 px-3 py-2.5">
        <input
          id="nu-welcome"
          type="checkbox"
          checked={sendWelcome}
          disabled={!emailEnabled}
          onChange={(e) => setWelcomeChoice(e.target.checked)}
          aria-describedby="nu-welcome-hint"
          className="mt-0.5 h-4 w-4 flex-none accent-brand disabled:opacity-50"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor="nu-welcome" className={`tap text-sm font-medium ${emailEnabled ? 'text-ink' : 'text-ink-2'}`}>Send a welcome email</label>
          <p id="nu-welcome-hint" className="text-xs text-ink-2">
            {emailEnabled
              ? 'They get their username and a link to set their own password (it works for 7 days).'
              : 'Email isn’t set up on this server, so a welcome email can’t be sent. Give them a temporary password instead.'}
          </p>
        </div>
      </div>
      {/* Side by side from sm up; on a phone the password (with its hints) and the role take a row each. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="nu-password" required={!sendWelcome}>
            Temp password{sendWelcome ? <span className="font-normal text-ink-2"> (optional)</span> : null}
          </FieldLabel>
          <input
            id="nu-password"
            ref={passwordRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass(false)}
            autoComplete="new-password"
            aria-required={!sendWelcome}
            aria-describedby={sendWelcome ? 'nu-password-hint nu-password-optional' : 'nu-password-hint'}
          />
          <p id="nu-password-hint" className="text-xs text-ink-2">{PASSWORD_RULE_HINT}</p>
          {sendWelcome ? <p id="nu-password-optional" className="text-xs text-ink-2">Or leave it empty: they choose their own with the link.</p> : null}
        </div>
        {clientOnly ? null : (
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="nu-role">Role</FieldLabel>
            <select
              id="nu-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
                setError(null);
              }}
              aria-describedby={isClient ? 'nu-role-hint' : undefined}
              className={fieldClass(false)}
            >
              <option value="EMPLOYEE">Employee</option>
              <option value="ADMIN">Administrator</option>
              <option value="CLIENT">Client</option>
            </select>
            {isClient ? <p id="nu-role-hint" className="text-xs text-ink-2">Someone outside the company: they sign in to the Client portal and see only the projects you give them.</p> : null}
          </div>
        )}
      </div>
    </>
  );
  const accessField = isClient ? <ClientAccessEditor value={access} onChange={setAccess} idPrefix="nu-access" showErrors={accessChecked} /> : null;
  const companiesField = companiesShown ? (
    <CompanyChecklist
      companies={companyChoices.companies}
      value={companyIds}
      onChange={setTickedIds}
      primaryId={primaryCompanyId}
      onPrimaryChange={setChosenPrimary}
      idPrefix="nu-companies"
    />
  ) : null;

  return (
    <ModalPortal>
      <div className={dialogLayer(size)}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className={`keyboard-flow-cramped card relative flex ${dialogPanel(size)} animate-scale-in flex-col overflow-hidden`}>
          {/* The fields scroll; the buttons stay in view — above a phone's keyboard, too. */}
          <form onSubmit={submit} className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
              <h2 className="mb-1 font-display text-xl font-bold text-ink">{title}</h2>
              {error ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              ) : null}
              {twoColumns ? (
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-6">
                  <div data-form-column="person" className="flex min-w-0 flex-col gap-3">{personFields}</div>
                  <div data-form-column={isClient ? 'access' : 'companies'} className="flex min-w-0 flex-col gap-3">{isClient ? accessField : companiesField}</div>
                </div>
              ) : (
                <>
                  {personFields}
                  {isClient ? accessField : companiesField}
                </>
              )}
            </div>
            <div className="flex flex-none items-center gap-2 border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end sm:px-6">
              <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={onClose} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50 sm:flex-none">
                Cancel
              </button>
              <Button type="submit" shortcut="submit" showShortcut loading={createMut.isPending} className="!min-h-[44px] flex-[2] sm:min-w-[9.5rem] sm:flex-none">
                {createMut.isPending ? 'Creating…' : isClient ? 'Create client' : 'Create user'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
