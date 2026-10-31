import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import {
  COLOR_NAMES,
  ownerOptions,
  CODE_PATTERN,
  DEFAULT_PROJECT_COLOR,
  HEX_COLOR,
  PROJECT_COLORS,
  PROJECT_ICON_KEYS,
  PROJECT_ICON_LABEL,
  PROJECT_STATUSES,
  codeProblem,
  colorName,
  customColor,
  isProjectIcon,
  projectLook,
  projectPictureHref,
  projectPriorityLabel,
  projectStatusLabel,
  projectStatusTone,
  projectInitials,
  readableOn,
  suggestCode,
} from './project-identity';
import { serverFileHref } from './attachments';
import { avatarHref } from './account';
import { isIconName } from './icons';

const API = 'https://task.mico360.com/api/v1';

describe('a project’s picture', () => {
  it('is shown only from this server’s uploads', () => {
    expect(projectPictureHref(API, '/uploads/abc/logo.png')).toBe('https://task.mico360.com/uploads/abc/logo.png');
    expect(projectPictureHref(API, 'https://elsewhere.example/logo.png')).toBeNull();
    expect(projectPictureHref(API, '//elsewhere.example/uploads/logo.png')).toBeNull();
    expect(projectPictureHref(API, 'data:image/png;base64,AAAA')).toBeNull();
    expect(projectPictureHref(API, 'file:///sdcard/logo.png')).toBeNull();
    expect(projectPictureHref(API, '/avatars/logo.png')).toBeNull();
    expect(projectPictureHref(API, null)).toBeNull();
    expect(projectPictureHref(API, undefined)).toBeNull();
  });

  it('follows the one rule for this server’s files (attachments serverFileHref), as photos and chat files do', () => {
    const samples = [
      '/uploads/abc/logo.png',
      'uploads/abc/logo.png',
      'https://task.mico360.com/uploads/abc/logo.png',
      'http://task.mico360.com/uploads/abc/logo.png',
      'https://task.mico360.com:8443/uploads/abc/logo.png',
      '/uploads/../config.json',
      '/uploads/%2e%2e/config.json',
      '/uploads\\a.png',
      '',
      null,
    ];
    for (const url of samples) expect(projectPictureHref(API, url), String(url)).toBe(serverFileHref(API, url));
    expect(avatarHref(API, 'https://task.mico360.com/uploads/me.png')).toBe(projectPictureHref(API, 'https://task.mico360.com/uploads/me.png'));
  });
});

