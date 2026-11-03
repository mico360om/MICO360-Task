import { ARCHIVED_NOTICE } from '../../lib/companies';
import { useSignOut } from '../../lib/useSignOut';
import { SignOutWarning } from '../SignOutWarning';
import { Button } from '../ui/Button';
import { BuildingIcon } from './CompanyLogo';

/**
 * The whole page for someone whose companies are all archived (administrators never see it):
 * "archived means no access" (owner, 3 Nov). The menu, Settings, Profile and About still work.
 */
export function ArchivedCompanyState() {
  const { signOut, unsent, cancel } = useSignOut();
  return (
    <div className="mx-auto mt-6 max-w-md">
      <div className="card grid place-items-center gap-3 p-8 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand">
          <BuildingIcon size={24} />
        </div>
        <h1 className="text-base font-semibold text-ink">{ARCHIVED_NOTICE}</h1>
        {unsent !== null ? <SignOutWarning unsent={unsent} onConfirm={() => signOut({ force: true })} onCancel={cancel} className="w-full text-start" /> : null}
        <Button variant="secondary" onClick={() => signOut()} className="mt-1 [@media(pointer:coarse)]:!min-h-11">
          Sign out
        </Button>
      </div>
    </div>
  );
}
