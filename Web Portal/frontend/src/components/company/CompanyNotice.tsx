import { useCompanyStore } from '../../stores/company-store';

/**
 * "You no longer have access to Beta Co. Showing all your companies." — above the page when the
 * picked company was taken away (the server refused it, or it left my list), until dismissed. The
 * company's name keeps its own direction (`<bdi>`). Nothing at all otherwise.
 */
export function CompanyNotice({ frameClass = '' }: { frameClass?: string }) {
  const notice = useCompanyStore((s) => s.notice);
  const name = useCompanyStore((s) => s.noticeName);
  const dismiss = useCompanyStore((s) => s.dismissNotice);
  if (!notice) return null;
  const at = name ? notice.indexOf(name) : -1;
  const text =
    name && at >= 0 ? (
      <>
        {notice.slice(0, at)}
        <bdi>{name}</bdi>
        {notice.slice(at + name.length)}
      </>
    ) : (
      notice
    );
  return (
    <div className={frameClass}>
      <div role="status" data-company-notice className="mt-3 flex items-center gap-3 rounded-xl border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
        <svg className="flex-none" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 7.5v.01" />
        </svg>
        <p className="min-w-0 flex-1">{text}</p>
        <button
          type="button"
          onClick={dismiss}
          className="flex-none rounded-lg px-2.5 py-1 font-semibold transition-colors hover:bg-surface/60 [@media(pointer:coarse)]:!min-h-11"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