describe('a project’s look', () => {
  it('is its picture, else its icon on its colour, else its initials', () => {
    expect(projectLook({ name: 'Rig Inspection', color: '#2E7D53', icon: 'truck', imageUrl: '/uploads/p/1.png' }, API)).toEqual({
      picture: 'https://task.mico360.com/uploads/p/1.png',
      icon: 'truck',
      initials: 'RI',
      background: '#2E7D53',
      foreground: '#ffffff',
      label: 'Rig Inspection',
    });
    const icon = projectLook({ name: 'Rig Inspection', color: '#2E7D53', icon: 'truck', imageUrl: null }, API);
    expect([icon.picture, icon.icon]).toEqual([null, 'truck']);
    const initials = projectLook({ name: 'Rig Inspection', color: '#2E7D53', icon: 'not-an-icon' }, API);
    expect([initials.picture, initials.icon, initials.initials]).toEqual([null, null, 'RI']);
  });

  it('uses the website’s maroon when a project has no colour, and readable text on any colour', () => {
    const look = projectLook({ name: 'HR' }, API);
    expect(look.background).toBe(DEFAULT_PROJECT_COLOR);
    expect(DEFAULT_PROJECT_COLOR).toBe('#8B1E1E');
    expect(projectLook({ name: 'HR', color: 'nonsense' }, API).background).toBe(DEFAULT_PROJECT_COLOR);
    expect(readableOn('#8B1E1E')).toBe('#ffffff');
    expect(readableOn('#FFE680')).toBe('#1f1a17');
    expect(readableOn('oops')).toBe('#ffffff');
  });

  it('has a drawn icon and a name for every icon the server takes', () => {
    for (const key of PROJECT_ICON_KEYS) {
      expect(isIconName(`project.${key}`), key).toBe(true);
      expect(PROJECT_ICON_LABEL[key]).toBeTruthy();
      expect(isProjectIcon(key)).toBe(true);
    }
    expect(isProjectIcon('dragon')).toBe(false);
    expect(isProjectIcon(null)).toBe(false);
  });

  it('makes two initials from the first two words, in any script', () => {
    expect(projectInitials('Rig Inspection Portal')).toBe('RI');
    expect(projectInitials('payroll')).toBe('PA');
    expect(projectInitials('  ')).toBe('?');
    expect(projectInitials('مشروع الحفر')).toBe('ما');
  });

  it('uses letters only, as the website’s tile: no bracket, dash or number; a name without a letter keeps its digits', () => {
    expect(projectInitials('(OXY) Pipeline Survey')).toBe('OP');
    expect(projectInitials('Rig - Phase 2')).toBe('RP');
    expect(projectInitials('2026 Audit')).toBe('AU');
    expect(projectInitials('2026')).toBe('20');
    expect(projectInitials('— · —')).toBe('?');
  });
});

describe('colours', () => {
  it('names each colour on offer, and a custom one by its code', () => {
    expect(PROJECT_COLORS).toHaveLength(14);
    for (const c of PROJECT_COLORS) expect(COLOR_NAMES[c]).toBeTruthy();
    expect(colorName('#8b1e1e')).toBe('Maroon');
    expect(colorName('#123456')).toBe('Custom colour #123456');
  });

  it('takes a typed colour code with or without #, and refuses anything else', () => {
    expect(customColor('#1e5a8b')).toBe('#1E5A8B');
    expect(customColor(' 1e5a8b ')).toBe('#1E5A8B');
    expect(customColor('#12345')).toBeNull();
    expect(customColor('blue')).toBeNull();
    expect(HEX_COLOR.test('#1E5A8B')).toBe(true);
  });
});

describe('codes', () => {
  it('says what is wrong with a code, in the website’s words', () => {
    expect(codeProblem('')).toBe('A project needs a code.');
    expect(codeProblem('MI CO')).toBe('Use letters and digits only (no spaces or symbols).');
    expect(codeProblem('2RIG')).toBe('Codes start with a letter.');
    expect(codeProblem('M')).toBe('Use 2–10 letters or digits.');
    expect(codeProblem('ABCDEFGHIJK')).toBe('Use 2–10 letters or digits.');
    expect(codeProblem('HR2')).toBeNull();
    expect(CODE_PATTERN.test('HR2')).toBe(true);
  });

  it('suggests a code from the name', () => {
    expect(suggestCode('Rig Inspection Portal')).toBe('RIP');
    expect(suggestCode('Mobile App')).toBe('MAP');
    expect(suggestCode('Payroll')).toBe('PAYR');
    expect(suggestCode('مشروع')).toBe('PRJ');
    expect(suggestCode('Café Opening')).toBe('COP');
    expect(suggestCode('')).toBe('');
  });
});

describe('status and priority in words', () => {
  it('names each status as the website does, with its colour', () => {
    expect(PROJECT_STATUSES.map(projectStatusLabel)).toEqual(['Planning', 'Active', 'On hold', 'Completed', 'Archived']);
    expect(PROJECT_STATUSES.map(projectStatusTone)).toEqual(['info', 'success', 'warning', 'brand', 'neutral']);
    expect(projectStatusLabel('SOMETHING_NEW')).toBe('Something new');
    expect(projectStatusTone('SOMETHING_NEW')).toBe('neutral');
  });

  it('names each priority', () => {
    expect(['LOW', 'NORMAL', 'HIGH', 'URGENT'].map(projectPriorityLabel)).toEqual(['Low', 'Normal', 'High', 'Urgent']);
    expect(projectPriorityLabel(null)).toBe('Normal');
  });
});

