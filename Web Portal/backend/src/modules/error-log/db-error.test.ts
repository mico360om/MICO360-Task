import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { databaseDiagnosis, maskDatabaseText } from './db-error';

const CLIENT = '5.22.0';
/** A raw query's failure as Prisma 5.22 throws it (P2010, the database's code and message in `meta`). */
const rawFailed = (code: string, message: string, method = '$queryRaw') =>
  new Prisma.PrismaClientKnownRequestError(`\nInvalid \`prisma.${method}()\` invocation:\n\n\nRaw query failed. Code: \`${code}\`. Message: \`${message}\``, { code: 'P2010', clientVersion: CLIENT, meta: { code, message } });

describe('databaseDiagnosis: what a Prisma error says about the database, without typed values', () => {
  it('a raw query that failed: P2010, the database’s code and its message', () => {
    const d = databaseDiagnosis(rawFailed('1038', 'Out of sort memory, consider increasing server sort buffer size'));
    expect(d).toEqual({ code: 'P2010', dbCode: '1038', text: 'P2010 · code 1038 · Out of sort memory, consider increasing server sort buffer size' });
  });

  it('a value the database quotes is masked; column, key and clause names stay', () => {
    const d = databaseDiagnosis(rawFailed('1366', "Incorrect string value: '\\xF0\\x9F\\x98\\x80 Pay Ahmed' for column 'title' at row 1"));
    expect(d!.text).toBe("P2010 · code 1366 · Incorrect string value: '?' for column 'title' at row 1");
    expect(databaseDiagnosis(rawFailed('1062', "Duplicate entry 'khurram@prolens.com' for key 'users.users_email_key'"))!.text).toBe("P2010 · code 1062 · Duplicate entry '?' for key 'users.users_email_key'");
    expect(databaseDiagnosis(rawFailed('1054', "Unknown column 'nosuchcol' in 'order clause'"))!.text).toBe("P2010 · code 1054 · Unknown column 'nosuchcol' in 'order clause'");
    expect(databaseDiagnosis(rawFailed('1267', "Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT) and (binary,COERCIBLE) for operation 'like'"))!.text).toBe(
      "P2010 · code 1267 · Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT) and (binary,COERCIBLE) for operation 'like'",
    );
    expect(databaseDiagnosis(rawFailed('1292', 'Truncated incorrect DOUBLE value: "Villa 12"'))!.text).toBe('P2010 · code 1292 · Truncated incorrect DOUBLE value: "?"');
  });

  it('a syntax error keeps the SQL words near the problem, never the literals or long numbers in them', () => {
    const d = databaseDiagnosis(rawFailed('1064', "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'ESCAPE '!' AND si.doc LIKE 'pay ahmed 99887766' ORDER BY t.id LIMIT 6' at line 1"));
    expect(d!.text).toContain("near 'ESCAPE '?' AND si.doc LIKE '?' ORDER BY t.id LIMIT 6' at line 1");
    expect(d!.text).not.toContain('ahmed');
    expect(d!.text.length).toBeLessThanOrEqual(300);
    // The cut never takes the codes.
    expect(d!.text.startsWith('P2010 · code 1064 · You have an error in your SQL syntax')).toBe(true);
  });

  it('long numbers are masked, short ones (rows, lines, sizes) stay', () => {
    expect(maskDatabaseText('Out of range value for column x at row 1: 96891234567')).toBe('Out of range value for column x at row 1: ?');
    expect(maskDatabaseText("Can't create more than max_prepared_stmt_count statements (current value: 16382)")).toBe("Can't create more than max_prepared_stmt_count statements (current value: 16382)");
  });

  it('emails and tokens the database repeats are masked too', () => {
    expect(maskDatabaseText('Access denied for user khurram@prolens-team.com')).not.toContain('khurram');
  });

  it('without meta, the “Message: `…`” part of the text', () => {
    const e = new Prisma.PrismaClientKnownRequestError("\nInvalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `3024`. Message: `Query execution was interrupted, maximum statement execution time exceeded`", { code: 'P2010', clientVersion: CLIENT });
    expect(databaseDiagnosis(e)).toEqual({ code: 'P2010', dbCode: '3024', text: 'P2010 · code 3024 · Query execution was interrupted, maximum statement execution time exceeded' });
  });

  it('a driver failure (“N/A”) keeps only what Prisma said', () => {
    expect(databaseDiagnosis(rawFailed('N/A', 'N/A'))).toEqual({ code: 'P2010', dbCode: null, text: 'P2010 · N/A' });
  });

  it('other known errors: the code and the line after “Invalid … invocation:”', () => {
    const unique = new Prisma.PrismaClientKnownRequestError('\nInvalid `prisma.user.create()` invocation:\n\n\nUnique constraint failed on the constraint: `users_email_key`', { code: 'P2002', clientVersion: CLIENT, meta: { modelName: 'User', target: 'users_email_key' } });
    expect(databaseDiagnosis(unique)).toEqual({ code: 'P2002', dbCode: null, text: 'P2002 · Unique constraint failed on the constraint: `users_email_key`' });
    const pool = new Prisma.PrismaClientKnownRequestError('\nInvalid `prisma.$queryRaw()` invocation:\n\n\nTimed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 10, connection limit: 5)', { code: 'P2024', clientVersion: CLIENT, meta: { modelName: undefined, connection_limit: 5, timeout: 10 } });
    expect(databaseDiagnosis(pool)!.text).toBe('P2024 · Timed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 10, connection limit: 5)');
  });

  it('an unknown request error: the database’s code and message from the connector’s words', () => {
    const e = new Prisma.PrismaClientUnknownRequestError(
      '\nInvalid `prisma.task.findMany()` invocation:\n\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(Server(MysqlError { code: 1038, message: "Out of sort memory, consider increasing server sort buffer size", state: "HY001" })), transient: false })',
      { clientVersion: CLIENT },
    );
    expect(databaseDiagnosis(e)).toEqual({ code: null, dbCode: '1038', text: 'code 1038 · Out of sort memory, consider increasing server sort buffer size' });
    const other = new Prisma.PrismaClientUnknownRequestError("\nInvalid `prisma.task.update()` invocation:\n\n\nError occurred during query execution:\nConnectorError(ConnectorError { kind: ConversionError(\"value 'Pay Ahmed' is bad\") })", { clientVersion: CLIENT });
    const t = databaseDiagnosis(other)!.text;
    expect(t.startsWith('Error occurred during query execution: ConnectorError(')).toBe(true);
    expect(t).not.toContain('Ahmed');
  });

  it('a validation error: its message line, never the arguments it prints (they hold what was typed)', () => {
    const e = new Prisma.PrismaClientValidationError('\nInvalid `prisma.task.findMany()` invocation:\n\n{\n  where: {\n    titl: "Pay Ahmed 500",\n    ~~~~\n?   AND?: TaskWhereInput | TaskWhereInput[],\n?   title?: StringFilter | String\n  }\n}\n\nUnknown argument `titl`. Did you mean `title`? Available options are marked with ?.', { clientVersion: CLIENT });
    const d = databaseDiagnosis(e)!;
    expect(d).toEqual({ code: null, dbCode: null, text: 'Unknown argument `titl`. Did you mean `title`? Available options are marked with ?.' });
    // A pretty error's code frame is not the message either.
    const pretty = new Prisma.PrismaClientValidationError('\nInvalid `prisma.task.findMany()` invocation in\n/srv/app/dist/src/modules/tasks/repo.js:12:5\n\n  9 |\n→ 12   prisma.task.findMany({ where: { titl: "Pay Ahmed" } })\n\nUnknown argument `titl`.', { clientVersion: CLIENT });
    expect(databaseDiagnosis(pretty)!.text).toBe('Unknown argument `titl`.');
  });

  it('not a Prisma error: nothing (the Error log keeps those as before)', () => {
    expect(databaseDiagnosis(new Error('Raw query failed. Code: `1064`. Message: `x`'))).toBeNull();
    expect(databaseDiagnosis({ name: 'Error', code: 'P2010', meta: { code: '1064', message: 'x' } })).toBeNull();
    expect(databaseDiagnosis('text')).toBeNull();
    expect(databaseDiagnosis(null)).toBeNull();
  });

  it('never throws, even on an error whose fields can’t be read', () => {
    const hostile = Object.create(Prisma.PrismaClientKnownRequestError.prototype, { name: { get: () => 'PrismaClientKnownRequestError' }, meta: { get: () => { throw new Error('getter'); } } });
    expect(() => databaseDiagnosis(hostile)).not.toThrow();
  });

  it('fast on hostile text', () => {
    const t = performance.now();
    databaseDiagnosis(rawFailed('1064', `${"'".repeat(5000)}${'near '.repeat(2000)}${'`'.repeat(3000)}`));
    maskDatabaseText(`${"a'b\"c`".repeat(4000)}${'9'.repeat(5000)}`);
    expect(performance.now() - t).toBeLessThan(50);
  });
});

// 1.23.1 — the live search error read "Unknown column '?' in '?'": MariaDB's "Unknown column '0' in
// 'ORDER BY'", both names masked. Names of columns, tables, aliases, keys, constraints and clauses are
// the statement's own words, never what someone typed: they stay. Values stay masked.
describe('maskDatabaseText: schema names stay (MySQL and MariaDB wording), values never', () => {
  const said = (code: string, message: string) => databaseDiagnosis(rawFailed(code, message))!.text;

  it('1054 Unknown column: the column (even a position or an expression) and the clause, MariaDB’s and MySQL’s', () => {
    expect(said('1054', "Unknown column '0' in 'ORDER BY'")).toBe("P2010 · code 1054 · Unknown column '0' in 'ORDER BY'");
    expect(said('1054', "Unknown column 'si.head' in 'order clause'")).toBe("P2010 · code 1054 · Unknown column 'si.head' in 'order clause'");
    expect(said('1054', "Unknown column 'x' in 'field list'")).toBe("P2010 · code 1054 · Unknown column 'x' in 'field list'");
    for (const clause of ['WHERE', 'ON', 'GROUP BY', 'HAVING', 'SELECT', 'FROM', 'IN/ALL/ANY', 'IN/ALL/ANY subquery', 'checking transformed subquery', 'group statement', 'having clause', 'on clause']) {
      expect(maskDatabaseText(`Unknown column 'lpc.projectId' in '${clause}'`)).toBe(`Unknown column 'lpc.projectId' in '${clause}'`);
    }
    expect(maskDatabaseText("Unknown column '<cache>(p.id)' in 'IN/ALL/ANY'")).toBe("Unknown column '<cache>(p.id)' in 'IN/ALL/ANY'");
    expect(maskDatabaseText("Unknown column 'FALSE' in 'ORDER BY'")).toBe("Unknown column 'FALSE' in 'ORDER BY'");
  });

  it('tables, aliases and ambiguous columns', () => {
    expect(said('1146', "Table 'u851_mico.task_search_index' doesn't exist")).toBe("P2010 · code 1146 · Table 'u851_mico.task_search_index' doesn't exist");
    expect(maskDatabaseText("Unknown table 'lc' in field list")).toBe("Unknown table 'lc' in field list");
    expect(maskDatabaseText("Not unique table/alias: 'lpc'")).toBe("Not unique table/alias: 'lpc'");
    expect(maskDatabaseText("Column 'id' in where clause is ambiguous")).toBe("Column 'id' in where clause is ambiguous");
    expect(maskDatabaseText("Column 'projectId' in WHERE is ambiguous")).toBe("Column 'projectId' in WHERE is ambiguous");
  });

  it('column and key names in duplicates, sizes, nulls and defaults; the value masked', () => {
    expect(maskDatabaseText("Duplicate column name 'head'")).toBe("Duplicate column name 'head'");
    expect(maskDatabaseText("Duplicate key name 'tasks_projectId_idx'")).toBe("Duplicate key name 'tasks_projectId_idx'");
    expect(maskDatabaseText("Data too long for column 'title' at row 1")).toBe("Data too long for column 'title' at row 1");
    expect(maskDatabaseText("Column 'projectId' cannot be null")).toBe("Column 'projectId' cannot be null");
    expect(maskDatabaseText("Field 'stamp' doesn't have a default value")).toBe("Field 'stamp' doesn't have a default value");
    expect(maskDatabaseText("Duplicate entry 'Pay Ahmed-p1' for key 'tasks.tasks_title_projectId_key'")).toBe("Duplicate entry '?' for key 'tasks.tasks_title_projectId_key'");
  });

  it('MariaDB’s `db`.`table`.`column` and a foreign key’s names (backticks) stay; the value doesn’t', () => {
    expect(maskDatabaseText("Incorrect string value: '\xF0\x9F\x98\x80 Pay Ahmed' for column `u851_mico`.`tasks`.`title` at row 1")).toBe(
      "Incorrect string value: '?' for column `u851_mico`.`tasks`.`title` at row 1",
    );
    expect(
      maskDatabaseText('Cannot add or update a child row: a foreign key constraint fails (`mico`.`task_search_index`, CONSTRAINT `task_search_index_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE)'),
    ).toBe('Cannot add or update a child row: a foreign key constraint fails (`mico`.`task_search_index`, CONSTRAINT `task_search_index_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE)');
  });

  it('a value in a clause’s place, or a typed value as a name, is still masked', () => {
    expect(maskDatabaseText("Truncated incorrect INTEGER value: 'Pay Ahmed'")).toBe("Truncated incorrect INTEGER value: '?'");
    expect(maskDatabaseText("BIGINT UNSIGNED value is out of range in '(`mico`.`t`.`n` - 99887766)'")).not.toContain('99887766');
    expect(maskDatabaseText("Unknown column 'khurram@prolens-team.com' in 'where clause'")).not.toContain('khurram');
  });

  it('the database server’s address and a user name in a connection error are never kept', () => {
    const p1001 = new Prisma.PrismaClientKnownRequestError("\nInvalid `prisma.task.findMany()` invocation:\n\n\nCan't reach database server at `srv123.hstgr.io`:`3306`\n\nPlease make sure your database server is running at `srv123.hstgr.io`:`3306`.", { code: 'P1001', clientVersion: CLIENT, meta: { database_host: 'srv123.hstgr.io', database_port: 3306 } });
    const t = databaseDiagnosis(p1001)!.text;
    expect(t.startsWith("P1001 · Can't reach database server at")).toBe(true);
    expect(t).not.toContain('hstgr');
    expect(t).not.toContain('3306');
    const auth = maskDatabaseText('Authentication failed against database server at `127.0.0.1`, the provided database credentials for `u851_admin` are not valid.');
    expect(auth).not.toContain('127.0.0.1');
    expect(auth).not.toContain('u851_admin');
  });
});
