// Rehearses the companies migration on a throwaway copy of a database, and checks its result.
//
//   node scripts/rehearse-multi-company.mjs --db mico360_t_<name> [--sql <dump.sql>]
//        [--server mysql://user:password@127.0.0.1:3306] [--mysql <path to mysql.exe>]
//
// Drops and re-creates --db (only names starting mico360_t_ are allowed). With --sql it loads that dump
// (a site before the companies migration) and runs `prisma migrate deploy`; without, it migrates an
// empty database and runs the demo seed. Then it checks that everything is in the first company:
//   one company (the default) and no other; every person a member and with a primary company; every
//   project in it with its main company; every meeting without a project with a company;
//   and, with --sql, that no existing row was added or removed.
// Finally it runs the backfill file again and checks that nothing changes. Prints the counts, then
// "REHEARSAL OK" (exit 0) or "REHEARSAL FAILED: …" (exit 1).
// Run from the backend app root, after `npm ci` and `prisma generate`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Must match DEFAULT_COMPANY and BACKFILL_MIGRATION in src/modules/companies/default-company.ts
// (default-company.test.ts checks that it does).
const DEFAULT_COMPANY = { id: 'company_prolens', name: 'Prolens Projects LLC', code: 'PPL' };
const BACKFILL_SQL = path.join(ROOT, 'prisma', 'migrations', '20261031200100_multi_company_backfill', 'migration.sql');

function args() {
  const a = process.argv.slice(2);
  const get = (name) => {
    const i = a.indexOf(name);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const db = get('--db');
  if (!db || !/^mico360_t_[a-z0-9_]+$/.test(db)) throw new Error('give --db mico360_t_<name> (only throwaway mico360_t_ databases)');
  const sqlFile = get('--sql');
  if (sqlFile && !existsSync(sqlFile)) throw new Error(`no such dump: ${sqlFile}`);
  const server = (get('--server') ?? process.env.REHEARSAL_SERVER ?? 'mysql://mico:mico@127.0.0.1:3306').replace(/\/+$/, '');
  const portable = 'D:/mico-mysql/mysql-8.0.46-winx64/bin/mysql.exe';
  const mysql = get('--mysql') ?? process.env.MYSQL_BIN ?? (existsSync(portable) ? portable : 'mysql');
  return { db, sqlFile, server, mysql };
}

/** The backfill file's statements: `--` comment lines dropped, split on a `;` that ends a line. */
export function backfillStatements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const { db, sqlFile, server, mysql } = args();
  const u = new URL(server);
  const client = (database, input) =>
    execFileSync(mysql, [`-u${decodeURIComponent(u.username)}`, `-p${decodeURIComponent(u.password)}`, `-h${u.hostname}`, `-P${u.port || '3306'}`, '--default-character-set=utf8mb4', ...(database ? [database] : [])], {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    });
  const url = `${server}/${db}`;
  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'development' };
  const run = (cmd) => execFileSync(cmd, { cwd: ROOT, env, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  client(null, `DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const failures = [];
  const check = (ok, what) => {
    if (!ok) failures.push(what);
  };
  const one = async (q) => Number(Object.values((await prisma.$queryRawUnsafe(q))[0])[0]);
  const TABLES = ['users', 'projects', 'tasks', 'meetings', 'notifications'];
  const rows = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await one(`SELECT COUNT(*) FROM \`${t}\``)])));
  try {
    let before = null;
    if (sqlFile) {
      client(db, readFileSync(sqlFile, 'utf8'));
      before = await rows();
      run('npx --no-install prisma migrate deploy');
    } else {
      run('npx --no-install prisma migrate deploy');
      run('npm run db:seed');
    }

    const counts = async () => ({
      ...(await rows()),
      companies: await one('SELECT COUNT(*) FROM companies'),
      companyMembers: await one('SELECT COUNT(*) FROM company_members'),
      projectCompanies: await one('SELECT COUNT(*) FROM project_companies'),
      usersWithoutCompany: await one('SELECT COUNT(*) FROM users u WHERE NOT EXISTS (SELECT 1 FROM company_members m WHERE m.userId = u.id)'),
      usersWithoutPrimary: await one('SELECT COUNT(*) FROM users WHERE primaryCompanyId IS NULL'),
      primaryNotAMembership: await one('SELECT COUNT(*) FROM users u WHERE u.primaryCompanyId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM company_members m WHERE m.userId = u.id AND m.companyId = u.primaryCompanyId)'),
      projectsWithoutCompany: await one('SELECT COUNT(*) FROM projects p WHERE NOT EXISTS (SELECT 1 FROM project_companies c WHERE c.projectId = p.id)'),
      projectsWithoutMain: await one('SELECT COUNT(*) FROM projects WHERE mainCompanyId IS NULL'),
      mainNotACompany: await one('SELECT COUNT(*) FROM projects p WHERE p.mainCompanyId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_companies c WHERE c.projectId = p.id AND c.companyId = p.mainCompanyId)'),
      standaloneMeetingsWithoutCompany: await one('SELECT COUNT(*) FROM meetings WHERE projectId IS NULL AND companyId IS NULL'),
      projectMeetingsWithCompany: await one('SELECT COUNT(*) FROM meetings WHERE projectId IS NOT NULL AND companyId IS NOT NULL'),
      noticesWithProject: await one('SELECT COUNT(*) FROM notifications WHERE projectId IS NOT NULL'),
    });

    const after = await counts();
    const company = await prisma.company.findMany({ select: { id: true, name: true, code: true, status: true } });
    check(company.length === 1 && company[0].id === DEFAULT_COMPANY.id, `exactly one company, ${DEFAULT_COMPANY.id} (found ${JSON.stringify(company)})`);
    check(company[0]?.name === DEFAULT_COMPANY.name && company[0]?.code === DEFAULT_COMPANY.code && company[0]?.status === 'ACTIVE', 'the default company is "Prolens Projects LLC", PPL, active');
    check(after.companyMembers >= after.users, 'company_members ≥ users');
    check(after.usersWithoutCompany === 0, 'every person is in a company');
    check(after.usersWithoutPrimary === 0 && after.primaryNotAMembership === 0, 'every person has a primary company they belong to');
    check(after.projectsWithoutCompany === 0, 'every project is in a company');
    check(after.projectsWithoutMain === 0 && after.mainNotACompany === 0, "every project's main company is one of its companies");
    check(after.standaloneMeetingsWithoutCompany === 0, 'every meeting without a project has a company');
    check(after.projectMeetingsWithCompany === 0, 'project meetings keep no company of their own');
    if (before) for (const t of TABLES) check(before[t] === after[t], `${t}: ${before[t]} rows before, ${after[t]} after`);

    // The backfill a second time: nothing changes.
    for (const statement of backfillStatements(readFileSync(BACKFILL_SQL, 'utf8'))) await prisma.$executeRawUnsafe(statement);
    const again = await counts();
    check(JSON.stringify(again) === JSON.stringify(after), `the backfill run again changed the counts: ${JSON.stringify(again)}`);

    console.log(JSON.stringify({ db, source: sqlFile ?? 'demo seed', before, after }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
  if (failures.length) {
    for (const f of failures) console.log(`REHEARSAL FAILED: ${f}`);
    process.exitCode = 1;
  } else {
    console.log('REHEARSAL OK');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`REHEARSAL FAILED: ${err instanceof Error ? err.message : String(err)}`);
    if (err && typeof err === 'object' && 'stderr' in err && err.stderr) console.log(String(err.stderr).slice(-2000));
    process.exitCode = 1;
  });
}