/**
 * The server's icons and code rules (Web Portal/backend/src/modules/projects/project-icons.ts),
 * and the website's labels, colours and helpers (frontend/src/lib/project-icons.tsx, the colour
 * names in components/project-form/IdentityEditor.tsx, the status words in api/projects.ts) must be
 * the same here. Skipped when the website's code isn't next to the app.
 */
const portal = resolve(__dirname, '../../../Web Portal');
const serverIcons = resolve(portal, 'backend/src/modules/projects/project-icons.ts');
const webIcons = resolve(portal, 'frontend/src/lib/project-icons.tsx');
const webEditor = resolve(portal, 'frontend/src/components/project-form/IdentityEditor.tsx');
const webProjects = resolve(portal, 'frontend/src/api/projects.ts');
/** The helpers the website's project-icons.tsx imports and these tests need (its initials, from letters only). */
const webIconsImports = { './initials': resolve(portal, 'frontend/src/lib/initials.ts') };

/**
 * A website module with JSX, loaded without React: its JSX is only in functions these tests don't
 * call. Only the imports named in `imports` are loaded (the same way); any other comes back empty.
 */
function loadTsx(file: string, imports: Record<string, string> = {}): Record<string, unknown> {
  const { code } = transformSync(readFileSync(file, 'utf8'), { loader: 'tsx', jsx: 'transform', jsxFactory: '__h', format: 'cjs' });
  const mod = { exports: {} as Record<string, unknown> };
  const load = (spec: string) => (imports[spec] ? loadTsx(imports[spec]) : {});
  new Function('module', 'exports', 'require', code)(mod, mod.exports, load);
  return mod.exports;
}

describe.skipIf(!existsSync(serverIcons))('the same as the server', () => {
  it('takes exactly the server’s icons, in its order, and its code and colour rules', async () => {
    const server = (await import(/* @vite-ignore */ serverIcons)) as { PROJECT_ICONS: string[]; CODE_PATTERN: RegExp; HEX_COLOR: RegExp; CODE_RULE: string };
    expect([...PROJECT_ICON_KEYS]).toEqual(server.PROJECT_ICONS);
    expect(CODE_PATTERN.source).toBe(server.CODE_PATTERN.source);
    expect(HEX_COLOR.source).toBe(server.HEX_COLOR.source);
  });
});

describe.skipIf(!existsSync(webIcons) || !existsSync(webEditor) || !existsSync(webProjects))('the same as the website', () => {
  type Fn = (...a: unknown[]) => unknown;
  it('has the website’s icon names, colours and colour names', () => {
    const web = loadTsx(webIcons, webIconsImports);
    expect([...PROJECT_ICON_KEYS]).toEqual(web.PROJECT_ICON_KEYS);
    expect(PROJECT_ICON_LABEL).toEqual(web.PROJECT_ICON_LABEL);
    expect(PROJECT_COLORS).toEqual(web.PROJECT_COLORS);
    expect(COLOR_NAMES).toEqual(loadTsx(webEditor).COLOR_NAMES);
  });

  it('works out readable text, initials, code problems and suggested codes alike', () => {
    const web = loadTsx(webIcons, webIconsImports) as Record<string, Fn>;
    for (const c of [...PROJECT_COLORS, '#FFFFFF', '#FFE680', '#000000', 'bad', '#abc']) expect(readableOn(c)).toBe(web.readableOn!(c));
    const names = ['Rig Inspection Portal', 'Mobile App', 'Payroll', 'مشروع الحفر', 'Café Opening', '', '  ', 'A', '2026 Budget Plan', 'Ünïcode Work Stream Five Six', 'x y',
      '(OXY) Pipeline Survey', 'Rig - Phase 2', '2026 Audit', '2026', '٢٠٢٦', '— · —', '🚀 Launch', 'مُشروع'];
    for (const n of names) {
      expect(projectInitials(n), n).toBe(web.projectInitials!(n));
      expect(suggestCode(n), n).toBe(web.suggestCode!(n));
    }
    for (const code of ['', ' ', 'MI CO', 'mi-co', '2RIG', 'M', 'ABCDEFGHIJK', 'HR2', 'mico']) expect(codeProblem(code), code).toBe(web.codeProblem!(code));
    expect(CODE_PATTERN.source).toBe((web.CODE_PATTERN as unknown as RegExp).source);
  });

  it('names statuses as the website does', async () => {
    const web = (await import(/* @vite-ignore */ webProjects)) as { PROJECT_STATUSES: string[]; projectStatusLabel: (s: string) => string };
    expect([...PROJECT_STATUSES]).toEqual(web.PROJECT_STATUSES);
    for (const s of PROJECT_STATUSES) expect(projectStatusLabel(s)).toBe(web.projectStatusLabel(s));
  });
});

