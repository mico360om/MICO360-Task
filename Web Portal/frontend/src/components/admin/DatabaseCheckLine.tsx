import type { DatabaseCheck } from '../../api/error-log';
import { relativeTime } from '../../lib/relative-time';
import { TOUCH_TALL } from '../../lib/touch';
import { Button } from '../ui/Button';

/**
 * 1.23.1 — System Settings → Error log: the server's database self-check at its start, in one line —
 * "Database check: OK (MySQL 8.0.46)" — with the server's exact version and settings beside it, and
 * each problem (a missing table or column, a query this server reads otherwise) listed with its names.
 * 1.23.2: a database that was busy (a connection blip) is a warning, not a failure; "Check again" runs
 * the check now.
 */
export function DatabaseCheckLine({
  check,
  onCheckAgain,
  checking = false,
  checkFailed = false,
}: {
  check: DatabaseCheck;
  onCheckAgain?: () => void;
  checking?: boolean;
  checkFailed?: boolean;
}) {
  const settings = check.server
    ? [
        check.server.version,
        `sql_mode ${check.server.sqlMode || '(none)'}`,
        ...(check.server.lowerCaseTableNames !== null ? [`lower_case_table_names ${check.server.lowerCaseTableNames}`] : []),
        // 1.23.2: the server's connection pool (lib/db-pool on the server).
        ...(typeof check.pool === 'number' ? [`pool ${check.pool}`] : []),
      ].join(' · ')
    : null;
  const state = check.ok ? 'ok' : check.problems.length > 0 && check.problems.every((p) => p.kind === 'busy') ? 'busy' : 'problems';
  const tone = state === 'ok' ? 'text-success' : state === 'busy' ? 'text-warning' : 'text-danger';
  return (
    <section
      data-database-check={state}
      aria-label="Database check"
      className={`card mb-4 px-3 py-2 text-sm ${state === 'problems' ? 'border-danger/40' : state === 'busy' ? 'border-warning/40' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className={`font-semibold ${tone}`}>{check.summary}</span>
          <span className="text-xs text-ink-3">checked {relativeTime(check.checkedAt)}</span>
        </p>
        {onCheckAgain ? (
          <Button variant="secondary" size="sm" loading={checking} onClick={onCheckAgain} className={`flex-none ${TOUCH_TALL}`}>
            {checking ? 'Checking…' : 'Check again'}
          </Button>
        ) : null}
      </div>
      {settings ? <p className="mt-0.5 font-mono text-xs text-ink-2 [overflow-wrap:anywhere]">{settings}</p> : null}
      {checkFailed ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          The check couldn’t run just now — try again.
        </p>
      ) : null}
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
