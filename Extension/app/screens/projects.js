import { el, mount, Loader, ErrorState, Empty, pill } from '../dom.js';

/**
 * Projects — a responsive grid of project cards. Tapping a card opens that project's
 * Kanban board. Reads work offline via the read-through cache.
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
      el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '14px' } },
        projects.map((p) => card(p)),
      ),
    );
  }

  function card(p) {
    return el('button', {
      class: 'project', type: 'button', style: { textAlign: 'left' },
      onClick: () => ctx.navigate('#/board/' + p.id),
    },
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
        el('div', { class: 'code' }, p.code || ''),
        p.status ? pill(p.status, p.status) : null,
      ),
      el('div', { class: 'nm' }, p.name || ''),
      p.description ? el('div', { class: 'ds' }, p.description) : null,
    );
  }
}
