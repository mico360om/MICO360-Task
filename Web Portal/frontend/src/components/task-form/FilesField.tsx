import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { formatSize } from '../task-drawer/attachments';
import { detectPlatform } from '../../lib/shortcuts';

/** A file waiting to go up with a new task; `fraction` while it uploads, `error` if it couldn't. */
export interface PendingFile {
  key: string;
  file: File;
  fraction?: number;
  error?: string;
}

/** The server's upload limit, said up front (as in the task panel). */
const MAX_UPLOAD_MB = 10;

/** A small preview of a picture (nothing for other files, or where previews can't be made). */
function Thumb({ file }: { file: File }) {
  const url = useMemo(
    () => (file.type.startsWith('image/') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  if (!url) {
    return (
      <span aria-hidden="true" className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-ground text-[10px] font-bold uppercase text-ink-2">
        {file.name.split('.').pop()?.slice(0, 4) || 'file'}
      </span>
    );
  }
  return <img src={url} alt="" className="h-9 w-9 flex-none rounded-lg object-cover" />;
}

/**
 * Files to attach to a new task: dropped, chosen, or pasted (the dialog hands pasted pictures in).
 * They go up once the task exists; until then each can be taken off again.
 */
export function FilesField({ files, onAdd, onRemove, busy }: { files: PendingFile[]; onAdd: (files: File[]) => void; onRemove: (key: string) => void; busy?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const pasteKey = detectPlatform() === 'mac' ? '⌘V' : 'Ctrl+V';
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  return (
    <div
      data-testid="new-task-files"
      onDragEnter={(e) => {
        if (busy || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!busy && hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (busy) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        onAdd(Array.from(e.dataTransfer?.files ?? []));
      }}
      className={`flex flex-col gap-2 rounded-xl transition-colors ${dragging ? 'bg-brand/5 ring-2 ring-brand/50' : ''}`}
    >
      {files.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {files.map((p) => (
            <li key={p.key} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2">
              <Thumb file={p.file} />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-sm font-medium text-ink">{p.file.name}</span>
                {p.error ? (
                  <span className="block text-xs text-danger">{p.error}</span>
                ) : p.fraction !== undefined ? (
                  <span
                    role="progressbar"
                    aria-label={`Uploading ${p.file.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(p.fraction * 100)}
                    className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ground"
                  >
                    <span className="block h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${Math.round(p.fraction * 100)}%` }} />
                  </span>
                ) : (
                  <span className="block text-xs text-ink-3">{formatSize(p.file.size)}</span>
                )}
              </span>
              {!busy && p.fraction === undefined ? (
                <button
                  type="button"
                  onClick={() => onRemove(p.key)}
                  aria-label={`Remove ${p.file.name}`}
                  className="grid h-8 w-8 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-danger"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!busy ? (
        <label className="flex min-h-[56px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-line px-3 py-2.5 text-center transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30 hover:border-brand">
          <span className="text-xs font-medium text-ink-2">
            {dragging ? 'Drop to add' : (
              <>
                Drop files here or <span className="font-semibold text-brand">browse</span>
              </>
            )}
          </span>
          <span className="text-[11px] text-ink-3">
            Or paste a picture ({pasteKey}) · up to {MAX_UPLOAD_MB} MB each · pictures are made smaller to save space
          </span>
          <input
            type="file"
            multiple
            className="sr-only"
            aria-label="Attach files"
            onChange={(e) => {
              onAdd(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </label>
      ) : null}
    </div>
  );
}
