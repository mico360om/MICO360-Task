/**
 * Summarize a list of tasks for the extension popup.
 * Returns today/overdue/in-progress/completed-today counts and up to 5 upcoming tasks.
 */
export function summarizeTasks(tasks, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const startMs = start.getTime();
  const endMs = end.getTime();

  // "Done" must match the backend/report definition (a DONE column OR a completedAt),
  // otherwise the extension's counts disagree with the web dashboard for the same tasks.
  const isDone = (t) => t.columnCategory === 'DONE' || t.completedAt != null;

  let dueToday = 0;
  let overdue = 0;
  let inProgress = 0;
  let completedToday = 0;
  const upcoming = [];

  for (const t of tasks) {
    if (isDone(t)) {
      if (t.completedAt && new Date(t.completedAt).getTime() >= startMs) completedToday++;
      continue;
    }
    if (t.columnCategory === 'IN_PROGRESS') inProgress++;

    const due = t.dueDate ? new Date(t.dueDate).getTime() : null;
    if (due !== null) {
      if (due < startMs) overdue++;
      else if (due <= endMs) dueToday++;
      else upcoming.push(t);
    }
  }

  upcoming.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  return { dueToday, overdue, inProgress, completedToday, upcoming: upcoming.slice(0, 5) };
}
