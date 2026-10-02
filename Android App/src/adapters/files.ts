import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { ExportFiles } from '../lib/exporter';

/** Exports are kept in the app's cache (never in shared storage until the user saves them). */
const DIR = `${FileSystem.cacheDirectory ?? ''}exports/`;
const KEEP_MS = 24 * 60 * 60 * 1000;

/** Letters, digits, dot, dash and underscore only — the server's names already are. */
const safe = (name: string) => name.replace(/[^\w.-]+/g, '-').replace(/^\.+/, '') || 'export';

/** Drop exports older than a day so the cache doesn't grow (a file just shared may still be read). */
async function prune(): Promise<void> {
  try {
    for (const f of await FileSystem.readDirectoryAsync(DIR)) {
      const info = await FileSystem.getInfoAsync(DIR + f);
      if (info.exists && info.modificationTime && Date.now() - info.modificationTime * 1000 > KEEP_MS) {
        await FileSystem.deleteAsync(DIR + f, { idempotent: true });
      }
    }
  } catch {
    /* best effort */
  }
}

/** The file side of an export: expo-file-system downloads, expo-sharing opens the share sheet. */
export const exportFiles: ExportFiles = {
  async download(url, name, headers) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    await prune();
    const res = await FileSystem.downloadAsync(url, DIR + safe(name), { headers });
    return { status: res.status, headers: res.headers ?? {}, uri: res.uri };
  },
  async rename(uri, name) {
    const to = DIR + safe(name);
    await FileSystem.deleteAsync(to, { idempotent: true });
    await FileSystem.moveAsync({ from: uri, to });
    return to;
  },
  async remove(uri) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  },
  async share(uri, mimeType, title) {
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
  },
};
