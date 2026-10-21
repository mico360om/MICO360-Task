/**
 * The file picker's copies of picked files (3b review). The picker copies each file it gives the
 * app into the app's cache (`<cache>/DocumentPicker/`), so it can be uploaded — chat files, profile
 * photos, task files. A copy is deleted once its upload is done or it was discarded, and every copy
 * goes at sign-out, so the next person on the phone never finds the last one's pictures. Only the
 * picker's own copies are ever deleted, never the person's original file. Pure (the file system
 * comes in), so it is tested here.
 */

/** The folder of the cache the picker copies into. */
const FOLDER = 'DocumentPicker/';

const folderOf = (cacheDir: string | null | undefined): string | null => (cacheDir ? `${cacheDir.replace(/\/*$/, '/')}${FOLDER}` : null);

/** Is this one of the picker's own copies (inside the app cache's DocumentPicker folder)? */
export function isPickedCopy(uri: string | null | undefined, cacheDir: string | null | undefined): boolean {
  const folder = folderOf(cacheDir);
  if (!uri || !folder || !uri.startsWith(folder)) return false;
  const rest = uri.slice(folder.length);
  return !!rest && !rest.split('/').some((part) => part === '..' || part === '.' || part === '');
}

export interface PickedFilesFs {
  deleteAsync: (uri: string, opts: { idempotent: boolean }) => Promise<void>;
}

export function createPickedFiles(fs: PickedFilesFs, cacheDir: string | null | undefined) {
  return {
    /** A copy that was sent or discarded: deleted (quietly — the cache is cleared at sign-out anyway). */
    async forget(uri: string | null | undefined): Promise<void> {
      if (!isPickedCopy(uri, cacheDir)) return;
      await fs.deleteAsync(uri!, { idempotent: true }).catch(() => {});
    },
    /** Sign-out: every copy goes. */
    async clearAll(): Promise<void> {
      const folder = folderOf(cacheDir);
      if (folder) await fs.deleteAsync(folder, { idempotent: true });
    },
  };
}

export type PickedFiles = ReturnType<typeof createPickedFiles>;
