import { ApiError, NetworkError, type RefreshOutcome } from './api-client';
import { fileNameFromDisposition, mimeTypeFor } from './reports';

/** The phone's file side of an export (expo-file-system + expo-sharing; see src/adapters/files.ts). */
export interface ExportFiles {
  /** Download `url` into the app's export folder as `name`; resolves with the HTTP status and headers. */
  download(url: string, name: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, string>; uri: string }>;
  /** Rename a downloaded file; resolves with its new uri. */
  rename(uri: string, name: string): Promise<string>;
  remove(uri: string): Promise<void>;
  /** Open the share sheet: open in Excel / a PDF viewer, save to Files or Drive, send by mail… */
  share(uri: string, mimeType: string, title: string): Promise<void>;
}

export interface ExporterOptions {
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
  /** The API client's single-flight session refresh. */
  refreshSession: () => Promise<RefreshOutcome>;
  /** The session is over: sign out (as for any other request). */
  onUnauthorized: () => void | Promise<void>;
  files: ExportFiles;
}

/**
 * Downloads an export (a report or a task, .xlsx / .pdf / .csv) with the signed-in session, names it
 * as the server does and hands it to the share sheet. A 401 renews the session once, like every
 * other request; a refused export (403/404/5xx) is an ApiError and nothing is shared.
 */
export function createExporter({ baseUrl, getToken, refreshSession, onUnauthorized, files }: ExporterOptions) {
  async function fetchFile(path: string, name: string) {
    const token = await getToken();
    try {
      return await files.download(`${baseUrl}${path}`, name, token ? { Authorization: `Bearer ${token}` } : {});
    } catch (e) {
      throw new NetworkError('Couldn’t download the file — check your connection.', { cause: e });
    }
  }

  async function exportFile(path: string, fallbackName: string, title: string): Promise<{ uri: string; fileName: string }> {
    let res = await fetchFile(path, fallbackName);
    if (res.status === 401) {
      await files.remove(res.uri).catch(() => {});
      const outcome = await refreshSession();
      if (outcome === 'ok') res = await fetchFile(path, fallbackName);
      else if (outcome === 'transient') throw new NetworkError('Could not renew the session — check your connection.');
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
    await files.share(uri, mimeTypeFor(fileName), title);
    return { uri, fileName };
  }

  return { exportFile };
}

export type Exporter = ReturnType<typeof createExporter>;
