// @vitest-environment jsdom
/**
 * Stage 4: the board, My Tasks and Projects at the web's level — a project's picture, number and
 * status in words, its dashboard on the website; cards with their people, counts, due day and
 * milestone; a task added in any column with the new-task form; My Tasks filtered by project,
 * sorted, and a task marked done from the list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectsScreen } from '../app/screens/projects.js';

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const PROJECTS = [
  { id: 'p1', code: 'RIG', number: 'JOB-2041', name: 'Rig Inspection', description: 'North field rigs', status: 'ON_HOLD', color: '#0F766E', icon: 'oil', imageUrl: null },
  { id: 'p2', code: 'OPS', number: null, name: 'Office Ops', description: null, status: 'ACTIVE', color: null, icon: null, imageUrl: null },
  { id: 'p3', code: 'SITE', number: null, name: 'Site Photos', description: null, status: 'PLANNING', color: '#1E5A8B', icon: null, imageUrl: '/uploads/site.png' },
];

function projectsCtx(over = {}) {
  return {
    params: {}, query: {},
    apiBase: 'http://localhost:4000/api/v1',
    appBase: 'http://localhost:5173',
    api: { projects: { list: vi.fn(async () => ({ data: over.projects ?? PROJECTS })) } },
    navigate: vi.fn(),
    ...over.ctx,
  };
}

describe('Projects: number, picture or icon, status in words, the dashboard on the web', () => {
  it('each card shows the project’s picture as the web does: its image, else its icon, else its initials, on its colour', async () => {
    const root = ProjectsScreen(projectsCtx());
    document.body.append(root);
    await settle();
    const cards = [...root.querySelectorAll('.project')];
    expect(cards).toHaveLength(3);
    const avatar = (card) => card.querySelector('.pavatar');
    expect(avatar(cards[0]).dataset.projectAvatar).toBe('icon');
    expect(avatar(cards[0]).querySelector('svg path')).toBeTruthy();
    expect(avatar(cards[0]).style.background).toBe('rgb(15, 118, 110)');
    expect(avatar(cards[1]).dataset.projectAvatar).toBe('initials');
    expect(avatar(cards[1]).textContent).toBe('OO');
    expect(avatar(cards[2]).dataset.projectAvatar).toBe('image');
    expect(avatar(cards[2]).querySelector('img').getAttribute('src')).toBe('http://localhost:4000/uploads/site.png');
    expect(avatar(cards[0]).getAttribute('aria-hidden')).toBe('true'); // the name is written beside it
  });

  it('a picture that won’t load falls back to the icon or initials', async () => {
    const root = ProjectsScreen(projectsCtx());
    document.body.append(root);
    await settle();
    const tile = root.querySelectorAll('.project')[2].querySelector('.pavatar');
    tile.querySelector('img').dispatchEvent(new Event('error'));
    const again = root.querySelectorAll('.project')[2].querySelector('.pavatar');
    expect(again.dataset.projectAvatar).toBe('initials');
    expect(again.textContent).toBe('SP');
  });

  it('the code, the project’s own number and its status in words', async () => {
    const root = ProjectsScreen(projectsCtx());
    document.body.append(root);
    await settle();
    const [rig, ops] = root.querySelectorAll('.project');
    expect(rig.querySelector('.code').textContent).toBe('RIG');
    expect(rig.querySelector('.pnumber').textContent).toBe('JOB-2041');
    expect(rig.querySelector('.pnumber').getAttribute('title')).toBe('Project number');
    expect(rig.querySelector('.pstatus').textContent).toBe('On hold');
    expect(ops.querySelector('.pnumber')).toBeNull();
    expect(ops.querySelector('.pstatus').textContent).toBe('Active');
    expect(root.textContent).not.toContain('ON_HOLD');
  });

  it('opens the board from the card; “Open dashboard on the web” opens the project’s page on the website in a new tab', async () => {
    const ctx = projectsCtx();
    const root = ProjectsScreen(ctx);
    document.body.append(root);
    await settle();
    const rig = root.querySelector('.project');
    const open = byLabel(rig, 'Open the board of Rig Inspection');
    expect(open.tagName).toBe('BUTTON');
    open.click();
    expect(ctx.navigate).toHaveBeenCalledWith('#/board/p1');
    const web = byText(rig, 'a', 'Open dashboard on the web ↗');
    expect(web.getAttribute('href')).toBe('http://localhost:5173/projects/p1');
    expect(web.getAttribute('target')).toBe('_blank');
    expect(web.getAttribute('rel')).toContain('noopener');
    expect(open.contains(web)).toBe(false); // two controls, not a link inside a button
  });
});
