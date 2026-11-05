import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { COMPACT_MEDIA } from '../lib/density';

// 1.23.0 Compact / comfortable rows: one mechanism, the `compact:` variant (tailwind.config.js).
const configPath: string = '../../tailwind.config.js';
const config = ((await import(/* @vite-ignore */ configPath)) as { default: Record<string, unknown> }).default;

async function cssFor(classes: string): Promise<string> {
  const result = await postcss([tailwind({ ...config, content: [{ raw: `<div class="${classes}"></div>`, extension: 'html' }] })]).process('@tailwind utilities;', { from: undefined });
  return result.css.replace(/\s+/g, ' ');
}

describe('the compact: variant', () => {
  it('applies only with <html data-density="compact">, from 768px with a mouse or trackpad', async () => {
    const css = await cssFor('py-3 compact:py-2 compact:text-row');
    const media = `@media ${COMPACT_MEDIA} {`;
    expect(css).toContain(media);
    const inside = css.slice(css.indexOf(media));
    expect(inside).toContain(':root[data-density="compact"] .compact\\:py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem }');
    // A row's text: 13px on an 18px line.
    expect(inside).toContain(':root[data-density="compact"] .compact\\:text-row { font-size: 13px; line-height: 18px }');
  });

  it('leaves comfortable alone: the plain classes are the same rules as before, outside the media', async () => {
    const css = await cssFor('py-3 compact:py-2');
    const plain = css.slice(0, css.indexOf('@media'));
    expect(plain).toContain('.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem }');
    expect(plain).not.toContain('density');
  });

  it('outranks the plain classes it narrows (whatever their order in the sheet)', async () => {
    const css = await cssFor('md:py-3 first:pt-0 compact:py-2 compact:first:pt-0');
    // A rule's selector, found by its class, and its weight in classes / attributes / pseudo-classes.
    const selectorOf = (escapedClass: string) => {
      const at = css.indexOf(escapedClass);
      const start = Math.max(css.lastIndexOf('}', at), css.lastIndexOf('{', at)) + 1;
      return css.slice(start, css.indexOf('{', at)).trim();
    };
    const weight = (selector: string) => (selector.replace(/\\./g, '_').match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
    const compact = selectorOf('.compact\\:py-2');
    expect(compact).toBe(':root[data-density="compact"] .compact\\:py-2');
    // (0,3,0) over a plain or md:/sm: utility's (0,1,0)…
    expect(weight(compact)).toBe(3);
    expect(weight(selectorOf('.md\\:py-3'))).toBe(1);
    // …and over first:/last: (0,2,0): a row that drops its first padding must say so in compact too
    // (compact:first:pt-0, as the approvals list does), which is (0,4,0).
    expect(weight(selectorOf('.first\\:pt-0'))).toBe(2);
    expect(weight(selectorOf('.compact\\:first\\:pt-0'))).toBe(4);
  });
});

// Headers, forms and dialogs stay as they are (owner, 5 Nov): nothing there uses compact.
const src = resolve(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

describe('where compact is not used', () => {
  it('no page header, form, dialog or modal uses it', () => {
    const notHere = (f: string) => {
      const name = basename(f);
      const rel = relative(src, f).replace(/\\/g, '/');
      return /Dialog|Modal|PageHeader|Field|Button\.tsx$|Breadcrumbs|Sidebar|ProfileMenu|AppShell/.test(name) || /^components\/(task-form|meeting-form|project-form|task-drawer)\//.test(rel);
    };
    const offenders = files(src).filter(notHere).filter((f) => readFileSync(f, 'utf8').includes('compact:'));
    expect(offenders.map((f) => relative(src, f))).toEqual([]);
  });
});

// The places compact covers (the design's list; Search, the Series page and the client portal come
// from other 1.23.0 lanes and pick up the same tokens when merged). Each uses the shared steps.
describe('where compact is used', () => {
  const PLACES: Record<string, string> = {
    'every table (Table view, the meeting table)': 'components/data-table/DataTable.tsx',
    'table cells: faces': 'components/data-table/cells.tsx',
    'task table rows: tick box, Open, due chip, number': 'components/data-table/TaskTable.tsx',
    'meeting table: topic rows, Open, chips': 'components/meeting/MeetingTable.tsx',
    'Kanban cards (one project, All projects, the Board tab)': 'components/TaskCard.tsx',
    'Kanban: the room between cards': 'components/KanbanColumn.tsx',
    'My Tasks: grid cards, list rows and the quick button': 'pages/MyTasksPage.tsx',
    'the project Tasks tab list': 'components/project-dashboard/TasksTab.tsx',
    'meeting agenda topics': 'components/meeting/AgendaSection.tsx',
    'meeting action items': 'components/meeting/ActionItemsSection.tsx',
    'meeting notes': 'components/meeting/NotesSection.tsx',
    'the bell': 'components/NotificationsBell.tsx',
    'the Notifications page rows': 'components/notifications/NotificationRow.tsx',
    'the Notifications page list and quick button': 'pages/NotificationsPage.tsx',
    'the Activity page list': 'pages/ActivityPage.tsx',
    'the Activity calendar day list': 'components/activity/ActivityCalendar.tsx',
    'My Action Items': 'pages/MyActionItemsPage.tsx',
    'Approvals on My Tasks': 'components/approvals/ToApproveSection.tsx',
    'Approvals on the Dashboard': 'components/approvals/ApprovalsCard.tsx',
    'User Management': 'pages/UsersPage.tsx',
  };
  it.each(Object.entries(PLACES))('%s', (_what, file) => {
    const text = readFileSync(join(src, file), 'utf8');
    expect(/compact:|DENSE_(TEXT|FACE|STACK)|dense="compact"|\bdense\s*\/>|<DensityButton/.test(text)).toBe(true);
  });

  it('the quick button sits beside every view switch (Board page and tab, project Tasks tab, meeting page)', () => {
    expect(readFileSync(join(src, 'components/data-table/ViewSwitch.tsx'), 'utf8')).toMatch(/<DensityButton \/>/);
  });
});
