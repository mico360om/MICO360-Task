import { describe, expect, it } from 'vitest';
import { inspectPdf } from '../../lib/pdf-inspect';
import { inspectXlsx } from '../../lib/xlsx-inspect';
import { DEFAULT_MANAGEMENT_FILTERS } from './kpi-service';
import { done, dueAt, setup, task, v } from './kpi-service.fixture';
import { buildManagementKpiPdf, buildManagementKpiXlsx, buildProjectKpiPdf, buildProjectKpiXlsx, managementKpiFileName, projectKpiFileName } from './kpi-export';
import { formatCustomValue, formatKpiTarget, formatKpiValue } from './kpi-format';

async function project() {
  const s = setup({ tasks: [done('2026-10-05', '2026-10-06'), done('2026-11-03', '2026-11-04'), done('2026-11-09', '2026-11-05'), task({ dueDate: dueAt('2026-11-02') })] });
  await s.job.run();
  await s.service.addCustom(v('mgr'), 'p1', { name: 'Safety incidents', unit: 'incidents', direction: 'LOWER', target: 0 });
  const k = await s.service.projectKpis(v('mgr'), 'p1', { kind: 'month' });
  await s.service.setCustomValue(v('mgr'), 'p1', k.custom[0]!.id, '2026-10', { value: 2 });
  return { s, k: await s.service.projectKpis(v('mgr'), 'p1', { kind: 'month' }) };
}

describe('KPI words', () => {
  it('figures and targets in plain words', () => {
    expect(formatKpiValue('onTime', 'percent', 85)).toBe('85%');
    expect(formatKpiValue('daysLate', 'days', 1)).toBe('1 working day');
    expect(formatKpiValue('daysLate', 'days', 2.5)).toBe('2.5 working days');
    expect(formatKpiValue('progress', 'percent', 92)).toBe('Behind by 8%');
    expect(formatKpiValue('progress', 'percent', 105)).toBe('Ahead by 5%');
    expect(formatKpiValue('progress', 'percent', 100)).toBe('On plan');
    expect(formatKpiValue('throughput', 'perWeek', 3.5)).toBe('3.5 a week');
    expect(formatKpiValue('blocked', 'tasks', null)).toBe('—');
    expect(formatKpiTarget('onTime', 'percent', 'higher', 85)).toBe('At least 85%');
    expect(formatKpiTarget('daysLate', 'days', 'lower', 2)).toBe('At most 2 working days');
    expect(formatKpiTarget('throughput', 'perWeek', 'higher', null)).toBe('No target');
    expect(formatCustomValue(1200, 'OMR')).toBe('1,200 OMR');
    expect(formatCustomValue(72.5, '%')).toBe('72.5%');
  });
});

describe('Project KPI PDF (1.23.11 standard)', () => {
  it('one page: the title, the project, the period, every KPI with its target and light, the trend and its own KPIs', async () => {
    const { k } = await project();
    const pdf = inspectPdf(buildProjectKpiPdf(k, { generatedBy: 'Omar Said' }));
    expect(pdf.pages).toHaveLength(1);
    const text = pdf.pages[0]!.join('\n');
    for (const words of ['Project KPIs', 'Project p1 (P1)', 'This month (1–11 Nov 2026)', 'On-time completion', 'At least 85%', 'Off target', 'Last 6 months', 'Safety incidents', 'Printed', 'Omar Said']) expect(text).toContain(words);
    expect(projectKpiFileName(k, 'pdf')).toBe('project-kpis-p1-2026-11-11.pdf');
  });

  it('the Management PDF: the table, then one page per project', async () => {
    const { s } = await project();
    const table = await s.service.managementKpis(v('boss', true), DEFAULT_MANAGEMENT_FILTERS, null, { kind: 'month' });
    const pages = await Promise.all(table.rows.map((r) => s.service.projectKpis(v('boss', true), r.project.id, { kind: 'month' })));
    const pdf = inspectPdf(buildManagementKpiPdf(table, pages, { generatedBy: null }));
    expect(pdf.pages.length).toBe(1 + table.rows.length);
    expect(pdf.pages[1]!.join('\n')).toContain('Project p1 (P1)');
    expect(pdf.pages[2]!.join('\n')).toContain('Project p2 (P2)');
    expect(managementKpiFileName(table, 'pdf')).toBe('management-kpis-2026-11-11.pdf');
  });
});

describe('Excel', () => {
  it('a project’s KPIs and its own KPIs by month', async () => {
    const { k } = await project();
    const x = inspectXlsx(buildProjectKpiXlsx(k, { generatedBy: 'Omar Said' }));
    expect(x.sheets).toEqual(['KPIs', 'Own KPIs']);
    const flat = x.text.flat().join(' | ');
    expect(flat).toContain('On-time completion');
    expect(flat).toContain('Safety incidents');
  });

  it('the Management table: a value and a light per KPI', async () => {
    const { s } = await project();
    const table = await s.service.managementKpis(v('boss', true), DEFAULT_MANAGEMENT_FILTERS, null, { kind: 'month' });
    const x = inspectXlsx(buildManagementKpiXlsx(table, { generatedBy: null }));
    const flat = x.text.flat().join(' | ');
    expect(flat).toContain('On-time completion: light');
    expect(flat).toContain('Project p2');
  });
});
