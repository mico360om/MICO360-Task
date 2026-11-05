import { Prisma, type PrismaClient } from '@prisma/client';
import { databaseDiagnosis } from './db-error';
import { redactText } from './error-redact';

/**
 * 1.23.1 — the database self-check. The live search failed with "Unknown column" (1054) although every
 * column it reads is in the schema and nothing failed on our MySQL or in the upgrade rehearsal: the
 * live database differed (its server, its settings or its tables). At start-up, once the database
 * answers (never holding the start up), the server now:
 *
 *   - reads the server's version, sql_mode and lower_case_table_names (`SELECT VERSION()…`);
 *   - compares the database's tables and columns (information_schema) with every model and field of
 *     the Prisma schema — table names exactly where the server says they are case-sensitive (Linux);
 *   - runs each raw-SQL family once in a harmless form (nothing found, nothing written) — the task
 *     search, search everything, the Management page's figures — to catch what a server reads otherwise.
 *
 * Each problem goes to the Error log once (kind Server, job "database check") with the exact names and
 * the server's version and settings; System Settings → Error log shows the result ("Database check: OK
 * (MySQL 8.0.46)" or the problems). Never the database's address, user or name.
 */
export interface DatabaseServer {
  product: 'MySQL' | 'MariaDB';
  /** VERSION() as the server says it ("11.4.5-MariaDB-log"). */
  version: string;
  sqlMode: string;
  lowerCaseTableNames: number | null;
}

export interface DatabaseProblem {
  kind: 'server' | 'table' | 'column' | 'query';
  /** The table, `table.column` or query family it is about. */
  name: string;
  /** In words, with the exact names. */
  text: string;
}

export interface DatabaseCheckResult {
  checkedAt: string;
  ok: boolean;
  server: DatabaseServer | null;
  problems: DatabaseProblem[];
  /** "Database check: OK (MySQL 8.0.46)", "Database check: 2 problems (MariaDB 11.4.5)". */
  summary: string;
}

export interface ExpectedTable {
  table: string;
  columns: string[];
}

export interface DatabaseCheckDeps {
  readServer: () => Promise<{ version: string; sqlMode: string; lowerCaseTableNames: number | null }>;
  /** Every table's columns in the app's database, as information_schema names them. */
  readColumns: () => Promise<{ table: string; column: string }[]>;
  /** What the app expects (default: the Prisma schema, expectedSchema()). */
  expected?: ExpectedTable[];
  /** Each raw-SQL family once, in a harmless form. */
  probes: { name: string; run: () => Promise<unknown> }[];
  /** Into the Error log (the server: logger.job('database check').error). */
  record: (problem: { text: string; err?: unknown }) => void;
  now?: () => Date;
}

/** At most this many problems are recorded one by one; the rest as one line. */
export const MAX_RECORDED = 20;

/** The tables and columns the Prisma schema says the app uses: every model, its scalar and enum fields. */
export function expectedSchema(models: readonly Prisma.DMMF.Model[] = Prisma.dmmf.datamodel.models): ExpectedTable[] {
  return models.map((m) => ({
    table: m.dbName ?? m.name,
    columns: m.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => (f as { dbName?: string | null }).dbName ?? f.name),
  }));
}

const shortVersion = (v: string) => /^\d+(?:\.\d+)*/.exec(v)?.[0] ?? v;
const productOf = (v: string): DatabaseServer['product'] => (/mariadb/i.test(v) ? 'MariaDB' : 'MySQL');

/** "MariaDB 11.4.5 (11.4.5-MariaDB-log) · sql_mode … · lower_case_table_names 0". */
export function serverLabel(s: { version: string; sqlMode: string; lowerCaseTableNames: number | null }): string {
  const short = shortVersion(s.version);
  const parts = [`${productOf(s.version)} ${short}${short !== s.version ? ` (${s.version})` : ''}`, `sql_mode ${s.sqlMode || '(none)'}`];
  if (s.lowerCaseTableNames !== null) parts.push(`lower_case_table_names ${s.lowerCaseTableNames}`);
  return parts.join(' · ');
}

