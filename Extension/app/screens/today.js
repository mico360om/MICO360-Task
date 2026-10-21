import { MyTasksScreen } from './my-tasks.js';

/**
 * Today — the side panel's first view (Stage 7): what is overdue and what is due today for me, and
 * what I finished today, by calendar day in the company time zone (the same rules as My Tasks and
 * the web). It is My Tasks in short (no search or filters), so "Mark done" and reading itself again
 * work the same way.
 */
export function TodayScreen(ctx) {
  return MyTasksScreen(ctx, { view: 'today' });
}
