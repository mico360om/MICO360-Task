/**
 * 1.23.1 — how the server stops (SIGTERM / SIGINT: a deploy restart, the Windows service, Ctrl+C).
 * Before, it simply ended: its every-minute jobs met the database going away and the Error log recorded
 * "Can't reach database server" at each restart. Now, in order: the background jobs start nothing more
 * and the ones running finish (lib/job-gate), the other timers stop, the server stops taking requests
 * (the open ones finish), the Error log writes what it holds, and the database client disconnects last.
 * A step failing never skips the next; past `deadlineMs` it exits anyway. One stop, however many signals.
 */
export interface ShutdownSteps {
  /** 1.23.14: said first, once — from now on a database blip is the update's (lib/update-window). */
  markStopping?: () => void;
  stopJobs: () => Promise<void>;
  stopTimers?: () => void;
  closeServer: () => Promise<void>;
  flush?: () => Promise<void>;
  disconnect: () => Promise<void>;
  exit: (code: number) => void;
  log?: (message: string, meta?: Record<string, unknown>) => void;
  /** At most this long in all. */
  deadlineMs?: number;
}

export const SHUTDOWN_DEADLINE_MS = 15_000;

export function createShutdown(steps: ShutdownSteps): (signal: string) => Promise<void> {
  let stopping: Promise<void> | null = null;
  return (signal: string) => {
    if (stopping) return stopping;
    try {
      steps.markStopping?.();
    } catch {
      // Saying so can never stop the stop.
    }
    stopping = (async () => {
      let exited = false;
      const exit = () => {
        if (exited) return;
        exited = true;
        steps.exit(0);
      };
      const deadline = setTimeout(exit, steps.deadlineMs ?? SHUTDOWN_DEADLINE_MS);
      deadline.unref?.();
      const step = async (name: string, run: () => unknown) => {
        try {
          await run();
        } catch (err) {
          try {
            steps.log?.(`stopping: ${name} failed`, { error: err instanceof Error ? err.message : String(err) });
          } catch {
            // Saying so can never stop the stop.
          }
        }
      };
      steps.log?.('MICO360 Tasks API stopping', { signal });
      await step('the background jobs', steps.stopJobs);
      await step('the timers', () => steps.stopTimers?.());
      await step('the server', steps.closeServer);
      await step('the error log', () => steps.flush?.());
      await step('the database', steps.disconnect);
      clearTimeout(deadline);
      exit();
    })();
    return stopping;
  };
}