const said = (err: unknown): string => {
  const d = databaseDiagnosis(err);
  if (d) return d.text;
  const first = (err instanceof Error ? err.message : String(err)).split('\n').map((l) => l.trim()).find(Boolean) ?? 'failed';
  return redactText(first, 200);
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function createDatabaseCheck(deps: DatabaseCheckDeps) {
  const now = deps.now ?? (() => new Date());
  let latest: DatabaseCheckResult | null = null;

  async function run(): Promise<DatabaseCheckResult> {
    const problems: (DatabaseProblem & { err?: unknown })[] = [];
    let server: DatabaseServer | null = null;
    try {
      const s = await deps.readServer();
      server = { product: productOf(s.version), version: s.version, sqlMode: s.sqlMode, lowerCaseTableNames: s.lowerCaseTableNames };
    } catch (err) {
      problems.push({ kind: 'server', name: 'server', text: 'The database server’s version and settings couldn’t be read', err });
    }

    try {
      const actual = await deps.readColumns();
      const exact = server?.lowerCaseTableNames === 0 || server?.lowerCaseTableNames == null;
      const tables = new Map<string, Set<string>>();
      for (const { table, column } of actual) {
        if (!tables.has(table)) tables.set(table, new Set());
        tables.get(table)!.add(column.toLowerCase());
      }
      const byLower = new Map<string, string>();
      for (const t of tables.keys()) byLower.set(t.toLowerCase(), t);
      for (const want of deps.expected ?? expectedSchema()) {
        const found = tables.has(want.table) ? want.table : exact ? null : (byLower.get(want.table.toLowerCase()) ?? null);
        if (!found) {
          const other = byLower.get(want.table.toLowerCase());
          problems.push({
            kind: 'table',
            name: want.table,
            text: other && other !== want.table ? `Table ${want.table} is missing (there is a table ${other}: table names are case-sensitive on this server)` : `Table ${want.table} is missing`,
          });
          continue;
        }
        const columns = tables.get(found)!;
        for (const c of want.columns) if (!columns.has(c.toLowerCase())) problems.push({ kind: 'column', name: `${want.table}.${c}`, text: `Column ${want.table}.${c} is missing` });
      }
    } catch (err) {
      problems.push({ kind: 'server', name: 'columns', text: 'The database’s tables and columns couldn’t be read', err });
    }

    for (const probe of deps.probes) {
      try {
        await probe.run();
      } catch (err) {
        problems.push({ kind: 'query', name: probe.name, text: `${capital(probe.name)} fails: ${said(err)}`, err });
      }
    }

    const label = server ? serverLabel(server) : null;
    const tail = label ? ` — ${label}` : '';
    problems.slice(0, MAX_RECORDED).forEach((p) => {
      try {
        const text = p.kind === 'query' ? `Database check: ${p.name} fails${tail}` : `Database check: ${p.text}${tail}`;
        deps.record(p.err !== undefined ? { text, err: p.err } : { text });
      } catch {
        // Recording can never stop the check.
      }
    });
    if (problems.length > MAX_RECORDED) {
      try {
        deps.record({ text: `Database check: ${problems.length - MAX_RECORDED} more problems (see System Settings → Error log)${tail}` });
      } catch {
        // As above.
      }
    }

    const named = server ? ` (${server.product} ${shortVersion(server.version)})` : '';
    const n = problems.length;
    latest = {
      checkedAt: now().toISOString(),
      ok: n === 0,
      server,
      problems: problems.map(({ kind, name, text }) => ({ kind, name, text })),
      summary: n === 0 ? `Database check: OK${named}` : `Database check: ${n} ${n === 1 ? 'problem' : 'problems'}${named}`,
    };
    return latest;
  }

  return { run, latest: () => latest };
}

export type DatabaseCheck = ReturnType<typeof createDatabaseCheck>;

/** The server's own reads for the check (raw SQL that MySQL and MariaDB both read the same way). */
export function prismaDatabaseReads(prisma: PrismaClient): Pick<DatabaseCheckDeps, 'readServer' | 'readColumns'> {
  return {
    async readServer() {
      const [row] = await prisma.$queryRaw<{ version: string; sqlMode: string | null; lctn: number | bigint | string | null }[]>`SELECT VERSION() AS version, @@SESSION.sql_mode AS sqlMode, @@lower_case_table_names AS lctn`;
      const n = row?.lctn === null || row?.lctn === undefined ? null : Number(row.lctn);
      return { version: String(row?.version ?? 'unknown'), sqlMode: String(row?.sqlMode ?? ''), lowerCaseTableNames: Number.isFinite(n) ? n : null };
    },
    async readColumns() {
      const rows = await prisma.$queryRaw<{ t: string; c: string }[]>`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`;
      return rows.map((r) => ({ table: String(r.t), column: String(r.c) }));
    },
  };
}
