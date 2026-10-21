import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PROJECT_ICON_PATHS, PROJECT_ICON_LABEL, isProjectIcon, readableOn, projectInitials, projectLook,
  PROJECT_STATUSES, projectStatusLabel, dashboardUrl, DEFAULT_PROJECT_COLOR,
} from './project-identity.js';

// A project's picture, as the web draws it everywhere (components/ProjectAvatar.tsx): its uploaded
// image, else its icon on its colour, else its initials on its colour.
describe('a project’s picture', () => {
  it('its picture first, then its icon, then its initials — on its colour (the web’s red when none)', () => {
    expect(projectLook({ name: 'Rig Inspection', imageUrl: '/uploads/p.png', icon: 'oil', color: '#0F766E' })).toEqual({ kind: 'image', src: '/uploads/p.png', color: '#0F766E', fg: '#ffffff' });
    expect(projectLook({ name: 'Rig Inspection', icon: 'oil', color: '#0F766E' })).toEqual({ kind: 'icon', icon: 'oil', color: '#0F766E', fg: '#ffffff' });
    expect(projectLook({ name: 'Rig Inspection', icon: 'not-an-icon', color: null })).toEqual({ kind: 'initials', text: 'RI', color: DEFAULT_PROJECT_COLOR, fg: '#ffffff' });
    expect(projectLook({ name: 'Ops', color: '#B7791F' }).text).toBe('OP');
  });

  it('knows the icons by name, and what to call each one', () => {
    expect(isProjectIcon('rocket')).toBe(true);
    expect(isProjectIcon('toString')).toBe(false);
    expect(isProjectIcon(null)).toBe(false);
    expect(Object.keys(PROJECT_ICON_LABEL)).toEqual(Object.keys(PROJECT_ICON_PATHS));
  });

  it('readable status names, as on the web', () => {
    expect(PROJECT_STATUSES.map(projectStatusLabel)).toEqual(['Planning', 'Active', 'On hold', 'Completed', 'Archived']);
    expect(projectStatusLabel('SOMETHING_NEW')).toBe('Something new');
    expect(projectStatusLabel(null)).toBe('');
  });

  it('“Open dashboard on the web” goes to the project’s page on the website', () => {
    expect(dashboardUrl('https://task.mico360.com', 'p 1')).toBe('https://task.mico360.com/projects/p%201');
    expect(dashboardUrl('https://task.mico360.com/', 'p1')).toBe('https://task.mico360.com/projects/p1');
  });
});

// The extension keeps a copy of how the web draws a project (Web Portal/frontend/src/lib/project-icons.tsx,
// whose icon names the server accepts — backend/src/modules/projects/project-icons.ts). These fail
// when the copies drift (skipped where the website isn't checked out next to the extension).
const repo = resolve(__dirname, '../..');
const WEB_ICONS = resolve(repo, 'Web Portal/frontend/src/lib/project-icons.tsx');
const SERVER_ICONS = resolve(repo, 'Web Portal/backend/src/modules/projects/project-icons.ts');
const WEB_PROJECTS = resolve(repo, 'Web Portal/frontend/src/api/projects.ts');
const load = (file) => (existsSync(file) ? import(pathToFileURL(file).href) : null);
const web = await load(WEB_ICONS);
const server = await load(SERVER_ICONS);
const webProjects = await load(WEB_PROJECTS);

describe.skipIf(!web)('project pictures: src/project-identity.js matches the web (lib/project-icons.tsx)', () => {
  it('the same icons, drawn with the same paths and called the same', () => {
    expect(PROJECT_ICON_PATHS).toEqual(web.PROJECT_ICON_PATHS);
    expect(PROJECT_ICON_LABEL).toEqual(web.PROJECT_ICON_LABEL);
  });

  it('the same text colour on every colour, and the same initials for every name', () => {
    const colours = [...web.PROJECT_COLORS, '#ffffff', '#000000', '#ffff00', '#777777', 'nope', '', '#abc', '8B1E1E'];
    for (const c of colours) expect(readableOn(c), c).toBe(web.readableOn(c));
    const names = ['Rig Inspection Portal', 'ops', '  Mobile   App ', 'X', '', '   ', 'مشروع الحفر', 'émile zola', '🚀 Launch', 'A'];
    for (const n of names) expect(projectInitials(n), JSON.stringify(n)).toBe(web.projectInitials(n));
  });
});

describe.skipIf(!server)('project icons: the server accepts exactly these (project-icons.ts)', () => {
  it('the same names and shapes', () => {
    expect(Object.keys(PROJECT_ICON_PATHS)).toEqual(server.PROJECT_ICONS);
    expect(PROJECT_ICON_PATHS).toEqual(server.PROJECT_ICON_PATHS);
  });
});

describe.skipIf(!webProjects)('project statuses: the web’s names (api/projects.ts)', () => {
  it('the same statuses, worded the same', () => {
    expect(PROJECT_STATUSES).toEqual(webProjects.PROJECT_STATUSES);
    for (const s of webProjects.PROJECT_STATUSES) expect(projectStatusLabel(s)).toBe(webProjects.projectStatusLabel(s));
  });
});
