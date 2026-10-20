/**
 * A session refresh whose reply never arrived (a timeout, a dropped connection) is tried again a
 * moment later. The server keeps the token it rotated to for 2 minutes and hands the same one back
 * to a retry, so a lost reply no longer leaves the phone holding a spent token that later looks
 * like theft and ends the sign-in. A refusal (`invalid`) is final and never retried.
 */
export async function refreshWithRetry<T extends 'ok' | 'invalid' | 'transient'>(
  attempt: () => Promise<T>,
  { retries = 1, delayMs = 1500, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) }: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  let outcome = await attempt();
  for (let left = retries; outcome === 'transient' && left > 0; left--) {
    await sleep(delayMs);
    outcome = await attempt();
  }
  return outcome;
}
