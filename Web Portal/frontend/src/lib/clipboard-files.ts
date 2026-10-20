/** What a paste event's clipboard offers (a DataTransfer, or a test's stand-in). */
export interface ClipboardLike {
  files?: FileList | File[] | null;
  items?: DataTransferItemList | ArrayLike<{ kind: string; getAsFile(): File | null }> | null;
  getData(type: string): string;
}

/** The names browsers give a pasted picture: Chrome and Edge "image.png", Firefox "image.png", or none. */
const GENERIC_NAME = /^(image\.(png|jpe?g|gif|webp|bmp)|)$/i;
const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * "Pasted image 2026-10-20 22.31.05" in local time — to the second, so two pastes a moment apart
 * read differently in the list and the activity; no colons: Windows can't save them in a file name.
 */
function pastedStem(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Pasted image ${date} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
}

/**
 * The files a paste should attach. A copied file keeps its own name; a pasted picture (a screenshot,
 * an image copied from a page) gets "Pasted image <date> <time>" instead of the browser's
 * "image.png", numbered when there are several. While the person is typing in a text box, text on the
 * clipboard wins: copied spreadsheet cells carry a picture of themselves, and pasting them into a
 * comment must paste the text.
 */
export function pastedFiles(data: ClipboardLike | null | undefined, opts: { typing: boolean; now?: Date }): File[] {
  if (!data) return [];
  let files = Array.from((data.files ?? []) as ArrayLike<File>);
  if (files.length === 0) {
    // Some browsers leave the file list empty and offer the picture as an item only.
    files = Array.from((data.items ?? []) as ArrayLike<{ kind: string; getAsFile(): File | null }>)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is File => !!f);
  }
  if (files.length === 0) return [];
  if (opts.typing && data.getData('text/plain').trim()) return [];

  const stem = pastedStem(opts.now ?? new Date());
  let n = 0;
  return files.map((file) => {
    if (!file.type.startsWith('image/') || !GENERIC_NAME.test(file.name)) return file;
    n += 1;
    const ext = EXTENSION[file.type] ?? file.type.slice('image/'.length);
    return new File([file], `${stem}${n > 1 ? ` (${n})` : ''}.${ext}`, { type: file.type, lastModified: file.lastModified });
  });
}
