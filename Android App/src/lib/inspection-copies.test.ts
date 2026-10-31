import { describe, it, expect } from 'vitest';
import { apiRoutes, appSource as src, hasWeb, loadWebTs, normalise, readWeb } from '../testing/web-source';
import { PRESSURE } from '../testing/inspection-fixtures';
import { effectiveResult, limitsText, parseReading } from './inspection-rules';

/**
 * The server's inspection rules and the website's inspection types and calls, copied into the app
 * (Stage 4 Task 1): a reading is decided on the phone exactly as the server decides it.
 */
/** The website's types part of api/inspections.ts: from `export interface Person {` to `const seg = encodeURIComponent;`. */
function typesPart(text: string): string {
  const t = normalise(text);
  const from = t.indexOf('export interface Person {');
  if (from < 0) throw new Error('no `export interface Person {` in the file');
  const to = t.indexOf('const seg = encodeURIComponent;', from);
  return t.slice(from, to < 0 ? undefined : to).trim();
}

describe.skipIf(!hasWeb('backend/src/modules/inspections/inspection-rules.ts', 'frontend/src/api/inspections.ts'))('copies of the server’s and the website’s inspection code', () => {
  it('inspection-rules.ts is the server’s file', () =>
    expect(normalise(src('lib/inspection-rules.ts'))).toBe(normalise(readWeb('backend/src/modules/inspections/inspection-rules.ts'))));

  it('inspection-types.ts holds the website’s types', () =>
    expect(typesPart(src('lib/inspection-types.ts'))).toBe(typesPart(readWeb('frontend/src/api/inspections.ts'))));

  it('every call goes to the website’s path with the website’s verb', () => {
    const web = apiRoutes(readWeb('frontend/src/api/inspections.ts'));
    const app = apiRoutes(src('lib/inspections-api.ts'));
    // The website makes schedules through its tasks API; the app keeps those two calls here.
    const APP_ONLY = ['createCheckSeries', 'updateCheckSeries'];
    expect(Object.keys(app).length).toBeGreaterThanOrEqual(15);
    for (const [name, route] of Object.entries(app)) if (!APP_ONLY.includes(name)) expect(route, name).toBe(web[name]);
    expect(app.createCheckSeries).toBe('POST /tasks');
    expect(app.updateCheckSeries).toBe('PUT /tasks/:p');
    expect(src('lib/inspections-api.ts')).toContain('reportPdfPath: (id: string) => `/inspections/${seg(id)}/report.pdf`');
  });

  it('a reading is decided on the phone exactly as on the server (Review Focus 3)', () => {
    const server = loadWebTs('backend/src/modules/inspections/inspection-rules.ts') as { effectiveResult: typeof effectiveResult };
    for (const reading of ['150', '150.00', '150.0000001', '162.5', '-0', '−1', '٢٠٠', '12,5', 'abc', '', null])
      for (const result of ['PASS', 'FAIL', 'NA', null] as const)
        expect(effectiveResult(PRESSURE, { result, reading }), `${reading} / ${result}`).toBe(server.effectiveResult(PRESSURE, { result, reading }));
  });
});

it('a reading outside its limits is a Fail whatever was tapped', () => {
  expect(effectiveResult(PRESSURE, { result: 'PASS', reading: '162.5' })).toBe('FAIL');
  expect(effectiveResult(PRESSURE, { result: null, reading: '150' })).toBe('PASS');
  expect(parseReading('٢٠٠')).toBe('200');
  expect(parseReading('12,5')).toBe('12.5');
  expect(limitsText(PRESSURE)).toBe('0–150 psi');
});

it('the Inspection screen has a route', () => expect(src('navigation/types.ts')).toMatch(/Inspection: \{ inspectionId: string; title\?: string \};/));

describe('apiRoutes reads a calls file as verb and path per call', () => {
  it('across line breaks, with every ${…} as :p and a query string kept', () => {
    const text = [
      'const seg = encodeURIComponent;',
      'export const api = (client: C) => ({',
      "  listForms: () => client.get<{ data: X }>('/inspection-forms').then((r) => r.data),",
      '  listForProject: (projectId: string) =>',
      '    client.get<{ data: { a: B[] } }>(`/projects/${seg(projectId)}/inspections`).then((r) => r.data),',
      '  dueChecks: (projectId: string) => client.get<{ data: Y }>(`/projects/${encodeURIComponent(projectId)}/inspection-checks?state=open`),',
      '  remove: (id: string) => client.del<void>(`/inspections/${id}`),',
      '  start: (p: string, input: I, key?: string) => client.post<{ data: D }>(`/projects/${seg(p)}/inspections`, input, idempotencyHeaders(key)),',
      '  reportPdf: (id: string) => client.getBlob(`/inspections/${seg(id)}/report.pdf`),',
      '  setVisible: (id: string, visible: boolean) =>',
      '    client',
      '      .put<{ data: V }>(`/inspections/${seg(id)}/client-visibility`, { visible })',
      '      .then((r) => r.data),',
      '});',
    ].join('\r\n');
    expect(apiRoutes(text)).toEqual({
      listForms: 'GET /inspection-forms',
      listForProject: 'GET /projects/:p/inspections',
      dueChecks: 'GET /projects/:p/inspection-checks?state=open',
      remove: 'DELETE /inspections/:p',
      start: 'POST /projects/:p/inspections',
      setVisible: 'PUT /inspections/:p/client-visibility',
    });
  });
});