describe('drawn project icons, readable on every colour', () => {
  it('a project with an icon shows that drawn icon in the readable colour on its colour', () => {
    expect(projectLook({ name: 'Rig', icon: 'heart', color: '#9D174D' }, API)).toMatchObject({ icon: 'heart', foreground: readableOn('#9D174D'), background: '#9D174D', picture: null });
    expect(projectLook({ name: 'Lab Tests', icon: 'nope' }, API)).toMatchObject({ icon: null, initials: 'LT' });
    for (const key of PROJECT_ICON_KEYS) expect(isIconName(`project.${key}`), key).toBe(true);
  });

  it('no emoji symbols or Android-version table are left (every phone draws the same icon)', async () => {
    const mod = (await import('./project-identity')) as Record<string, unknown>;
    for (const gone of ['PROJECT_ICON_GLYPH', 'ICON_MIN_ANDROID', 'iconGlyph', 'GLYPH_PLATE']) expect(mod[gone], gone).toBeUndefined();
    expect(readFileSync(resolve(__dirname, 'project-identity.ts'), 'utf8')).not.toMatch(/osLevel|\p{Extended_Pictographic}/u);
  });

  it('the owner can be chosen only from active people, on the dashboard as in the form (the current owner stays listed)', () => {
    const people = [
      { id: 'u1', username: 'ann', firstName: 'Ann', lastName: 'Lee', active: true },
      { id: 'u2', username: 'bob', firstName: 'Bob', lastName: 'Ray', active: false },
      { id: 'u3', username: 'cy', firstName: 'Cy', lastName: 'Do', active: false },
    ];
    expect(ownerOptions(people as never, 'u3').map((o) => o.value)).toEqual(['', 'u1', 'u3']);
    expect(ownerOptions(people as never, '').map((o) => o.value)).toEqual(['', 'u1']);
    expect(ownerOptions(people as never, '')[1]).toEqual({ value: 'u1', label: 'Ann Lee', hint: '@ann' });
  });
});

// Stage 2 fix pass B3: "No owner" is offered only when it may be chosen (an administrator, or an edit),
// as the website's ownerChoices(…, { allowNone }).
it('B3: "No owner" only when it may be chosen', () => {
  const people = [{ id: 'u1', username: 'ann', firstName: 'Ann', lastName: 'Lee' }];
  expect(ownerOptions(people, 'u1', { allowNone: false }).map((o) => o.value)).toEqual(['u1']);
  expect(ownerOptions(people, 'u1', { allowNone: true }).map((o) => o.value)).toEqual(['', 'u1']);
  expect(ownerOptions(people, 'u1').map((o) => o.value)).toEqual(['', 'u1']);
});
