// Pure helpers for quick capture: the toolbar popup's "New task" form and the right-click menu's
// "Add to MICO360 Tasks". Framework-free, so they are unit-tested, and the create and offline-queue
// paths send the same payload. Fields, rules and wording follow the web's New task form
// (Web Portal/frontend/src/components/task-form/TaskFormDialog.tsx).

/** As on the web form: the server's limits for a title and a description. */
export const TITLE_MAX = 191;
export const DESCRIPTION_MAX = 20000;
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
export const PRIORITY_NAMES = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

/**
 * chrome.storage.session (memory only, gone when the browser closes): the form not sent yet (a
 * popup closes as soon as you click outside it) and what the right-click menu captured for it.
 */
export const DRAFT_KEY = 'mico360.quickAdd.draft';
export const CAPTURE_KEY = 'mico360.quickAdd.capture';
export const QUICK_ADD_SESSION_KEYS = [DRAFT_KEY, CAPTURE_KEY];
/** chrome.storage.local, per person (wiped at sign-out): the project used last, and the tasks added here lately. */
export const LAST_PROJECT_KEY = 'quickAddLastProject';
export const RECENT_KEY = 'quickAddRecent';
export const RECENT_MAX = 5;

/** Split a comma-separated string into clean, de-duplicated (case-insensitive) tag names. */
export function parseTags(input) {
  const seen = new Set();
  const out = [];
  for (const raw of String(input ?? '').split(',')) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Build a POST /tasks payload from the quick-add form, filling project/column from
 * defaults. Returns null when the required title/project/column are missing so the
 * caller can surface a message instead of sending an invalid request. People are sent only when
 * someone was picked: otherwise the project's default (its owner) applies, as on the web.
 */
export function buildQuickAddPayload(form, defaults = {}) {
  const title = String(form.title ?? '').trim();
  const projectId = form.projectId || defaults.projectId;
  const columnId = form.columnId || defaults.columnId;
  if (!title || !projectId || !columnId) return null;

  const payload = { title, projectId, columnId, priority: form.priority || 'NORMAL' };

  const description = String(form.description ?? '').trim();
  if (description) payload.description = description;

  const dueDate = String(form.dueDate ?? '').trim();
  if (dueDate) payload.dueDate = dueDate;

  const est = typeof form.estimatedHours === 'number' ? form.estimatedHours : parseFloat(form.estimatedHours);
  if (Number.isFinite(est) && est > 0) payload.estimatedHours = est;

  const tags = Array.isArray(form.tags) ? parseTags(form.tags.join(',')) : parseTags(form.tags);
  if (tags.length > 0) payload.tags = tags;

  if (Array.isArray(form.assigneeIds)) {
    const ids = [...new Set(form.assigneeIds.filter((id) => id && String(id).trim()))];
    if (ids.length > 0) payload.assigneeIds = ids;
  }

  if (form.rule && typeof form.rule === 'object') payload.recurrenceRule = form.rule;

  return payload;
}

// ---- Where the task goes -------------------------------------------------------------------

/** The projects a new task can go to: every one that isn't archived. */
export function openProjects(projects) {
  return (Array.isArray(projects) ? projects : []).filter((p) => p && p.id && p.status !== 'ARCHIVED');
}

/** The project to start in: the current one (the page's), then the one used last, then the first. */
export function startProjectId(projects, { currentId, lastId } = {}) {
  const list = Array.isArray(projects) ? projects : [];
  const known = (id) => id && list.some((p) => p.id === id);
  return [currentId, lastId].find(known) || (list[0] && list[0].id) || '';
}

const parse = (url) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/**
 * The project a page shows, or null: the website's board (`/board?project=<id>`) or a project's
 * dashboard (`/projects/<id>`) under `appBase`, or this extension's board (`app.html#/board/<id>`).
 */
export function projectFromUrl(url, { appBase, appPage } = {}) {
  const u = parse(url);
  if (!u) return null;
  const page = appPage && parse(appPage);
  // Not `origin`: it is "null" for every chrome-extension:// address.
  if (page && u.protocol === page.protocol && u.host === page.host && u.pathname === page.pathname) {
    const m = /^#\/board\/([^/?#]+)/.exec(u.hash);
    return m ? decodeURIComponent(m[1]) : null;
  }
  const base = appBase && parse(appBase);
  if (!base || u.origin !== base.origin) return null;
  const prefix = base.pathname.replace(/\/+$/, '');
  if (prefix && u.pathname !== prefix && !u.pathname.startsWith(`${prefix}/`)) return null;
  const rest = u.pathname.slice(prefix.length) || '/';
  if (/^\/board\/?$/.test(rest)) return u.searchParams.get('project') || null;
  const m = /^\/projects\/([^/]+)\/?$/.exec(rest);
  return m ? decodeURIComponent(m[1]) : null;
}

/** A project's columns as its board shows them: switched-on ones, in board order. */
export function boardColumns(columns) {
  return (Array.isArray(columns) ? columns : []).filter((c) => c && c.enabled !== false).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * The column to start in: the one chosen when it is still there; after a project change the same
 * kind of column (e.g. "in progress") when the new project has one; else the first.
 */
export function pickColumn(columns, { currentId, preferCategory } = {}) {
  const list = Array.isArray(columns) ? columns : [];
  if (currentId && list.some((c) => c.id === currentId)) return currentId;
  const pick = (preferCategory && list.find((c) => c.category === preferCategory)) || list[0];
  return pick ? pick.id : '';
}

// ---- Who works on it -----------------------------------------------------------------------

export function personName(u) {
  if (!u) return 'Someone';
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'Someone';
}

export function listNames(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Shown under the people: who gets the task when nobody is picked (null when someone is). */
export function assigneeNote(assigneeIds, ownerName) {
  if (assigneeIds && assigneeIds.length) return null;
  return ownerName ? `Nobody picked — the task will go to ${ownerName}, the project owner.` : 'Nobody picked — the task will be unassigned.';
}

/** Someone who isn't on the newly chosen project can't work on the task there. */
export function removedNotice(names, projectName) {
  return `${listNames(names)} ${names.length === 1 ? 'isn’t' : 'aren’t'} on ${projectName || 'that project'}, so they were taken off this task.`;
}

// ---- The page you are on -------------------------------------------------------------------

/** A web page that can be added to a task (http or https; not a browser or extension page). */
export function isAddablePage(url) {
  const u = typeof url === 'string' ? parse(url) : null;
  return !!u && (u.protocol === 'https:' || u.protocol === 'http:');
}

/**
 * "Add this page": the page's title and address go at the end of the description, once.
 * Resolves `{ description, added }` (`added` false when it can't be added or is there already).
 */
export function withPage(description, page) {
  const text = String(description ?? '');
  if (!page || !isAddablePage(page.url) || text.includes(page.url)) return { description: text, added: false };
  const title = String(page.title ?? '').trim();
  const block = [title && title !== page.url ? title : '', page.url].filter(Boolean).join('\n');
  const before = text.replace(/\s+$/, '');
  return { description: before ? `${before}\n\n${block}` : block, added: true };
}

/** A title from any text: one line, single spaces, within the server's limit. */
function clipTitle(s) {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1)}…` : one;
}

/**
 * What a click on the right-click menu's "Add to MICO360 Tasks" captures (`info`, `tab` as Chrome
 * hands them to contextMenus.onClicked): `{ title, text, link, page }`. A selection becomes the
 * title (its first line); a link becomes the task (its selected text, else its address); otherwise
 * the page, by its title. Plain data, kept in session storage until the popup opens.
 */
export function captureFromContext(info = {}, tab = {}) {
  const t = tab || {};
  const pageUrl = info.pageUrl || t.url || '';
  const page = isAddablePage(pageUrl) ? { title: t.title || '', url: pageUrl } : null;
  const text = String(info.selectionText ?? '').trim();
  const link = isAddablePage(info.linkUrl) ? info.linkUrl : '';
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  const title = clipTitle(firstLine || link || t.title || pageUrl);
  return { title, text, link, page };
}

/** Add `part` to the end of a description (a blank line between), unless it is in it already. */
function joinPart(description, part) {
  if (!part || description.includes(part)) return description;
  const before = description.replace(/\s+$/, '');
  return before ? `${before}\n\n${part}` : part;
}

/**
 * Put a capture into the form. Nothing typed is replaced: an empty title takes the capture's, and
 * the rest (the selected text, the link, then the page) goes at the end of the description.
 * A value set from code skips the fields' `maxlength` (M7), so the result keeps to TITLE_MAX and
 * DESCRIPTION_MAX itself: a selection too long is shortened (the link and the page stay), and what
 * was typed is never cut.
 */
export function mergeCapture(fields, capture) {
  if (!capture) return fields;
  const titleFree = !String(fields.title ?? '').trim();
  const captured = clipTitle(capture.title);
  const title = titleFree ? captured : fields.title;
  // Only text that IS the title whole (spaces aside) is left out; a clipped one goes in full (I3).
  const isTitle = (v) => titleFree && !!v && String(v).replace(/\s+/g, ' ').trim() === captured;
  const typed = String(fields.description ?? '');
  const text = capture.text && !isTitle(capture.text) ? String(capture.text) : '';
  const link = capture.link && !isTitle(capture.link) ? capture.link : '';
  const page = capture.page && isTitle(capture.page.title) ? { title: '', url: capture.page.url } : capture.page;
  const build = (t) => withPage(joinPart(joinPart(typed, t), link), page).description;
  const fits = (d) => d.length <= DESCRIPTION_MAX;
  let description = build(text);
  if (!fits(description)) {
    const room = text.length - (description.length - DESCRIPTION_MAX); // what the selection may keep
    const shorter = room > 1 ? build(`${text.slice(0, room - 1)}…`) : '';
    description = [shorter, build(''), typed].find((d) => d && fits(d)) || typed;
  }
  return { ...fields, title, description };
}

// ---- Recent tasks (this device) ------------------------------------------------------------

/** A value kept for one person (`{ userId, … }`), or null when it is someone else's or missing. */
export function ownedBy(value, userId) {
  return value && typeof value === 'object' && userId && value.userId === userId ? value : null;
}

/** The tasks added here lately, newest first: `entry` in front, without repeats, at most `max`. */
export function rememberRecent(list, entry, max = RECENT_MAX) {
  const same = (e) => (entry.id && e.id === entry.id) || (entry.queuedKey && e.queuedKey === entry.queuedKey);
  return [entry, ...(Array.isArray(list) ? list : []).filter((e) => e && !same(e))].slice(0, max);
}

/**
 * Where a recent task stands: 'created' (it has its id), or — kept on this device — 'waiting' while
 * its change is queued, 'failed' when the sync gave up on it, 'synced' once it left the queue.
 */
export function recentStatus(entry, queue) {
  if (entry && entry.id) return 'created';
  const item = (Array.isArray(queue) ? queue : []).find((i) => i && entry && i.idempotencyKey === entry.queuedKey);
  if (!item) return 'synced';
  return item.status === 'failed' ? 'failed' : 'waiting';
}

// ---- What the person is told ---------------------------------------------------------------

const reached = (err) => !!err && typeof err.status === 'number';

/** Why a file couldn't be attached, in the web's words. */
export function fileFailure(err) {
  if (reached(err) && err.status === 413) return 'That file is too large to upload.';
  if (!reached(err)) return 'The server couldn’t be reached.';
  if (err.serverMessage) return err.serverMessage;
  return 'It couldn’t be uploaded.';
}

/** Why the task wasn't created (the web's words; a change that couldn't even be kept says so). */
export function createFailure(err) {
  if (err && err.userMessage) return err.userMessage;
  let reason = 'Please try again.';
  if (!reached(err)) reason = 'The server couldn’t be reached.';
  else if (err.status === 403) reason = 'You don’t have permission to do that.';
  else if (err.status < 500 && err.serverMessage) reason = err.serverMessage;
  return `Couldn’t create the task. ${reason}`;
}

/** The task exists, but some files didn't go up (each `{ name, reason }`). */
export function attachFailureMessage(failed) {
  if (failed.length === 1) return `The task was created, but ${failed[0].name} wasn’t attached: ${failed[0].reason}`;
  return `The task was created, but these files weren’t attached: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}. Add them from the task.`;
}

export function createdMessage(task) {
  return `Created ${task && task.key ? `${task.key} ` : ''}“${(task && task.title) || ''}”.`;
}

/**
 * The popup closed after the task was created (`{ key, title, withFiles }`, kept in place of the
 * form): reopened, it says the task exists — and, when it had files, to add them from the task.
 */
export function createdBeforeMessage(task) {
  if (!task || !task.withFiles) return createdMessage(task);
  return `${task.key ? `${task.key} ` : ''}“${task.title || ''}” was created; add its files from the task.`;
}

/**
 * Whether the server answered a create for good (4xx; not 409 "still being processed"). It keeps
 * that answer for the Idempotency-Key, so sending again with the same key would only replay it.
 * Anything else (no answer, a QueueError, a 5xx, which releases the key) may have reached it: keep it.
 */
export function keyIsSpent(err) {
  if (!reached(err) || err.status >= 500) return false;
  return !(err.status === 409 && err.code === 'IDEMPOTENCY_IN_PROGRESS');
}

/** The server can't be reached and files can't wait offline (as on the web): say so, never drop them silently. */
export const OFFLINE_FILES_MESSAGE = 'You’re offline, and files can’t be attached offline. Try again when you’re connected, or save the task now without its files.';
export const QUEUED_MESSAGE = 'Saved on this device — the task will be created when the connection is back.';
export const QUEUED_WITHOUT_FILES_MESSAGE = `${QUEUED_MESSAGE} Its files weren’t kept: add them to the task once it has synced.`;

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
