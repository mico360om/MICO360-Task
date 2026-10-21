import { el, mount, Loader, ErrorState, Empty } from '../dom.js';
import { ProjectAvatar, projectStatusPill } from '../components.js';
import { dashboardUrl } from '../../src/project-identity.js';

/**
 * Projects — a grid of project cards as on the web: each project's picture (its image, icon or
 * initials on its colour), code and own number, status in words, name and description. The card
 * opens the project's Kanban board here; "Open dashboard on the web" opens its dashboard on the
 * website. Reads work offline via the read-through cache.
 */
export function ProjectsScreen(ctx) {
  const root = el('div');
  load();
  return root;

  async function load() {
    mount(root, Loader());
    try {
      const { data, stale } = await ctx.api.projects.list();
      render(data ?? [], stale);
    } catch {
      mount(root, ErrorState('Could not load projects.', load));
    }
  }

  function render(projects, stale) {
    const staleBar = stale
      ? el('div', { class: 'toolbar' }, el('span', { class: 'stale-tag' }, 'offline · saved'))
      : null;

    if (projects.length === 0) {
      mount(root, staleBar, Empty('No projects', 'Projects you can access show up here.'));
      return;
    }

    mount(root, staleBar,
      el('div', { class: 'project-grid' }, projects.map((p) => card(p))),
    );
  }

  function card(p) {
    const name = p.name || p.code || 'Project';
    return el('div', { class: 'project', style: p.color ? { borderTopColor: p.color } : null },
      // One button for the card's main part (opens the board); the website link is beside it.
      el('button', { class: 'project-open', type: 'button', 'aria-label': `Open the board of ${name}`, onClick: () => ctx.navigate(`#/board/${p.id}`) },
        el('div', { class: 'project-top' },
          el('span', { class: 'project-codes' },
            el('span', { class: 'code' }, p.code || ''),
            p.number ? el('span', { class: 'pnumber', title: 'Project number', dir: 'auto' }, p.number) : null),
          projectStatusPill(p.status)),
        el('div', { class: 'project-id' },
          ProjectAvatar(p, { size: 'lg', apiBase: ctx.apiBase }),
          el('div', { class: 'nm', dir: 'auto' }, name)),
        p.description ? el('div', { class: 'ds', dir: 'auto' }, p.description) : null,
      ),
      el('div', { class: 'project-foot' },
        el('a', { href: dashboardUrl(ctx.appBase, p.id), target: '_blank', rel: 'noopener noreferrer', title: `The dashboard of ${name} on the website` }, 'Open dashboard on the web ↗')),
    );
  }
}
