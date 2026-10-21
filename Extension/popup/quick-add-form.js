/**
 * The toolbar popup: quick capture of a new task from any page. The same fields, rules and words as
 * the web's New task form (Web Portal/frontend/src/components/task-form/TaskFormDialog.tsx):
 *  - where it goes (the current or last used project, and a column), what it is (title,
 *    description), when and how urgent (due date, priority; a repeat from "Describe it"), and who
 *    does it ("Assign me", or people from the project's team);
 *  - "Describe it in plain English" (POST /ai/parse-task) suggests details to review: nothing
 *    changes until you choose, and what you set yourself is never replaced silently;
 *  - pasted, dropped or chosen pictures and files go up once the task exists (online only, as on
 *    the web); "Add this page" puts the page's title and address into the description;
 *  - offline, the task is kept on this device (the same queue as the app, with its idempotency
 *    key) — without its files, and the popup says so;
 *  - a popup closes when you click outside it, so the form not sent yet is kept (session storage,
 *    memory only) and comes back next time; recent tasks, and "Open MICO360 Tasks".
 * Built with el() (no HTML strings); the context comes from popup.js (or a test).
 */
import { el, mount } from '../app/dom.js';
import { ProjectAvatar } from '../app/components.js';
import { todayKey } from '../src/due-date.js';
import { getQueue } from '../src/queue.js';
import { messageFor } from '../src/errors.js';
import { pastedFiles, isTypingTarget } from '../src/clipboard-files.js';
import { suggestionsFrom, chosenPatch, toggleSuggestion, describeFailure, scheduleText } from '../src/describe-task.js';
import {
  TITLE_MAX, DESCRIPTION_MAX, PRIORITIES, PRIORITY_NAMES, DRAFT_KEY, LAST_PROJECT_KEY, RECENT_KEY,
  buildQuickAddPayload, openProjects, startProjectId, projectFromUrl, boardColumns, pickColumn, personName, assigneeNote,
  removedNotice, isAddablePage, withPage, mergeCapture, ownedBy, rememberRecent, recentStatus, fileFailure, createFailure,
  attachFailureMessage, createdMessage, createdBeforeMessage, restoredMessage, keyIsSpent, formatSize, OFFLINE_FILES_MESSAGE,
  UNREACHABLE_FILES_MESSAGE, QUEUED_MESSAGE, QUEUED_WITHOUT_FILES_MESSAGE,
} from '../src/quick-add.js';

const BLANK = { title: '', description: '', priority: 'NORMAL', dueDate: '', projectId: '', columnId: '', assigneeIds: [], rule: null };
/** The server's upload limit, said up front (as on the web). */
const MAX_UPLOAD_MB = 10;
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

async function openFull(ctx, hash = '') {
  try {
    await ctx.openApp(hash);
  } finally {
    ctx.close();
  }
}

function header(ctx, { withOpen = true } = {}) {
  return el('header', { class: 'qa-head' },
    el('h1', { class: 'qa-brand' }, el('span', { class: 'm' }, 'MICO'), '360 Tasks'),
    withOpen ? el('button', { class: 'btn sm', type: 'button', title: 'Open the full app in a tab', onClick: () => openFull(ctx) }, 'Open MICO360 Tasks') : null,
  );
}

/** Nobody is signed in (or the session ended): sign in in the full app. */
export function SignedOutView(ctx, message) {
  return el('div', { class: 'qa' },
    header(ctx, { withOpen: false }),
    el('div', { class: 'qa-signedout' },
      el('p', {}, message || 'Sign in to MICO360 Tasks to add tasks from any page.'),
      el('button', { class: 'btn primary', type: 'button', onClick: () => openFull(ctx) }, 'Open MICO360 Tasks'),
    ),
  );
}

/**
 * `ctx.place` ({ project, columnId, boardDate }): the form opens from a board's "Add a task" in the
 * app (Stage 4), as on the web — a "New task" dialog in that project (shown, not changed), starting
 * in that column, on the board's day. It then has no "Open MICO360 Tasks", recent tasks, shortcut
 * tip, "Add this page" or kept draft (the app tab doesn't close by itself); closing it with
 * something typed asks first ("Discard this task?"). `ctx.onDone({ task } | { item, payload })`
 * hears when the task is created or kept on this device, `ctx.onCancel()` when it is closed.
 * The returned element's `requestClose()` closes it the same way (Escape, Close, the page behind).
 */
