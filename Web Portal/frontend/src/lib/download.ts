/** A safe file-name part, as the server makes them: lowercase letters, digits and dashes. */
export function fileSlug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .toLowerCase()
      .slice(0, 60) || 'export'
  );
}

/** The file name in a Content-Disposition header — just the name, never a path — or null. */
export function fileNameFromDisposition(header: string | null): string | null {
  const m = /filename="([^"]+)"/i.exec(header ?? '');
  const name = m ? m[1]!.split(/[\\/]/).pop()!.trim() : '';
  return name && name !== '.' && name !== '..' ? name : null;
}

/** The name the server gave a downloaded file (see ApiClient.getBlob), or null. */
export function fileNameOf(blob: Blob): string | null {
  return typeof File !== 'undefined' && blob instanceof File && blob.name ? blob.name : null;
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Trigger a browser download of an in-memory text file (e.g. a CSV export). */
export function downloadTextFile(filename: string, content: string, mimeType = 'text/plain'): void {
  downloadBlob(filename, new Blob([content], { type: `${mimeType};charset=utf-8` }));
}
