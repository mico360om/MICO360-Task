/**
 * Hermes on React Native 0.74 has no `structuredClone`, and the inspection outbox (the website's
 * copy) clones its records with it. They are plain JSON, so a JSON round trip is a faithful copy.
 * A runtime that has its own keeps it.
 */
export function installStructuredClone(g: { structuredClone?: unknown } = globalThis as { structuredClone?: unknown }): void {
  if (typeof g.structuredClone === 'function') return;
  g.structuredClone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
}
