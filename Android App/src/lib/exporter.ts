import { ApiError, NetworkError, isNetworkError, sessionChangedError, type RefreshOutcome } from './api-client';
import { fileNameFromDisposition, mimeTypeFor } from './reports';
import { assertAllowedUrl } from './server-address';

/** The phone's file side of an export (expo-file-system + expo-sharing; see src/adapters/files.ts). */
export interface ExportFiles {
  /**
   * Download `url` into the app's export folder as `name`; resolves with the HTTP status and
   * headers. `timeoutMs`: the download is stopped (and its partial file deleted) after that long.
   */
  download(url: string, name: string, headers: Record<string, string>, opts?: { timeoutMs?: number }): Promise<{ status: number; headers: Record<string, string>; uri: string }>;
  /** Rename a downloaded file; resolves with its new uri. */
  rename(uri: string, name: string): Promise<string>;
  remove(uri: string): Promise<void>;
  /** Open the share sheet: open in Excel / a PDF viewer, save to Files or Drive, send by mail… */
  share(uri: string, mimeType: string, title: string): Promise<void>;
  /** Delete every exported file kept on the phone (on sign-out). */
  clearAll(): Promise<void>;
}

export interface ExporterOptions {
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
  /** Whose session the phone holds now: a download is renewed only for the person it was sent for (5b review). */
  getUserId?: () => string | null;
  /** The API client's single-flight session refresh, for that person ('changed': someone else is signed in). */
  refreshSession: (expectedUserId?: string | null) => Promise<RefreshOutcome>;
  /** The session is over: sign out (as for any other request). */
  onUnauthorized: () => void | Promise<void>;
  files: ExportFiles;
}

/** The longest an export's download may take (a big report on a slow connection); then it stops. */
export const EXPORT_TIMEOUT_MS = 120_000;

/**
 * Downloads an export (a report or a task, .xlsx / .pdf / .csv) with the signed-in session, names it
 * as the server does and hands it to the share sheet. A 401 renews the session once, like every
 * other request; a refused export (403/404/5xx) is an ApiError and nothing is shared.
 */
export function createExporter({ baseUrl, getToken, getUserId, refreshSession, onUnauthorized, files }: ExporterOptions) {
  /**
   * One download, within its time limit (4b review #2): a download that never ends can't leave an
   * export to open on someone else's screen later; a file that arrives after it gave up is deleted.
   */
  async function fetchFile(path: string, name: string) {
    // The download carries the session token: never over plain http to the internet.
    assertAllowedUrl(`${baseUrl}${path}`);
    const token = await getToken();
    const download = files.download(`${baseUrl}${path}`, name, token ? { Authorization: `Bearer ${token}` } : {}, { timeoutMs: EXPORT_TIMEOUT_MS });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let late = false;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        late = true;
        reject(new NetworkError('The download took too long — check your connection and try again.', { timedOut: true }));
      }, EXPORT_TIMEOUT_MS);
    });
    try {
      return await Promise.race([download, limit]);
    } catch (e) {
      if (late) void download.then((r) => files.remove(r.uri).catch(() => {}), () => {});
      if (isNetworkError(e)) throw e;
      throw new NetworkError('Couldn’t download the file — check your connection.', { cause: e });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function exportFile(path: string, fallbackName: string, title: string): Promise<{ uri: string; fileName: string }> {
    // Whose session the download goes with: a 401 is renewed only for that person.
    const sentAs = getUserId?.() ?? null;
    /**
     * Still the person who asked for it (4b review #2)? A download that ends after they signed out
     * — and someone else in — is deleted, never opened on the next person's screen.
     */
    const stillTheirs = async (uri: string) => {
      if (!getUserId || (getUserId() ?? null) === sentAs) return;
      await files.remove(uri).catch(() => {});
      throw sessionChangedError();
    };
    let res = await fetchFile(path, fallbackName);
    await stillTheirs(res.uri);
    if (res.status === 401) {
      await files.remove(res.uri).catch(() => {});
      const outcome = await refreshSession(sentAs);
      if (outcome === 'ok') {
        res = await fetchFile(path, fallbackName);
        await stillTheirs(res.uri);
      } else if (outcome === 'transient') throw new NetworkError('Could not renew the session — check your connection.');
      else if (outcome === 'changed') throw sessionChangedError();
      if (res.status === 401) {
        await files.remove(res.uri).catch(() => {});
        await onUnauthorized();
        throw new ApiError(401, 'UNAUTHORIZED', 'Your session has ended. Sign in again.');
      }
    }
    if (res.status < 200 || res.status >= 300) {
      await files.remove(res.uri).catch(() => {});
      throw new ApiError(res.status, res.status === 403 ? 'FORBIDDEN' : 'ERROR', `Export failed (${res.status})`);
    }
    const header = Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'content-disposition')?.[1];
    const serverName = fileNameFromDisposition(header);
    let uri = res.uri;
    let fileName = fallbackName;
    if (serverName && serverName !== fallbackName) {
      uri = await files.rename(uri, serverName);
      fileName = serverName;
    }
    // Checked again just before the share sheet opens: never someone else's file on this screen.
    await stillTheirs(uri);
    await files.share(uri, mimeTypeFor(fileName), title);
    return { uri, fileName };
  }

  return { exportFile };
}

export type Exporter = ReturnType<typeof createExporter>;
