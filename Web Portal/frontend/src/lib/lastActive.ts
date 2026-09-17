/**
 * Human "last active" label for a user, given their last-active timestamp and live online state.
 * "Active now" when online; "Offline" when never seen; otherwise a relative or dated "Last active …".
 */
export function lastActiveLabel(lastActiveAt: string | null, online: boolean, now: Date = new Date()): string {
  if (online) return 'Active now';
  if (!lastActiveAt) return 'Offline';
  const then = new Date(lastActiveAt).getTime();
  const s = Math.round((now.getTime() - then) / 1000);
  if (s < 45) return 'Last active just now';
  const m = Math.round(s / 60);
  if (m < 60) return `Last active ${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Last active ${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `Last active ${d}d ago`;
  return `Last active on ${new Date(lastActiveAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}
