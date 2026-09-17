/**
 * Human "last sync" text: "Just now" / "2 min ago" / "15 min ago" / "1 hr ago" /
 * "2 days ago" / "Never". Pure + testable.
 */
export function formatRelativeTime(sinceMs, now = Date.now()) {
  if (sinceMs == null) return 'Never';
  const sec = Math.max(0, (now - sinceMs) / 1000);
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

/** Presentation for each connection state (label + brand-consistent colours). */
export const CONNECTION = {
  connected: { label: 'Connected', color: '#2E7D53' },
  syncing: { label: 'Syncing…', color: '#B87611' },
  offline: { label: 'Offline', color: '#6f6560' },
  error: { label: 'Connection error', color: '#CB4632' },
};

export function connectionMeta(state) {
  return CONNECTION[state] ?? CONNECTION.offline;
}

/**
 * Derive the connection state from raw signals:
 * - offline when the device is offline,
 * - syncing while a sync is in flight,
 * - error when online but the last attempt failed,
 * - connected otherwise.
 */
export function deriveConnectionState({ online, syncing, lastOk }) {
  if (!online) return 'offline';
  if (syncing) return 'syncing';
  if (lastOk === false) return 'error';
  return 'connected';
}
