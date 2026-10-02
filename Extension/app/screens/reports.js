import { el, mount, Loader, ErrorState } from '../dom.js';
import { catVar } from '../components.js';
import { todayKey, formatDayKey } from '../../src/due-date.js';
import {
  EXPORT_REPORTS, REPORT_FORMATS, PERIOD_PRESETS, csvAllowed, reportExportPath, reportFileName, periodRange, periodDays,
  summarize, statusBars, trendStats,
} from '../../src/reports.js';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Reports (admins) — the web portal's reports in the extension: project / team-member filters and a
 * period, summary tiles, status, the period's trend, project progress and team workload, and
 * Excel / PDF / CSV exports that follow the same filters. Always read fresh (online only).
 */
export function ReportsScreen(ctx) {
  // State — declared before load()/return (see the TDZ pitfall in the screen contract).
  const today = todayKey(ctx.timeZone);
  let filters = { projectId: '', userId: '', ...periodRange(30, today) };
  let kind = 'export';
  let exporting = null;
  let exportMsg = null; // { error: bool, text }
  let projectOptions = [];
  let teamOptions = [];
  let seq = 0;

  const exportBar = el('div', { class: 'card rpt-export' });
  const filterBar = el('div', { class: 'card rpt-filters' });
  const body = el('div', { class: 'rpt-body' }, Loader());
  const root = el('div', { class: 'rpt' }, exportBar, filterBar, body);

  renderExport();
  renderFilters();
  load();
  return root;

  /** The project / team-member filters as the report endpoints take them. */
  function scoped() {
    return { ...(filters.projectId ? { projectId: filters.projectId } : {}), ...(filters.userId ? { userId: filters.userId } : {}) };
  }

  async function load() {
    const mine = ++seq;
    mount(body, Loader());
    const r = ctx.api.reports;
    try {
      const f = scoped();
      const first = !projectOptions.length && !teamOptions.length;
      const [projects, status, workload, completion, series, allProjects, allTeam] = await Promise.all([
        r.projects(f), r.status(f), r.workload(f), r.completion(f).catch(() => null),
        r.timeseries({ ...f, from: filters.from, to: filters.to }).catch(() => null),
        // Unfiltered lists feed the pickers (fetched once).
        first ? r.projects({}) : null,
        first ? r.workload({}) : null,
      ]);
      if (mine !== seq) return;
      if (first) {
        projectOptions = (allProjects ?? []).map((p) => ({ value: p.projectId, label: p.projectName }));
        teamOptions = (allTeam ?? []).map((w) => ({ value: w.userId, label: w.name || w.username }));
        renderFilters();
      }
      render({ projects: projects ?? [], status: status ?? {}, workload: workload ?? [], completion, series });
    } catch (e) {
      if (mine !== seq) return;
      if (e && e.status === 403) mount(body, ErrorState('Reports are available to administrators.'));
      else mount(body, ErrorState(ctx.isOnline && !ctx.isOnline() ? 'Reports need a connection — you appear to be offline.' : 'Couldn’t load the reports.', load));
    }
  }

  // ---- Export -----------------------------------------------------------
  function renderExport() {
    const pick = el('select', { class: 'field', 'aria-label': 'Report to export' },
      EXPORT_REPORTS.map((r) => el('option', { value: r.kind }, r.label)));
    pick.value = kind;
    pick.addEventListener('change', () => { kind = pick.value; exportMsg = null; renderExport(); });
    mount(exportBar,
      el('div', { class: 'rpt-export-row' },
        el('div', { class: 'rpt-export-lbl' }, 'Export'),
        pick,
        REPORT_FORMATS.map(({ format, label }) => {
          const csvOff = format === 'csv' && !csvAllowed(kind);
          return el('button', {
            class: 'btn sm', type: 'button', 'aria-label': `Export as ${label}`,
            disabled: exporting !== null || csvOff,
            title: csvOff ? 'Choose a single report for CSV' : null,
            onClick: () => runExport(format),
          }, exporting === format ? 'Exporting…' : `⬇ ${label}`);
        }),
      ),
      el('div', { class: 'muted rpt-hint' }, 'Exports follow the filters and period below.'),
      exportMsg ? el('div', { class: exportMsg.error ? 'errbar' : 'infobar', role: exportMsg.error ? 'alert' : 'status', style: { margin: '10px 0 0' } }, el('span', {}, exportMsg.text)) : null,
    );
  }

  async function runExport(format) {
    if (ctx.isOnline && !ctx.isOnline()) {
      exportMsg = { error: true, text: 'Exports need a connection — you appear to be offline.' };
      renderExport();
      return;
    }
    exporting = format;
    exportMsg = null;
    renderExport();
    try {
      const { blob, fileName } = await ctx.api.download(reportExportPath(kind, format, filters));
      const name = fileName || reportFileName(kind, format, todayKey(ctx.timeZone));
      ctx.saveFile(blob, name);
      exportMsg = { error: false, text: `Downloaded ${name}` };
    } catch (e) {
      exportMsg = { error: true, text: e && e.status === 403 ? 'Only administrators can export reports.' : 'Couldn’t export the report. Please try again.' };
    } finally {
      exporting = null;
      renderExport();
    }
  }

  // ---- Filters ----------------------------------------------------------
  function renderFilters() {
    const select = (label, all, options, value, onPick) => {
      const s = el('select', { class: 'field', 'aria-label': label }, el('option', { value: '' }, all), options.map((o) => el('option', { value: o.value }, o.label)));
      s.value = value;
      s.addEventListener('change', () => onPick(s.value));
      return s;
    };
    const set = (patch) => { filters = { ...filters, ...patch }; renderFilters(); load(); };
    const days = periodDays(filters);
    const from = el('input', { class: 'field', type: 'date', value: filters.from, max: filters.to, 'aria-label': 'From date' });
    const to = el('input', { class: 'field', type: 'date', value: filters.to, min: filters.from, max: today, 'aria-label': 'To date' });
    from.addEventListener('change', () => { if (from.value && from.value <= filters.to) set({ from: from.value }); });
    to.addEventListener('change', () => { if (to.value && to.value >= filters.from) set({ to: to.value }); });
    const projectName = projectOptions.find((o) => o.value === filters.projectId)?.label ?? 'Selected project';
    const memberName = teamOptions.find((o) => o.value === filters.userId)?.label ?? 'Selected member';
    const active = filters.projectId || filters.userId;
    mount(filterBar,
      el('div', { class: 'rpt-filter-row' },
        el('div', { class: 'rpt-export-lbl' }, 'Filter'),
        select('Filter by project', 'All projects', projectOptions, filters.projectId, (v) => set({ projectId: v })),
        select('Filter by team member', 'All team', teamOptions, filters.userId, (v) => set({ userId: v })),
        active ? el('button', { class: 'linkbtn', type: 'button', onClick: () => set({ projectId: '', userId: '' }) }, 'Clear') : null,
      ),
      el('div', { class: 'rpt-filter-row' },
        el('div', { class: 'rpt-export-lbl' }, 'Period'),
        PERIOD_PRESETS.map((n) => el('button', {
          class: `chip${days === n && filters.to === today ? ' on' : ''}`, type: 'button',
          onClick: () => set(periodRange(n, today)),
        }, `${n}d`)),
        from, el('span', { class: 'muted' }, 'to'), to,
      ),
      active
        ? el('div', { class: 'muted rpt-hint', dir: 'auto' }, `Showing ${filters.projectId ? projectName : 'all projects'}${filters.userId ? ` · ${memberName}’s tasks` : ''} — tiles, tables and exports`)
        : null,
    );
  }

  // ---- Report body --------------------------------------------------------
  function render({ projects, status, workload, completion, series }) {
    const s = summarize(projects, filters);
    const t = trendStats(series);
    const bars = statusBars(status);
    const team = [...workload].filter((w) => !filters.userId || w.userId === filters.userId).sort((a, b) => b.assigned - a.assigned);
    const rows = [...projects].filter((p) => !filters.projectId || p.projectId === filters.projectId).sort((a, b) => b.completionPct - a.completionPct);
    mount(body,
      el('div', { class: 'stats' },
        tile(s.total, 'Total tasks', `${s.projects} project${s.projects === 1 ? '' : 's'}`, ''),
        tile(s.completed, 'Completed', `${s.completionPct}% completion`, 'done'),
        tile(s.overdue, 'Overdue', s.total ? `${s.overduePct}% of tasks` : '—', 'overdue'),
        tile(completion ? `${completion.onTimeRate}%` : '—', 'On-time rate', completion ? `${completion.onTime} on time · ${completion.late} late` : 'No completed tasks', 'info'),
      ),
      el('div', { class: 'rpt-grid' },
        el('section', { class: 'card' },
          el('div', { class: 'section-title' }, 'Tasks by status'),
          bars.length
            ? el('div', { class: 'rpt-bars' }, bars.map((b) => el('div', { class: 'rpt-bar' },
              el('span', { class: 'lbl' }, b.label),
              el('span', { class: 'track' }, el('span', { class: 'fill', style: { width: `${b.pct}%`, background: `var(${catVar(b.category)})` } })),
              el('span', { class: 'num' }, String(b.value)),
            )))
            : el('div', { class: 'muted' }, 'No tasks.'),
        ),
        el('section', { class: 'card' },
          el('div', { class: 'section-title' }, `Period · ${formatDayKey(filters.from, { weekday: false })} – ${formatDayKey(filters.to, { weekday: false })}`),
          el('div', { class: 'rpt-mini' },
            mini(t.completed, 'Completed in period', 'done'),
            mini(t.created, 'New tasks', 'info'),
            mini(`${t.velocityPerWeek}/wk`, 'Velocity', ''),
            mini(t.overdueNow, 'Overdue now', 'overdue'),
          ),
          series && series.points && series.points.length > 1 ? trendChart(series.points) : null,
        ),
      ),
      el('section', { class: 'card rpt-table-card' },
        el('div', { class: 'section-title' }, 'Project progress'),
        rows.length
          ? table(['Project', 'Total', 'Completed', 'Pending', 'Overdue', 'Completion'], rows.map((r) => [
            el('span', { dir: 'auto' }, r.projectName), r.total, r.completed, r.total - r.completed,
            el('span', { class: r.overdue ? 'error' : null }, String(r.overdue)), pctBar(r.completionPct),
          ]))
          : el('div', { class: 'muted' }, 'No projects.'),
      ),
      el('section', { class: 'card rpt-table-card' },
        el('div', { class: 'section-title' }, 'Team workload'),
        team.length
          ? table(['Team member', 'Assigned', 'Completed', 'Open', 'Overdue'], team.map((w) => [
            el('span', { dir: 'auto' }, w.name || w.username), w.assigned, w.completed, w.assigned - w.completed,
            el('span', { class: w.overdue ? 'error' : null }, String(w.overdue)),
          ]))
          : el('div', { class: 'muted' }, 'No team members.'),
      ),
    );
  }

  function tile(n, label, hint, cls) {
    return el('div', { class: `stat ${cls}` }, el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, label), el('div', { class: 'muted rpt-tile-hint' }, hint));
  }
  function mini(n, label, cls) {
    return el('div', { class: `rpt-mini-stat ${cls}` }, el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, label));
  }
  function pctBar(pct) {
    return el('span', { class: 'rpt-pct' }, el('span', { class: 'track' }, el('span', { class: 'fill', style: { width: `${Math.min(100, pct)}%` } })), el('span', { class: 'num' }, `${pct}%`));
  }
  function table(headers, rows) {
    return el('div', { class: 'rpt-scroll' },
      el('table', { class: 'rpt-table' },
        el('thead', {}, el('tr', {}, headers.map((h, i) => el('th', { class: i ? 'num' : null }, h)))),
        el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((c, i) => el('td', { class: i ? 'num' : null }, typeof c === 'number' ? String(c) : c))))),
      ),
    );
  }

  /** Cumulative tasks created vs completed over the period. */
  function trendChart(points) {
    const W = 320;
    const H = 110;
    const pad = 6;
    let c1 = 0;
    let c2 = 0;
    const done = points.map((p) => (c1 += p.completed || 0));
    const created = points.map((p) => (c2 += p.created || 0));
    const max = Math.max(1, ...done, ...created);
    const x = (i) => pad + (i * (W - 2 * pad)) / (points.length - 1);
    const y = (v) => H - pad - (v * (H - 2 * pad)) / max;
    const line = (vals, color, dashed) => {
      const pl = document.createElementNS(SVG, 'polyline');
      pl.setAttribute('points', vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '));
      pl.setAttribute('fill', 'none');
      pl.setAttribute('stroke', color);
      pl.setAttribute('stroke-width', '2');
      if (dashed) pl.setAttribute('stroke-dasharray', '4 3');
      return pl;
    };
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'rpt-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Over the period, ${c2} tasks were created and ${c1} completed`);
    svg.append(line(created, 'var(--ink3)', true), line(done, 'var(--cat-done)', false));
    return el('div', {},
      svg,
      el('div', { class: 'rpt-legend' },
        el('span', {}, el('i', { style: { background: 'var(--cat-done)' } }), 'Completed (cumulative)'),
        el('span', {}, el('i', { style: { background: 'var(--ink3)' } }), 'Created'),
      ),
    );
  }
}
