import { describe, it, expect } from 'vitest';
import { drawerSectionsFor } from './drawer-menu';
import { WEBSITE_LINK_PATHS, websitePageUrl } from '../lib/website';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';

/** After the two lanes meet (Task 14): the menu's website rows open, Management follows the server, the website's words. */
const API = 'https://task.mico360.com/api/v1';
const everyRow = () => drawerSectionsFor(['ADMIN'], true).flatMap((s) => s.items);

it('every website row in the menu opens on the website', () => {
  const rows = everyRow().filter((i) => i.action.type === 'website');
  expect(rows.map((r) => (r.action as { path: string }).path).sort()).toEqual([...WEBSITE_LINK_PATHS].sort());
  for (const r of rows) expect(websitePageUrl(API, (r.action as { path: string }).path), r.key).not.toBeNull();
});

it('the menu offers Management to the people the server says run a project', () =>
  expect(src('components/AppDrawer.tsx')).toMatch(/const \{ allowed: canLead \} = useManagementAccess\(\);[^]*drawerSectionsFor\(roles, canLead\)/));

it('the approval chip uses the website’s words', () => expect(src('components/ui/ApprovalChip.tsx')).toMatch(/DECISION_WORDS\.waiting/));

it('the old website-page list with its emoji is gone', () => expect(src('lib/website.ts')).not.toMatch(/WEBSITE_ONLY_PAGES|\p{Extended_Pictographic}/u));

describe.skipIf(!hasWeb('frontend/src/components/Sidebar.tsx'))('the same rows as the website’s sidebar', () => {
  it('every menu row that is a website page has the sidebar’s name and address', () => {
    const sidebar = readWeb('frontend/src/components/Sidebar.tsx');
    for (const r of everyRow()) {
      if (r.action.type === 'website') expect(sidebar, r.key).toContain(`{ label: '${r.label}', to: '${r.action.path}'`);
    }
  });
});
