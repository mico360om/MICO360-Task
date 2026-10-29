import type { SqlRunner } from './sql-runner';

/**
 * Reading every table out of the database and writing it back, with plain SQL (no mysqldump: it is
 * not on every host). Each value is read in a text form that MySQL and MariaDB turn back into exactly
 * the same value: datetimes with their fraction, binary data as base64, doubles as numbers, the rest
 * as text. Tables are read page by page in primary-key order.
 */

export interface ColumnInfo {
  name: string;
  /** information_schema DATA_TYPE, lower case (varchar, datetime, json, mediumblob, …). */
  type: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  primaryKey: string[];
}

export interface ForeignKey {
  table: string;
  references: string;
}

const TEXT = new Set(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set', 'json']);
const EXACT = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'year', 'time']);
const FLOATING = new Set(['float', 'double', 'real']);
const DATETIME = new Set(['datetime', 'timestamp']);
const BINARY = new Set(['tinyblob', 'blob', 'mediumblob', 'longblob', 'binary', 'varbinary']);

export function quoteId(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

/** How a column is read for the backup. */
export function selectExpression(col: ColumnInfo): string {
  const c = quoteId(col.name);
  const t = col.type.toLowerCase();
  if (DATETIME.has(t)) return `DATE_FORMAT(${c}, '%Y-%m-%d %H:%i:%s.%f')`;
  if (t === 'date') return `DATE_FORMAT(${c}, '%Y-%m-%d')`;
  if (BINARY.has(t)) return `TO_BASE64(${c})`;
  if (FLOATING.has(t)) return c;
  if (t === 'bit') return `CAST(${c} + 0 AS CHAR)`;
  if (TEXT.has(t) || EXACT.has(t)) return `CAST(${c} AS CHAR)`;
  throw new Error(`The backup can't copy column ${col.name} (type ${col.type}).`);
}

/** How a backed-up value is written back (the placeholder for one value). */
export function valueExpression(col: ColumnInfo): string {
  const t = col.type.toLowerCase();
  if (BINARY.has(t)) return 'FROM_BASE64(?)';
  if (t === 'bit') return 'CAST(? AS UNSIGNED)';
  return '?';
}

/** One page of a table: after the last key read (`afterKey`), or by offset when it has no primary key. */
export function pageQuery(table: TableInfo, limit: number, afterKey: boolean, offset = 0): string {
  const cols = table.columns.map((c, i) => `${selectExpression(c)} AS c${i}`).join(', ');
  const from = `SELECT ${cols} FROM ${quoteId(table.name)}`;
  if (!table.primaryKey.length) {
    const order = table.columns.map((c) => quoteId(c.name)).join(', ');
    return `${from} ORDER BY ${order} LIMIT ${limit}${offset ? ` OFFSET ${offset}` : ''}`;
  }
  const keys = table.primaryKey.map(quoteId);
  const order = ` ORDER BY ${keys.join(', ')} LIMIT ${limit}`;
  if (!afterKey) return `${from}${order}`;
  const placeholders = table.primaryKey.map((k) => valueExpression(table.columns.find((c) => c.name === k) ?? { name: k, type: 'varchar' }));
  return `${from} WHERE (${keys.join(', ')}) > (${placeholders.join(', ')})${order}`;
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  if (typeof value === 'object' && value && 'toFixed' in value) return String(value); // Decimal
  return value;
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Every row of a table, as arrays of values in column order. Between pages it gives the server's
 * other work its turn (and waits `pauseMs`), so the app stays responsive while a backup runs.
 */
export async function* dumpRows(sql: SqlRunner, table: TableInfo, batch = 500, pauseMs = 0): AsyncGenerator<unknown[]> {
  const keyIndex = table.primaryKey.map((k) => table.columns.findIndex((c) => c.name === k));
  let after: unknown[] | null = null;
  let offset = 0;
  while (true) {
    const rows: Record<string, unknown>[] = await sql.query<Record<string, unknown>>(pageQuery(table, batch, after !== null, offset), ...(after ?? []));
    let last: unknown[] | null = null;
    for (const r of rows) {
      last = table.columns.map((_, i): unknown => normalize(r[`c${i}`]));
      yield last;
    }
    if (rows.length < batch || !last) return;
    const lastRow: unknown[] = last;
    if (table.primaryKey.length) after = keyIndex.map((i): unknown => lastRow[i]);
    else offset += rows.length;
    await nextTurn();
    if (pauseMs) await sleep(pauseMs);
  }
}

/** The database's tables (base tables only) with their columns and primary keys. */
export async function listTables(sql: SqlRunner): Promise<TableInfo[]> {
  const tables = await sql.query<{ t: string }>("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
  const columns = await sql.query<{ t: string; c: string; type: string; extra: string | null }>(
    'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS type, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION',
  );
  const keys = await sql.query<{ t: string; c: string }>(
    "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY TABLE_NAME, ORDINAL_POSITION",
  );
  return tables.map(({ t }) => ({
    name: t,
    // Generated columns are worked out by the database itself and can't be written.
    columns: columns.filter((c) => c.t === t && !/\b(VIRTUAL|STORED|PERSISTENT) GENERATED\b/i.test(c.extra ?? '')).map((c) => ({ name: c.c, type: String(c.type).toLowerCase() })),
    primaryKey: keys.filter((k) => k.t === t).map((k) => k.c),
  }));
}

export async function listForeignKeys(sql: SqlRunner): Promise<ForeignKey[]> {
  return sql.query<ForeignKey>(
    'SELECT DISTINCT TABLE_NAME AS `table`, REFERENCED_TABLE_NAME AS `references` FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL',
  );
}

/**
 * Tables in an order where every table comes after the tables it points to (a table pointing at
 * itself is fine; a cycle is broken alphabetically). The restore loads them in this order.
 */
export function fkSafeOrder(tables: string[], fks: ForeignKey[]): string[] {
  const parents = new Map(tables.map((t) => [t, new Set<string>()] as const));
  for (const fk of fks) if (fk.table !== fk.references && parents.has(fk.table) && parents.has(fk.references)) parents.get(fk.table)!.add(fk.references);
  const order: string[] = [];
  const left = new Set([...tables].sort());
  while (left.size) {
    const ready = [...left].find((t) => [...parents.get(t)!].every((p) => !left.has(p))) ?? [...left][0]!;
    order.push(ready);
    left.delete(ready);
  }
  return order;
}

/** Splits rows into INSERT statements that stay under a size and a placeholder limit. */
export function* insertBatches(
  table: TableInfo,
  rows: unknown[][],
  limits: { maxRows?: number; maxBytes?: number } = {},
): Generator<{ sql: string; params: unknown[]; rows: unknown[][] }> {
  const maxRows = Math.max(1, Math.min(limits.maxRows ?? 500, Math.floor(30_000 / Math.max(1, table.columns.length))));
  const maxBytes = limits.maxBytes ?? 1_000_000;
  const head = `INSERT INTO ${quoteId(table.name)} (${table.columns.map((c) => quoteId(c.name)).join(', ')}) VALUES `;
  const tuple = `(${table.columns.map(valueExpression).join(', ')})`;
  let batch: unknown[][] = [];
  let bytes = 0;
  const flush = () => {
    const out = { sql: head + batch.map(() => tuple).join(', '), params: batch.flat(), rows: batch };
    batch = [];
    bytes = 0;
    return out;
  };
  for (const row of rows) {
    const size = row.reduce<number>((n, v) => n + (typeof v === 'string' ? v.length : 8), 0);
    if (batch.length && (batch.length >= maxRows || bytes + size > maxBytes)) yield flush();
    batch.push(row);
    bytes += size;
  }
  if (batch.length) yield flush();
}
