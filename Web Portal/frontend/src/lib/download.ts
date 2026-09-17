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