export function QuickAddForm(ctx) {
  const place = ctx.place && ctx.place.project && ctx.place.project.id ? ctx.place : null;
  // ---- State --------------------------------------------------------------------------------
  const state = {
    fields: { ...BLANK, assigneeIds: [] },
    /** How the form opened (what isn't the person's own): "Describe it" may replace those values. */
    initial: { ...BLANK },
    /** The project or column was picked by hand. */
    placeChosen: false,
    projects: [],
    projectsLoaded: false,
    columns: null,     // null while loading
    members: undefined, // undefined while loading, null when unknown (offline), else the team
    files: [],
    saving: false,
    created: null,     // the task once it exists: while its files go up, and when some couldn't ("Done" then starts over)
    held: null,        // { payload, key }: offline with files — "Save without the files" sends it
    pending: null,     // { key, payloadJSON }: an attempt that may have reached the server — the same task sent again reuses its key
    nextCapture: null, // a right-click capture that came while a task was being created: it fills the next one
    notice: '',
    describe: { reading: false, problem: null, found: null },
  };
  const fields = () => state.fields;
  const known = new Map([[ctx.me.id, ctx.me.name || 'You']]); // id → name, for chips and notices
  let fileSeq = 0;
  let draftWrite = Promise.resolve();

  // ---- Elements -----------------------------------------------------------------------------
  const announcer = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const OFFLINE_TEXT = 'Offline — a new task is saved on this device and syncs when you reconnect. Files and “Describe it” need a connection.';
  const offbar = el('div', { class: 'qa-offbar hidden' }, OFFLINE_TEXT);
  const bannerBox = el('div');

  const describeText = el('textarea', {
    id: 'qa-describe', class: 'field', rows: '2', maxlength: '1000', 'aria-describedby': 'qa-describe-hint',
    placeholder: 'e.g. “Send the RIG1 site report to Omar every Monday, with the inspection photos”',
  });
  const readBtn = el('button', { class: 'btn sm', type: 'button', disabled: true, onClick: () => read() }, 'Fill task details');
  const describeResult = el('div', { 'aria-live': 'polite' });
  const describeBox = el('div', { class: 'qa-describe' },
    el('label', { class: 'qa-describe-label', for: 'qa-describe' }, el('span', { 'aria-hidden': 'true' }, '✨ '), 'Describe it in plain English'),
    el('p', { id: 'qa-describe-hint', class: 'qa-hint' }, 'The assistant suggests a title, description, due date, repeat, priority and project — you choose what to use.'),
    describeText,
    el('div', { class: 'qa-describe-row' }, el('span', { class: 'qa-hint' }, `${isMac() ? '⌘' : 'Ctrl'} + Enter also works.`), readBtn),
    describeResult,
  );

  const titleInput = el('input', { id: 'qa-title', class: 'field', maxlength: String(TITLE_MAX), 'aria-required': 'true', autocomplete: 'off', placeholder: 'What needs to be done?' });
  // An alert: read out even when focus is already in the title (moving it there again says nothing).
  const titleErr = el('p', { id: 'qa-title-err', class: 'qa-field-err hidden', role: 'alert' });
  const projectSel = el('select', { id: 'qa-project', class: 'field' });
  const columnSel = el('select', { id: 'qa-column', class: 'field' });
  const noticeBox = el('p', { class: 'qa-hint', role: 'status' });
  const prioritySel = el('select', { id: 'qa-priority', class: 'field' }, PRIORITIES.map((p) => el('option', { value: p }, PRIORITY_NAMES[p])));
  const dueInput = el('input', { id: 'qa-due', class: 'field', type: 'date' });
  const repeatBox = el('div', { class: 'qa-repeat' });
  const peopleBox = el('div', { class: 'qa-people' });
  const descInput = el('textarea', { id: 'qa-desc', class: 'field', rows: '3', maxlength: String(DESCRIPTION_MAX), placeholder: 'Details, links, acceptance notes…' });
  const pageNote = el('p', { class: 'qa-hint qa-live', role: 'status' });
  const filesList = el('ul', { class: 'qa-files' });
  const fileInput = el('input', { type: 'file', multiple: 'multiple', class: 'sr-only', 'aria-label': 'Attach files' });
  // A toolbar popup closes as soon as you click or drag in another window, so it never says "drop"
  // (M1); the small window the right-click menu opens before Chrome 127 does take dropped files.
  const pasteKeys = isMac() ? '⌘V' : 'Ctrl+V';
  const dropLabel = () => (ctx.inWindow
    ? ['Drop files here or ', el('span', { class: 'qa-link' }, 'browse')]
    : [el('span', { class: 'qa-link' }, 'Choose files'), ' or paste a picture']);
  const dropText = el('span', { class: 'qa-drop-main' }, dropLabel());
  const dropZone = el('label', { class: 'qa-drop' }, dropText,
    el('span', { class: 'qa-hint' }, `${ctx.inWindow ? `Or paste a picture (${pasteKeys})` : `Paste with ${pasteKeys}`} · up to ${MAX_UPLOAD_MB} MB each · pictures are made smaller to save space`),
    fileInput);
  const clearBtn = el('button', { class: 'btn sm ghost hidden', type: 'button', onClick: () => clearForm() }, 'Clear');
  const createBtn = el('button', { class: 'btn primary', type: 'submit', 'aria-keyshortcuts': 'Control+Enter', title: `Create task (${isMac() ? '⌘' : 'Ctrl'}+Enter)` }, 'Create task');
  const recentBox = el('section', { class: 'qa-recent', 'aria-label': 'Recently added' });
  const footer = el('footer', { class: 'qa-foot' });

  // From a board: its project, shown (as on the web) — the column can still be changed.
  const projectField = place
    ? el('div', {}, el('span', { class: 'lbl', id: 'qa-project-lbl' }, 'Project'),
      el('div', { class: 'field qa-fixed', id: 'qa-project', role: 'group', 'aria-labelledby': 'qa-project-lbl' },
        ProjectAvatar(place.project, { size: 'sm', apiBase: ctx.apiBase }),
        el('span', { dir: 'auto' }, place.project.name || place.project.code || 'Project')))
    : el('div', {}, el('label', { class: 'lbl', for: 'qa-project' }, 'Project'), projectSel);
  const form = el('form', { class: 'qa-form', 'aria-label': 'New task', novalidate: 'novalidate' },
    bannerBox,
    describeBox,
    el('div', {}, el('label', { class: 'lbl', for: 'qa-title' }, 'Task title', el('span', { class: 'qa-req', 'aria-hidden': 'true' }, ' *')), titleInput, titleErr),
    el('div', { class: 'qa-row' },
      projectField,
      el('div', {}, el('label', { class: 'lbl', for: 'qa-column' }, 'Column'), columnSel)),
    noticeBox,
    el('div', { class: 'qa-row' },
      el('div', {}, el('label', { class: 'lbl', for: 'qa-priority' }, 'Priority'), prioritySel),
      el('div', {}, el('label', { class: 'lbl', for: 'qa-due' }, 'Due date ', el('span', { class: 'qa-opt' }, '(optional)')), dueInput)),
    repeatBox,
    el('div', {}, el('span', { class: 'lbl' }, 'Assignees ', el('span', { class: 'qa-opt' }, '(optional)')), peopleBox),
    el('div', {},
      el('div', { class: 'qa-label-row' },
        el('label', { class: 'lbl', for: 'qa-desc' }, 'Description ', el('span', { class: 'qa-opt' }, '(optional)')),
        place ? null : el('button', { class: 'linkbtn', type: 'button', title: 'Put this page’s title and address into the description', onClick: () => addPage() }, 'Add this page')),
      descInput, pageNote),
    el('div', {}, el('span', { class: 'lbl' }, 'Attachments ', el('span', { class: 'qa-opt' }, '(optional)')), filesList, dropZone),
    el('div', { class: 'qa-actions' }, clearBtn, el('span', { class: 'sp' }), createBtn),
  );

  const root = place
    ? el('div', { class: 'qa qa-in-app' },
      el('header', { class: 'qa-head' },
        el('h2', { class: 'qa-brand', id: 'qa-dialog-title' }, 'New task'),
        el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onClick: () => requestClose() }, el('span', { 'aria-hidden': 'true' }, '✕'))),
      offbar, form, announcer)
    : el('div', { class: 'qa' }, header(ctx), offbar, form, recentBox, footer, announcer);
  root.requestClose = () => requestClose();

  // ---- Events -------------------------------------------------------------------------------
  titleInput.addEventListener('input', () => {
    fields().title = titleInput.value;
    if (!titleErr.classList.contains('hidden')) setTitleError('');
    changed();
  });
  descInput.addEventListener('input', () => { fields().description = descInput.value; changed(); });
  prioritySel.addEventListener('change', () => { fields().priority = prioritySel.value; changed(); });
  dueInput.addEventListener('input', () => { fields().dueDate = dueInput.value; renderRepeat(); changed(); });
  dueInput.addEventListener('change', () => { if (fields().dueDate !== dueInput.value) { fields().dueDate = dueInput.value; renderRepeat(); changed(); } });
  projectSel.addEventListener('change', () => chooseProject(projectSel.value));
  columnSel.addEventListener('change', () => { fields().columnId = columnSel.value; state.placeChosen = true; changed(); });
  describeText.addEventListener('input', () => {
    if (state.describe.problem) { state.describe.problem = null; renderDescribe(); }
    readBtn.disabled = !describeText.value.trim() || state.describe.reading;
  });
  fileInput.addEventListener('change', () => {
    addFiles(Array.from(fileInput.files || []));
    try { fileInput.value = ''; } catch { /* some browsers */ }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); void submit(); });
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (e.target === describeText) void read();
    else void submit();
  });
  // A picture pasted anywhere in the form is added to its files; text pasted into a field stays text.
  form.addEventListener('paste', (e) => {
    if (state.saving || state.created) return;
    const got = pastedFiles(e.clipboardData, { typing: isTypingTarget(e.target) });
    if (!got.length) return;
    e.preventDefault();
    addFiles(got);
    announce(got.length === 1 ? `Added ${got[0].name}.` : `Added ${got.length} files.`);
  });
  const hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
  form.addEventListener('dragover', (e) => {
    if (state.saving || state.created || !hasFiles(e)) return;
    e.preventDefault();
    form.classList.add('dragging');
    dropText.textContent = 'Drop to add';
  });
  form.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && form.contains(e.relatedTarget)) return;
    form.classList.remove('dragging');
    mount(dropText, dropLabel());
  });
  form.addEventListener('drop', (e) => {
    if (state.saving || state.created) return;
    e.preventDefault();
    form.classList.remove('dragging');
    mount(dropText, dropLabel());
    addFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
  });
  const onConnection = (e) => {
    offbar.classList.toggle('hidden', ctx.isOnline());
    if (e && e.type === 'offline') announce(OFFLINE_TEXT);
    if (e && e.type === 'online') announce('Back online.');
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onConnection);
    window.addEventListener('offline', onConnection);
  }
  // In a window of its own the form stays open: a new right-click capture comes to it (popup.js).
  if (typeof ctx.onCapture === 'function') ctx.onCapture((capture) => useCapture(capture));
  // In the app, Escape closes the dialog — asking first when something was typed.
  if (place) {
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      requestClose();
    });
  }

  onConnection();
  renderProjects();
  renderColumns();
  renderPeople();
  renderFiles();
  renderActions();
  void (place ? initInApp() : init());
  return root;

  // ---- Loading ------------------------------------------------------------------------------
  /** From a board: its project and column, nothing kept from before (the app's form isn't the popup's). */
  async function initInApp() {
    state.projects = [place.project];
    state.projectsLoaded = true;
    state.fields.projectId = place.project.id;
    state.fields.columnId = place.columnId || '';
    state.initial = { ...BLANK, projectId: place.project.id };
    renderProjects();
    await loadPlace();
  }

  /**
   * Close the dialog in the app: at once when nothing was typed (or the task exists already: then
   * it is done); otherwise ask first, with "Keep editing" focused, as on the web.
   */
  function requestClose() {
    if (!place || state.saving) return;
    if (state.created) {
      const task = state.created;
      state.created = null;
      finished(task);
      return;
    }
    if (!isDirty()) {
      ctx.onCancel();
      return;
    }
    setBanner('info', 'Discard this task? What you entered hasn’t been saved.', [
      { label: 'Keep editing', onClick: () => { setBanner(null); titleInput.focus(); } },
      { label: 'Discard', onClick: () => ctx.onCancel() },
    ]);
    const keep = bannerBox.querySelector('button');
    if (keep) keep.focus();
  }

  async function init() {
    // The form not sent last time (only this person's), then what the right-click menu captured.
    let restored = null; // { files, maybeSent }: how the form not sent last time comes back
    let createdBefore = null; // the popup closed after the task was created (while its files went up)
    try {
      const draft = ownedBy(((await ctx.session.get(DRAFT_KEY)) || {})[DRAFT_KEY], ctx.me.id);
      if (draft && draft.createdTask && typeof draft.createdTask === 'object') {
        createdBefore = draft.createdTask;
      } else if (draft && draft.fields) {
        state.fields = { ...BLANK, ...draft.fields, assigneeIds: Array.isArray(draft.fields.assigneeIds) ? [...draft.fields.assigneeIds] : [] };
        state.placeChosen = !!draft.placeChosen;
        if (typeof draft.pendingKey === 'string' && typeof draft.payloadJSON === 'string') state.pending = { key: draft.pendingKey, payloadJSON: draft.payloadJSON };
        for (const [id, name] of Object.entries(draft.names && typeof draft.names === 'object' ? draft.names : {})) {
          if (typeof name === 'string' && name && !known.has(id)) known.set(id, name);
        }
        restored = { files: Number(draft.files) || 0, maybeSent: !!state.pending };
      }
    } catch {
      /* no session storage: start empty */
    }
    if (ctx.capture) state.fields = mergeCapture(state.fields, ctx.capture);
    syncInputs();
    // The form is on the page by now (it is returned first, then drawn): start typing the title.
    if (!document.activeElement || document.activeElement === document.body) titleInput.focus();
    if (createdBefore) {
      // Never the form again (that would make a second task): the task exists — say so, once.
      const id = createdBefore.id;
      setBanner('success', createdBeforeMessage(createdBefore), id ? { label: 'Open it', onClick: () => openFull(ctx, `#/task/${encodeURIComponent(id)}`) } : undefined);
    } else if (restored) {
      // Files that weren't kept, or a task that may have been sent, are shown as well as read out.
      if (restored.files || restored.maybeSent) setBanner('info', restoredMessage(restored));
      else announce(restoredMessage(restored));
    }
    if (restored || createdBefore || ctx.capture) saveDraft();

    let lastId = null;
    try {
      const last = ownedBy(((await ctx.local.get(LAST_PROJECT_KEY)) || {})[LAST_PROJECT_KEY], ctx.me.id);
      lastId = last ? last.projectId : null;
    } catch {
      lastId = null;
    }
    let currentId = null;
    try {
      const page = await ctx.currentPage();
      currentId = page && page.url ? projectFromUrl(page.url, { appBase: ctx.appBase, appPage: ctx.appPage }) : null;
    } catch {
      currentId = null;
    }
    // A form brought back may name people who have left its project's team since (M3): take them off.
    await loadProjects({ currentId, lastId, prune: !!restored });
    renderRecent();
    try {
      const sc = await ctx.shortcut();
      mount(footer, sc ? `Open this from any page with ${sc}.` : 'Tip: give this a keyboard shortcut at chrome://extensions/shortcuts.');
    } catch {
      /* no commands API */
    }
  }

  async function loadProjects({ currentId = null, lastId = null, prune = false } = {}) {
    try {
      state.projects = openProjects((await ctx.api.projects.list()).data);
    } catch (e) {
      state.projects = [];
      state.projectsLoaded = true;
      renderProjects();
      setBanner('error', messageFor(e, 'Your projects couldn’t be loaded. Check the connection and try again.'), { label: 'Try again', onClick: () => loadProjects({ currentId, lastId, prune }) });
      return;
    }
    state.projectsLoaded = true;
    const f = fields();
    const keep = f.projectId && state.projects.some((p) => p.id === f.projectId);
    const start = startProjectId(state.projects, { currentId, lastId });
    if (!keep) {
      f.projectId = start;
      f.columnId = '';
      state.placeChosen = false;
    }
    state.initial = { ...BLANK, projectId: state.placeChosen ? start : f.projectId };
    if (!state.projects.length) setBanner('info', 'Create a project first, then you can add tasks to it.');
    renderProjects();
    await loadPlace({ prune });
  }

  /** The chosen project's columns and team. `prune`: take off people who aren't on it (a project change). */
  async function loadPlace({ preferCategory = null, prune = false } = {}) {
    const pid = fields().projectId;
    state.columns = null;
    state.members = undefined;
    renderColumns();
    renderPeople();
    const [cols, team] = await Promise.allSettled([
      pid ? ctx.api.projects.columns(pid) : Promise.resolve({ data: [] }),
      pid ? ctx.api.projects.members(pid) : Promise.resolve({ data: [] }),
    ]);
    if (pid !== fields().projectId) return; // another project was chosen meanwhile
    state.columns = cols.status === 'fulfilled' ? boardColumns(cols.value && cols.value.data) : [];
    fields().columnId = pickColumn(state.columns, { currentId: fields().columnId, preferCategory });
    state.members = team.status === 'fulfilled' ? (Array.isArray(team.value && team.value.data) ? team.value.data : []) : null;
    for (const m of state.members || []) known.set(m.id, personName(m));
    if (prune && state.members) {
      const onTeam = new Set(state.members.map((m) => m.id));
      const gone = fields().assigneeIds.filter((id) => !onTeam.has(id));
      if (gone.length) {
        fields().assigneeIds = fields().assigneeIds.filter((id) => onTeam.has(id));
        state.notice = removedNotice(gone.map((id) => known.get(id) || 'Someone'), projectOf(pid)?.name);
      }
    }
    renderColumns();
    renderPeople();
    saveDraft();
  }

  function projectOf(id) {
    return state.projects.find((p) => p.id === id) || null;
  }

  function chooseProject(id) {
    const f = fields();
    if (!id || id === f.projectId) return;
    const preferCategory = ((state.columns || []).find((c) => c.id === f.columnId) || {}).category || null;
    state.notice = '';
    state.placeChosen = true;
    f.projectId = id;
    f.columnId = '';
    projectSel.value = id;
    changed();
    void loadPlace({ preferCategory, prune: true });
  }

  // ---- Rendering ----------------------------------------------------------------------------
  function syncInputs() {
    const f = fields();
    titleInput.value = f.title;
    descInput.value = f.description;
    prioritySel.value = f.priority;
    dueInput.value = f.dueDate;
    projectSel.value = f.projectId;
    renderRepeat();
    renderPeople();
    renderActions();
  }

  function projectLabel(p) {
    return [p.name, p.code].filter(Boolean).join(' · ');
  }

  function renderProjects() {
    if (!state.projectsLoaded) {
      mount(projectSel, el('option', { value: '' }, 'Loading…'));
      projectSel.disabled = true;
      return;
    }
    if (!state.projects.length) {
      mount(projectSel, el('option', { value: '' }, 'No projects yet'));
      projectSel.disabled = true;
      return;
    }
    projectSel.disabled = state.saving;
    mount(projectSel, state.projects.map((p) => el('option', { value: p.id }, projectLabel(p))));
    projectSel.value = fields().projectId;
  }

  function renderColumns() {
    if (state.columns === null) {
      mount(columnSel, el('option', { value: '' }, fields().projectId || !state.projectsLoaded ? 'Loading…' : '—'));
      columnSel.disabled = true;
      return;
    }
    if (!state.columns.length) {
      mount(columnSel, el('option', { value: '' }, 'This project has no columns'));
      columnSel.disabled = true;
      return;
    }
    columnSel.disabled = state.saving;
    mount(columnSel, state.columns.map((c) => el('option', { value: c.id }, c.name)));
    columnSel.value = fields().columnId;
    noticeBox.textContent = state.notice;
  }

  function untilProblem() {
    const { rule, dueDate } = fields();
    return rule && rule.until && dueDate && String(rule.until).slice(0, 10) < dueDate ? 'The repeat can’t end before the due date.' : '';
  }

  function renderRepeat() {
    const { rule, dueDate } = fields();
    if (!rule) {
      mount(repeatBox);
      return;
    }
    const problem = untilProblem();
    mount(repeatBox,
      el('div', { class: 'qa-repeat-line' },
        el('span', { 'aria-hidden': 'true' }, '🔁 '),
        el('span', {}, scheduleText(rule, dueDate)),
        el('button', { class: 'linkbtn', type: 'button', onClick: () => { fields().rule = null; renderRepeat(); changed(); } }, 'Don’t repeat')),
      problem ? el('p', { class: 'qa-field-err', role: 'alert' }, problem) : null,
      !dueDate ? el('p', { class: 'qa-hint' }, 'Set a due date to see the next dates in the app.') : null,
    );
  }

  /** Redraw a part of the form keeping keyboard focus on the same control (or a sensible one). */
  function redrawKeepingFocus(container, draw, fallback) {
    const a = document.activeElement;
    const had = a && container.contains(a) ? { id: a.id, label: a.getAttribute('aria-label'), text: a.textContent } : null;
    draw();
    if (!had) return;
    const again = (had.id && container.querySelector(`#${had.id}`))
      || (had.label && [...container.querySelectorAll('[aria-label]')].find((n) => n.getAttribute('aria-label') === had.label))
      || [...container.querySelectorAll('button')].find((n) => n.textContent === had.text);
    const target = again || (fallback && fallback());
    if (target && !target.disabled) target.focus();
  }

  function renderPeople() {
    redrawKeepingFocus(peopleBox, drawPeople, () => peopleBox.querySelector('select'));
    noticeBox.textContent = state.notice;
  }

  function drawPeople() {
    const f = fields();
    const ids = f.assigneeIds;
    const team = state.members;
    const meOnTeam = team == null || team.some((m) => m.id === ctx.me.id);
    const rest = (team || []).filter((m) => !ids.includes(m.id));
    const project = projectOf(f.projectId);
    const ownerName = project && project.ownerId && team && team.some((m) => m.id === project.ownerId) ? known.get(project.ownerId) : null;
    const placeholder = team === undefined ? 'Loading…'
      : team === null ? 'The team shows when you’re online'
        : rest.length ? 'Add people…'
          : team.length ? 'Everyone on this project is picked' : 'No one is on this project yet';
    const select = el('select', { id: 'qa-people', class: 'field', 'aria-label': 'Add people', disabled: !rest.length || state.saving },
      el('option', { value: '' }, placeholder),
      rest.map((m) => el('option', { value: m.id }, `${personName(m)}${m.id === ctx.me.id ? ' (you)' : ''}`)));
    select.value = '';
    select.addEventListener('change', () => {
      const id = select.value;
      if (!id) return;
      f.assigneeIds = [...f.assigneeIds, id];
      changed();
      renderPeople();
      announce(`Assigned ${known.get(id) || 'them'}.`);
    });
    const note = assigneeNote(ids, ownerName);
    mount(peopleBox,
      ids.length ? el('ul', { class: 'qa-chips', 'aria-label': 'Assigned people' }, ids.map((id) => {
        const name = known.get(id) || 'Someone';
        return el('li', { class: 'qa-chip' },
          el('span', {}, id === ctx.me.id ? `${name} (you)` : name),
          el('button', {
            type: 'button', class: 'qa-chip-x', 'aria-label': `Remove ${name}`, title: `Remove ${name}`, disabled: state.saving,
            onClick: () => { f.assigneeIds = f.assigneeIds.filter((x) => x !== id); changed(); renderPeople(); announce(`Removed ${name}.`); },
          }, el('span', { 'aria-hidden': 'true' }, '✕')));
      })) : null,
      el('div', { class: 'qa-people-row' },
        !ids.includes(ctx.me.id) && meOnTeam && f.projectId
          ? el('button', { class: 'btn sm', type: 'button', disabled: state.saving, onClick: () => { f.assigneeIds = [...f.assigneeIds, ctx.me.id]; changed(); renderPeople(); announce('Assigned you.'); } }, 'Assign me')
          : null,
        select),
      note ? el('p', { class: 'qa-hint' }, note) : null,
    );
  }

  function renderFiles() {
    const removable = !state.saving && !state.created;
    redrawKeepingFocus(filesList, () => mount(filesList, state.files.map((p) => el('li', { class: 'qa-file' },
      thumb(p),
      el('span', { class: 'qa-file-body' },
        el('span', { class: 'qa-file-name' }, p.file.name),
        p.error ? el('span', { class: 'qa-file-err' }, p.error)
          : el('span', { class: 'qa-hint' }, p.status === 'uploading' ? 'Uploading…' : p.status === 'done' ? 'Attached' : formatSize(p.file.size))),
      removable ? el('button', { type: 'button', class: 'qa-chip-x', 'aria-label': `Remove ${p.file.name}`, title: `Remove ${p.file.name}`, onClick: () => removeFile(p.key) },
        el('span', { 'aria-hidden': 'true' }, '✕')) : null,
    ))), () => fileInput);
    dropZone.classList.toggle('hidden', !removable);
  }

  function thumb(p) {
    if (p.file.type && p.file.type.startsWith('image/') && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      if (!p.url) p.url = URL.createObjectURL(p.file);
      return el('img', { class: 'qa-thumb', src: p.url, alt: '' });
    }
    return el('span', { class: 'qa-thumb', 'aria-hidden': 'true' }, (p.file.name.split('.').pop() || 'file').slice(0, 4));
  }

  function renderActions() {
    const uploading = state.files.some((p) => p.status === 'uploading');
    createBtn.disabled = state.saving || (state.projectsLoaded && !state.projects.length);
    createBtn.textContent = state.saving ? (uploading ? 'Attaching files…' : 'Creating…') : state.created ? 'Done' : 'Create task';
    clearBtn.classList.toggle('hidden', !isDirty() || state.saving || !!state.created);
    projectSel.disabled = state.saving || !state.projects.length;
  }

  function renderDescribe() {
    const d = state.describe;
    readBtn.disabled = !describeText.value.trim() || d.reading;
    readBtn.textContent = d.reading ? 'Reading…' : 'Fill task details';
    readBtn.setAttribute('aria-busy', d.reading ? 'true' : 'false');
    mount(describeResult,
      d.problem ? el('p', { class: 'qa-problem', role: 'alert' }, d.problem) : null,
      d.found && !d.found.length ? el('p', { class: 'qa-hint' }, 'Nothing new to fill in from that description.') : null,
      d.found && d.found.length ? suggestionsGroup(d.found) : null,
    );
  }

  function suggestionsGroup(found) {
    const useBtn = el('button', { class: 'btn primary sm', type: 'button', disabled: !found.some((s) => s.checked), onClick: () => apply() }, 'Use selected details');
    return el('div', { class: 'qa-suggest', role: 'group', 'aria-label': 'Suggested details' },
      el('p', { class: 'qa-suggest-head' }, 'Found in your description'),
      el('ul', {}, found.map((s) => el('li', {},
        el('label', { class: 'qa-suggest-item' },
          el('input', {
            type: 'checkbox', checked: s.checked, 'aria-label': `${s.label}: ${s.shown}`,
            onChange: () => {
              state.describe.found = toggleSuggestion(state.describe.found, s.key);
              useBtn.disabled = !state.describe.found.some((x) => x.checked);
            },
          }),
          el('span', {},
            el('b', {}, `${s.label}:`), ' ', el('bdi', {}, s.shown),
            s.replaces ? el('span', { class: 'qa-replaces' }, `Replaces ${s.replaces}`) : null),
        )))),
      el('div', { class: 'qa-suggest-actions' },
        el('button', { class: 'btn sm ghost', type: 'button', onClick: () => { state.describe.found = null; renderDescribe(); describeText.focus(); } }, 'Dismiss'),
        useBtn),
    );
  }

  async function renderRecent() {
    if (place) return; // the app shows the task on its board instead
    let entries = [];
    let queue = [];
    try {
      const saved = ownedBy(((await ctx.local.get(RECENT_KEY)) || {})[RECENT_KEY], ctx.me.id);
      entries = saved && Array.isArray(saved.items) ? saved.items : [];
      queue = (await getQueue(ctx.local)).filter((i) => i.userId === ctx.me.id);
    } catch {
      entries = [];
    }
    if (!entries.length) {
      mount(recentBox);
      return;
    }
    mount(recentBox,
      el('h2', { class: 'qa-recent-head' }, 'Recently added'),
      el('ul', {}, entries.map((e) => el('li', {}, recentRow(e, recentStatus(e, queue))))));
  }

  function recentRow(e, status) {
    const name = [e.key ? el('span', { class: 'qa-key' }, e.key) : null, e.key ? ' ' : null, el('span', {}, e.title || 'Untitled')];
    const project = projectOf(e.projectId);
    if (status === 'created') return el('button', { class: 'qa-recent-row', type: 'button', title: 'Open in MICO360 Tasks', onClick: () => openFull(ctx, `#/task/${encodeURIComponent(e.id)}`) }, ...name);
    if (status === 'waiting') return el('div', { class: 'qa-recent-row' }, ...name, el('span', { class: 'qa-hint' }, ' · Waiting to sync'));
    if (status === 'failed') return el('button', { class: 'qa-recent-row', type: 'button', onClick: () => openFull(ctx, '#/settings') }, ...name, el('span', { class: 'qa-file-err' }, ' · Couldn’t sync — see Settings → Sync'));
    return el('button', { class: 'qa-recent-row', type: 'button', title: 'Open its board', onClick: () => openFull(ctx, e.projectId ? `#/board/${encodeURIComponent(e.projectId)}` : '') },
      ...name, el('span', { class: 'qa-hint' }, ` · Synced${project ? ` to ${project.name}` : ''}`));
  }

  // ---- Changes ------------------------------------------------------------------------------
  function isDirty() {
    const f = fields();
    return !!(f.title.trim() || f.description.trim() || f.dueDate || f.rule || f.assigneeIds.length || f.priority !== 'NORMAL' || state.files.length || state.placeChosen);
  }

  function changed() {
    if (state.held) {
      state.held = null; // "Save without the files" would send an older copy of the form
      setBanner(null);
    }
    saveDraft();
    renderActions();
  }

  /**
   * Keep the form not sent yet (memory only), for when the popup opens again — with the key of an
   * attempt that may have reached the server. Once the task exists, only the task is kept: the
   * popup can close while its files go up, and must not then offer the form again.
   * `draftWrite` settles when this write is done.
   */
  function saveDraft() {
    if (place) return draftWrite; // the app's dialog keeps no draft (the popup's stays the popup's)
    let value = null;
    if (state.created) {
      const t = state.created;
      value = { userId: ctx.me.id, createdTask: { id: t.id || '', key: t.key || '', title: t.title || '', withFiles: state.files.length > 0 } };
    } else if (isDirty()) {
      const ids = fields().assigneeIds;
      value = {
        userId: ctx.me.id,
        fields: { ...fields(), assigneeIds: [...ids] },
        placeChosen: state.placeChosen,
        // Files can't be kept (memory-only storage holds plain data): how many, so the popup can say so.
        files: state.files.length,
        // The people's names, for the chips and for saying who was taken off if they left the team.
        names: Object.fromEntries(ids.filter((id) => known.has(id)).map((id) => [id, known.get(id)])),
      };
      if (state.pending) Object.assign(value, { pendingKey: state.pending.key, payloadJSON: state.pending.payloadJSON });
    }
    draftWrite = draftWrite.then(() => (value ? ctx.session.set({ [DRAFT_KEY]: value }) : ctx.session.remove(DRAFT_KEY))).catch(() => { /* best effort */ });
    return draftWrite;
  }

  function setTitleError(message) {
    titleErr.textContent = message;
    titleErr.classList.toggle('hidden', !message);
    if (message) {
      titleInput.setAttribute('aria-invalid', 'true');
      titleInput.setAttribute('aria-describedby', 'qa-title-err');
    } else {
      titleInput.removeAttribute('aria-invalid');
      titleInput.removeAttribute('aria-describedby');
    }
  }

  /** `action`: `{ label, onClick }`, or a list of them. */
  function setBanner(kind, text, action) {
    if (!kind) {
      mount(bannerBox);
      return;
    }
    const actions = (Array.isArray(action) ? action : [action]).filter(Boolean);
    mount(bannerBox, el('div', { class: `qa-banner ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
      el('span', {}, text),
      actions.length ? el('div', { class: 'qa-banner-actions' },
        actions.map((a) => el('button', { class: 'btn sm', type: 'button', onClick: a.onClick }, a.label))) : null));
    // An alert is read out when it appears; a new status line may not be, so it is said as well.
    if (kind !== 'error') announce(text);
  }

  function announce(text) {
    announcer.textContent = text;
  }

  function addFiles(list) {
    if (!list.length || state.saving || state.created) return;
    for (const file of list) state.files.push({ key: `f${(fileSeq += 1)}`, file, status: 'ready', error: null });
    renderFiles();
    changed();
  }

  function removeFile(key) {
    const p = state.files.find((x) => x.key === key);
    if (p && p.url) URL.revokeObjectURL(p.url);
    state.files = state.files.filter((x) => x.key !== key);
    renderFiles();
    changed();
  }

  /** Start the next task in the same place: the project and column stay, everything else is cleared. */
  function resetForm() {
    for (const p of state.files) if (p.url) URL.revokeObjectURL(p.url);
    const { projectId, columnId } = fields();
    state.fields = { ...BLANK, assigneeIds: [], projectId, columnId };
    state.initial = { ...BLANK, projectId };
    state.placeChosen = false;
    state.files = [];
    state.created = null;
    state.held = null;
    state.pending = null;
    state.notice = '';
    state.describe = { reading: false, problem: null, found: null };
    describeText.value = '';
    setTitleError('');
    pageNote.textContent = '';
    syncInputs();
    renderFiles();
    renderDescribe();
    saveDraft();
  }

  function clearForm() {
    resetForm();
    setBanner(null);
    titleInput.focus();
    announce('The form is cleared.');
  }

  /** What the right-click menu captured while the form was open: added as at the start (nothing typed is replaced). */
  function useCapture(capture) {
    if (!capture) return;
    if (state.saving) {
      state.nextCapture = capture;
      return;
    }
    if (state.created) resetForm(); // that task exists already: what was picked starts the next one
    state.fields = mergeCapture(state.fields, capture);
    syncInputs();
    changed();
    titleInput.focus();
    announce('What you picked on the page is in the form.');
  }

  // ---- "Describe it" ------------------------------------------------------------------------
  async function read() {
    const text = describeText.value.trim();
    if (!text || state.describe.reading) return;
    state.describe = { reading: true, problem: null, found: null };
    renderDescribe();
    try {
      const draft = await ctx.api.ai.parseTask(text, todayKey(ctx.timeZone));
      const f = fields();
      const current = { title: f.title, description: f.description, dueDate: f.dueDate, priority: f.priority, rule: f.rule, projectId: f.projectId };
      state.describe.found = suggestionsFrom(draft, current, state.initial, { projects: state.projects, projectChosen: state.placeChosen });
    } catch (e) {
      state.describe.problem = describeFailure(e, { online: ctx.isOnline() });
    } finally {
      state.describe.reading = false;
      renderDescribe();
    }
  }

  function apply() {
    const { projectId, ...patch } = chosenPatch(state.describe.found);
    if (projectId) chooseProject(projectId); // its columns and people follow, as when picked by hand
    Object.assign(fields(), patch);
    if (patch.title) setTitleError('');
    state.describe.found = null;
    syncInputs();
    changed();
    renderDescribe();
    titleInput.focus();
    announce('The details you chose are filled in.');
  }

  // ---- "Add this page" ----------------------------------------------------------------------
  async function addPage() {
    let page = null;
    try {
      page = await ctx.currentPage();
    } catch {
      page = null;
    }
    if (!page || !isAddablePage(page.url)) {
      pageNote.textContent = 'This page can’t be added — only web pages (http or https) can.';
      return;
    }
    const r = withPage(fields().description, page);
    if (!r.added) {
      pageNote.textContent = 'This page is in the description already.';
      return;
    }
    fields().description = r.description;
    descInput.value = r.description;
    changed();
    pageNote.textContent = 'Added this page to the description.';
  }

  // ---- Creating -----------------------------------------------------------------------------
  async function submit() {
    if (state.saving) return;
    if (state.created) {
      const task = state.created; // the task exists already: never a second one
      state.created = null;
      finished(task);
      return;
    }
    const f = fields();
    if (!f.title.trim()) {
      setTitleError('Give the task a title.');
      titleInput.focus();
      return;
    }
    if (untilProblem()) {
      renderRepeat();
      return;
    }
    if (!f.projectId || !f.columnId) {
      setBanner('error', state.projects.length ? 'Choose where the task goes: its project and column.' : 'Create a project first, then you can add tasks to it.');
      return;
    }
    const payload = buildQuickAddPayload(f);
    // From a board: the task lands on the day the board shows, as on the web.
    if (place && place.boardDate) payload.boardDate = place.boardDate;
    const payloadJSON = JSON.stringify(payload);
    const withFiles = state.files.length > 0;
    // One key per task, not per click: the offline queue reuses it, and so does sending the same task
    // again (held, timed out, or the popup closed mid-send), so a create that did reach the server
    // is answered with that task instead of making a second one. `changed()` lets go of a held one.
    const key = state.held ? state.held.key
      : state.pending && state.pending.payloadJSON === payloadJSON ? state.pending.key
        : ctx.newKey();
    if (withFiles && !ctx.isOnline()) {
      hold(payload, key);
      return;
    }
    if (bannerBox.contains(document.activeElement)) createBtn.focus(); // "Try again" goes with the banner
    setSaving(true);
    setBanner(null);
    try {
      // Kept with the form before it goes: if the popup closes now, the next try uses the same key.
      state.pending = { key, payloadJSON };
      await saveDraft();
      const r = await ctx.send('task.create', payload, { idempotencyKey: key, hold: withFiles });
      if (r.held) {
        hold(payload, key);
        return;
      }
      if (r.queued) {
        await queued(r.item, payload, QUEUED_MESSAGE);
        return;
      }
      const task = r.data || {};
      await exists(task);
      await remember(task, payload);
      if (withFiles) {
        const failed = await uploadAll(task);
        if (failed.length) {
          setBanner('error', attachFailureMessage(failed));
          return;
        }
      }
      finished(task);
    } catch (e) {
      if (forgetSpentKey(e)) state.held = null;
      if (state.held) showHeld(createFailure(e)); // still held, with its key: the offer stays
      else setBanner('error', createFailure(e));
    } finally {
      setSaving(false);
    }
  }

  /** The task exists: from now on only it is kept (reopened, the popup says so — never a second one). */
  async function exists(task) {
    state.pending = null;
    state.created = task;
    await saveDraft();
  }

  /**
   * The server answered this attempt for good (it keeps that answer for the key, as for a created
   * task): the same key would only replay it, so the next try is a fresh one. A request that may not
   * have arrived, or that is still being processed (409), keeps its key.
   */
  function forgetSpentKey(e) {
    if (!keyIsSpent(e)) return false;
    state.pending = null;
    saveDraft();
    return true;
  }

  /** While a task is being created nothing about it can change; afterwards every control is back. */
  function setSaving(on) {
    state.saving = on;
    renderActions();
    renderFiles();
    renderPeople();
    renderProjects();
    renderColumns();
    if (!on && state.nextCapture) {
      const capture = state.nextCapture;
      state.nextCapture = null;
      useCapture(capture);
    }
  }

  /** Files can't wait offline with the task (as on the web): say so, and offer to save it without them. */
  function hold(payload, key) {
    state.held = { payload, key };
    showHeld(ctx.isOnline() ? UNREACHABLE_FILES_MESSAGE : OFFLINE_FILES_MESSAGE);
  }

  /** The held task's choices: "Try again" (with its files, the same key) or "Save without the files". Focus goes to them. */
  function showHeld(text) {
    setBanner('error', text, [
      { label: 'Try again', onClick: () => submit() },
      { label: 'Save without the files', onClick: () => saveWithoutFiles() },
    ]);
    const first = bannerBox.querySelector('button');
    if (first) first.focus();
  }

  async function saveWithoutFiles() {
    const held = state.held;
    if (!held || state.saving) return;
    setSaving(true);
    try {
      // The same key as the attempt with files: if that one did reach the server, this can't make a second task.
      state.pending = { key: held.key, payloadJSON: JSON.stringify(held.payload) };
      await saveDraft();
      const r = await ctx.send('task.create', held.payload, { idempotencyKey: held.key, hold: false });
      state.held = null;
      if (r.queued) {
        await queued(r.item, held.payload, QUEUED_WITHOUT_FILES_MESSAGE);
      } else {
        await exists(r.data || {});
        await remember(r.data || {}, held.payload);
        succeed(r.data || {}, ' Its files weren’t attached — add them from the task.');
      }
    } catch (e) {
      // Still held, with its key (a retry or "Save without the files" can't make a second task) —
      // unless the server answered for good: then the next try is a fresh one.
      if (forgetSpentKey(e)) {
        state.held = null;
        setBanner('error', createFailure(e));
      } else {
        showHeld(createFailure(e));
      }
    } finally {
      setSaving(false);
    }
  }

  /** Upload the new task's files one by one; returns the ones that couldn't go up. */
  async function uploadAll(task) {
    const failed = [];
    for (const p of state.files) {
      p.status = 'uploading';
      p.error = null;
      renderFiles();
      renderActions();
      try {
        await ctx.api.attachments.upload(task.id, p.file);
        p.status = 'done';
      } catch (e) {
        p.status = 'error';
        p.error = fileFailure(e);
        failed.push({ name: p.file.name, reason: p.error });
      }
      renderFiles();
    }
    return failed;
  }

  async function rememberProject(projectId) {
    try {
      await ctx.local.set({ [LAST_PROJECT_KEY]: { userId: ctx.me.id, projectId } });
    } catch {
      /* best effort */
    }
  }

  async function addRecent(entry) {
    try {
      const saved = ownedBy(((await ctx.local.get(RECENT_KEY)) || {})[RECENT_KEY], ctx.me.id);
      await ctx.local.set({ [RECENT_KEY]: { userId: ctx.me.id, items: rememberRecent(saved ? saved.items : [], entry) } });
    } catch {
      /* best effort */
    }
    await renderRecent();
  }

  async function remember(task, payload) {
    await rememberProject(payload.projectId);
    await addRecent({ id: task.id, key: task.key || '', title: task.title || payload.title, projectId: payload.projectId, at: Date.now() });
  }

  async function queued(item, payload, message) {
    await rememberProject(payload.projectId);
    await addRecent({ queuedKey: item && item.idempotencyKey, title: payload.title, projectId: payload.projectId, at: Date.now() });
    if (place) {
      ctx.onDone({ item, payload, message }); // the board shows it, saved on this device
      return;
    }
    resetForm();
    setBanner('info', message);
    titleInput.focus();
  }

  /**
   * The task and its files are all there. In a window of its own (the right-click menu before Chrome
   * 127) the window then closes — unless something new was picked meanwhile, which fills the form.
   * (Saved without its files, or kept on this device, the form stays to say so.)
   */
  function finished(task) {
    succeed(task);
    if (ctx.inWindow && !state.nextCapture) ctx.close();
  }

  function succeed(task, extra = '') {
    if (place) {
      ctx.onDone({ task, message: `${createdMessage(task)}${extra}` }); // the dialog closes; the board shows the card
      return;
    }
    resetForm();
    setBanner('success', `${createdMessage(task)}${extra}`, task && task.id ? { label: 'Open it', onClick: () => openFull(ctx, `#/task/${encodeURIComponent(task.id)}`) } : undefined);
    titleInput.focus();
  }
}
