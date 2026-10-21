// Reports and exports in the extension, against a local server: the admin-only Reports screen
// (filters, tiles, tables), Excel / PDF / CSV exports that follow the filters, a task's export from
// its drawer, and an employee who has no Reports.
//   node tools/extension-e2e/reports.mjs        (see lib.mjs for the settings; also MICO_E2E_EMPLOYEE,
//   default omar@mico360.test with the same password)
import fs from 'node:fs';
import path from 'node:path';
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, sleep } from './lib.mjs';

const out = outDir('reports');
const dlDir = path.join(out, 'downloads');
fs.mkdirSync(dlDir, { recursive: true });
const { ck, error, done } = checks();
const admin = credentials();
const employee = credentials(process.env.MICO_E2E_EMPLOYEE || 'omar@mico360.test');
const server = await apiSession(admin);
const api = (p) => server.call('GET', p);
const projects = (await api('/reports/projects')).data;
const project = [...projects].sort((a, b) => b.total - a.total)[0];
const task = (await api(`/tasks?projectId=${project.projectId}`)).data[0];

/** Wait for a new file in the downloads folder (not a .crdownload). */
async function waitForDownload(before, prefix, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Only our file: headless Chrome also drops its own component downloads (downloads.htm) here.
    const now = fs.readdirSync(dlDir).filter((f) => !f.endsWith('.crdownload') && !before.includes(f) && f.startsWith(prefix));
    if (now.length) { await sleep(300); return now[0]; }
    await sleep(250);
  }
  return null;
}
const head = (f, n = 4) => fs.readFileSync(path.join(dlDir, f)).subarray(0, n).toString('latin1');

const browser = await launch({ name: 'reports', downloads: dlDir, height: 1000 });
try {
  ck(`Chrome loads the extension ${browser.manifest.version}`, !!browser.extId);
  const page = await openApp(browser, { shotsDir: out });
  const { evaluate, text, shot } = page;
  const pick = (label, value) => evaluate(`(() => { const s = document.querySelector('select[aria-label="${label}"]'); if (!s) return false; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const click = (label) => evaluate(`(() => { const b = document.querySelector('[aria-label="${label}"]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
  const exportAndCheck = async (label, expectPrefix, magic) => {
    const before = fs.readdirSync(dlDir);
    const clicked = await click(label);
    const file = clicked ? await waitForDownload(before, expectPrefix) : null;
    const ok = !!file && file.startsWith(expectPrefix) && head(file, magic.length) === magic && fs.statSync(path.join(dlDir, file)).size > 500;
    return { ok, file, clicked };
  };

  ck('signs in as the admin', signedIn((await signIn(page, admin)).after));
  ck('the admin sees Reports in the sidebar', await evaluate(`!![...document.querySelectorAll('.navlink')].find(a => a.textContent.includes('Reports'))`));
  await evaluate(`location.hash = '#/reports'; true`);
  await sleep(3500);
  const t1 = await text();
  const total = projects.reduce((s, p) => s + p.total, 0);
  ck(`the summary shows all ${total} tasks`, t1.includes(`${total}\nTotal tasks`) || t1.includes(`${total}\nTOTAL TASKS`), t1.slice(0, 600));
  ck('the project and team tables are filled', t1.includes(project.projectName) && /Team workload/i.test(t1) && /Project progress/i.test(t1));
  ck('the period trend is shown', /Completed in period/i.test(t1) && (await evaluate(`!!document.querySelector('svg.rpt-chart')`)));
  await shot('01-all.png', { full: true });

  // Full report, all projects.
  let r = await exportAndCheck('Export as Excel', 'tasks-report-', 'PK');
  ck('Full report → Excel downloads a workbook', r.ok, JSON.stringify(r));
  r = await exportAndCheck('Export as PDF', 'tasks-report-', '%PDF');
  ck('Full report → PDF downloads a PDF', r.ok, JSON.stringify(r));
  ck('CSV is not offered for the full report', (await evaluate(`document.querySelector('[aria-label="Export as CSV"]').disabled`)) === true);

  // Filter by a project and a 7-day period, then export again.
  await pick('Filter by project', project.projectId);
  await sleep(2500);
  await evaluate(`[...document.querySelectorAll('.chip')].find(b => b.textContent === '7d').click(); true`);
  await sleep(2500);
  const t2 = await text();
  ck(`filtering to ${project.projectName} shows its ${project.total} tasks`, t2.includes(`${project.total}\nTotal tasks`) || t2.includes(`${project.total}\nTOTAL TASKS`), t2.slice(0, 500));
  ck('the filter is spelled out', t2.includes(`Showing ${project.projectName}`));
  const slug = project.projectName.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').toLowerCase();
  r = await exportAndCheck('Export as PDF', `tasks-report-${slug}-`, '%PDF');
  ck('the filtered PDF downloads (named after the project)', r.ok, JSON.stringify(r));
  r = await exportAndCheck('Export as Excel', `tasks-report-${slug}-`, 'PK');
  ck('the filtered workbook downloads (named after the project)', r.ok, JSON.stringify(r));
  await shot('02-filtered.png', { full: true });

  // A single report as CSV.
  await pick('Report to export', 'workload');
  await sleep(500);
  r = await exportAndCheck('Export as CSV', `user-workload-${slug}-`, '');
  ck('Employee workload → CSV downloads', r.ok, JSON.stringify(r));

  // A task's export from the drawer.
  await evaluate(`location.hash = '#/task/${task.id}'; true`);
  await sleep(3000);
  r = await exportAndCheck('Export task as PDF', `${task.key}-`, '%PDF');
  ck(`task ${task.key} → PDF`, r.ok, JSON.stringify(r));
  r = await exportAndCheck('Export task as Excel', `${task.key}-`, 'PK');
  ck(`task ${task.key} → Excel`, r.ok, JSON.stringify(r));
  await shot('03-task.png');
  ck('no script errors (admin)', page.errors.length === 0, page.errors.join(' | '));

  // An employee: no Reports in the sidebar, and the screen explains why.
  await evaluate(`location.hash = '#/settings'; true`);
  await sleep(1500);
  await evaluate(`window.confirm = () => true; [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign out').click(); true`);
  await sleep(3000);
  await evaluate(`(() => { const set = (id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('li', ${JSON.stringify(employee.user)}); set('lp', ${JSON.stringify(employee.password)}); return true; })()`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign in').click(); true`);
  await sleep(5000);
  ck('signs in as an employee', signedIn(await text()));
  ck('an employee has no Reports in the sidebar', !(await evaluate(`!![...document.querySelectorAll('.navlink')].find(a => a.textContent.includes('Reports'))`)));
  await evaluate(`location.hash = '#/reports'; true`);
  await sleep(3000);
  ck('…and opening it says it is for administrators', (await text()).includes('Reports are available to administrators.'));
  await shot('04-employee.png');
  console.log(`  (downloads: ${dlDir})`);
} catch (e) {
  error(e);
} finally {
  await browser.close();
  process.exit(done());
}
