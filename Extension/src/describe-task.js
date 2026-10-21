/**
 * "Describe it in plain English": the assistant (POST /ai/parse-task) reads a sentence and suggests
 * a title, a description, a due date, a repeat, a priority and the project. Nothing changes until
 * the person chooses: a suggestion that would replace something they set themselves starts unticked
 * and says what it replaces. The same rules and words as the web's
 * Web Portal/frontend/src/components/task-form/DescribeTask.tsx. Pure, so it is unit-tested.
 *
 * `current` and `initial` are the form's values now and when it opened (what isn't the person's
 * own, such as the project it started in): `{ title, description, dueDate, priority, rule, projectId }`.
 */
import { recurrenceSummary } from './recurrence.js';
import { formatDayKey, isDayKey } from './due-date.js';
import { PRIORITY_NAMES, TITLE_MAX } from './quick-add.js';

export const DESCRIBE_FAILED = 'Couldn’t read that description. Try rephrasing it, or fill in the details yourself.';
export const DESCRIBE_OFFLINE = '“Describe it” needs a connection — you appear to be offline.';

const dayText = (key) => formatDayKey(key, { weekday: true, year: true });
const sameRule = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const projectText = (p) => [p.name, p.code, p.number].filter(Boolean).join(' · ');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const text = (v) => (typeof v === 'string' ? v : '');

/** "Repeats every week on Thu": a weekly rule without chosen days repeats on the due date's weekday. */
export function scheduleText(rule, dueDate) {
  if (rule && rule.freq === 'WEEKLY' && !(rule.weekdays && rule.weekdays.length) && isDayKey(dueDate)) {
    return recurrenceSummary({ ...rule, weekdays: [new Date(`${dueDate}T00:00:00Z`).getUTCDay()] });
  }
  return recurrenceSummary(rule);
}

/**
 * The suggestions in what the assistant read (`draft`, the server's answer), each `{ key, label,
 * shown, value, replaces, checked }`. Only something new is suggested. A project is offered only
 * from `projects` (those the task may go to); `projectChosen` says the person picked it by hand.
 */
export function suggestionsFrom(draft, current, initial, { projects, projectChosen = false } = {}) {
  const d = draft || {};
  const out = [];
  const curTitle = text(current.title).trim();
  const title = text(d.title).trim().slice(0, TITLE_MAX);
  if (title && title !== curTitle) {
    const mine = curTitle !== '';
    out.push({ key: 'title', label: 'Title', shown: title, value: title, replaces: mine ? `“${curTitle}”` : null, checked: !mine });
  }
  const curDescription = text(current.description);
  const description = text(d.description).trim();
  if (description && description !== curDescription.trim()) {
    const mine = curDescription.trim() !== '' && curDescription !== text(initial.description);
    out.push({
      key: 'description', label: 'Description', shown: clip(description, 200), value: description,
      replaces: curDescription.trim() ? `“${clip(curDescription.trim(), 60)}”` : null, checked: !mine,
    });
  }
  if (d.dueDate && d.dueDate !== current.dueDate) {
    const mine = !!current.dueDate && current.dueDate !== initial.dueDate;
    out.push({ key: 'dueDate', label: 'Due date', shown: dayText(d.dueDate), value: d.dueDate, replaces: current.dueDate ? dayText(current.dueDate) : null, checked: !mine });
  }
  if (d.recurrence && !sameRule(d.recurrence, current.rule)) {
    const startsOn = d.dueDate ?? current.dueDate;
    const mine = current.rule != null && !sameRule(current.rule, initial.rule);
    out.push({
      key: 'rule', label: 'Repeat', shown: scheduleText(d.recurrence, startsOn), value: d.recurrence,
      replaces: current.rule ? scheduleText(current.rule, current.dueDate) : null, checked: !mine,
    });
  }
  if (d.priority && d.priority !== current.priority) {
    const mine = current.priority !== initial.priority;
    out.push({ key: 'priority', label: 'Priority', shown: PRIORITY_NAMES[d.priority] || d.priority, value: d.priority, replaces: PRIORITY_NAMES[current.priority] || null, checked: !mine });
  }
  const list = Array.isArray(projects) ? projects : [];
  const project = d.project && d.project.id ? list.find((p) => p.id === d.project.id) : undefined;
  if (project && project.id !== current.projectId) {
    const mine = projectChosen || (!!current.projectId && current.projectId !== initial.projectId);
    const now = list.find((p) => p.id === current.projectId);
    const shown = projectText({ ...project, number: project.number ?? d.project.number });
    out.push({ key: 'projectId', label: 'Project', shown, value: project.id, replaces: now ? now.name : null, checked: !mine });
  }
  return out;
}

/** Tick or untick one suggestion. */
export function toggleSuggestion(found, key) {
  return found.map((s) => (s.key === key ? { ...s, checked: !s.checked } : s));
}

/** The ticked suggestions, as changes to the form. */
export function chosenPatch(found) {
  const patch = {};
  for (const s of found || []) if (s.checked) patch[s.key] = s.value;
  return patch;
}

/**
 * Why nothing was suggested: the server's own words when it answered (e.g. "AI is not configured
 * yet — an admin needs to…", exactly as the web shows it); else that it needs a connection, or the
 * web's general line.
 */
export function describeFailure(err, { online = true } = {}) {
  if (err && typeof err.status === 'number' && err.serverMessage) return err.serverMessage;
  if (!online && !(err && typeof err.status === 'number')) return DESCRIBE_OFFLINE;
  return DESCRIBE_FAILED;
}
