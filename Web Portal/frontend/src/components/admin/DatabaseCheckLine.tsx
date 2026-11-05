import type { DatabaseCheck } from '../../api/error-log';
import { relativeTime } from '../../lib/relative-time';

/**
 * 1.23.1 — System Settings → Error log: the server's database self-check at its start, in one line —
 * "Database check: OK (MySQL 8.0.46)" — with the server's exact version and settings beside it, and
 * each problem (a missing table or column, a query this server reads otherwise) listed with its names.
 */
export function DatabaseCheckLine({ check }: { check: DatabaseCheck }) {
  const settings = check.server
    ? [check.server.version, `sql_mode ${check.server.sqlMode || '(none)'}`, ...(check.server.lowerCaseTableNames !== null ? [`lower_case_table_names ${check.server.lowerCaseTableNames}`] : [])].join(' · ')
    : null;
  return (
    <section
      data-database-check={check.ok ? 'ok' : 'problems'}
      aria-label="Database check"
      className={`card mb-4 px-3 py-2 text-sm ${check.ok ? '' : 'border-danger/40'}`}
    >
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className={`font-semibold ${check.ok ? 'text-success' : 'text-danger'}`}>{check.summary}</span>
        <span className="text-xs text-ink-3">checked {relativeTime(check.checkedAt)}</span>
      </p>
      {settings ? <p className="mt-0.5 font-mono text-xs text-ink-2 [overflow-wrap:anywhere]">{settings}</p> : null}
      {check.problems.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink">
          {check.problems.map((p) => (
            <li key={`${p.kind}:${p.name}`} className="break-words">
              {p.text}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
