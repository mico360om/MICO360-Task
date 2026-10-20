import { useEffect, useRef, useState, type DragEvent } from 'react';
import { downloadNameFor } from '../../lib/download';
import { fileKind, type FileKind } from '../../lib/file-kind';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { failureMessage } from './save-state';
import { pastedFiles } from '../../lib/clipboard-files';
import { detectPlatform, isTypingTarget } from '../../lib/shortcuts';
import type { OfficePreview } from '../../api/attachments';

/** Loads the text of a Word / Excel / PowerPoint attachment (the server unpacks it). */
export type LoadOfficePreview = (attachmentId: string) => Promise<OfficePreview>;

export interface DrawerAttachment {
  id: string;
  filename: string;
  url: string;
  sizeBytes: number;
  mimeType?: string;
  /** May the viewer delete it (they uploaded it, or they're an admin)? Defaults to yes. */
  canDelete?: boolean;
}

/** API origin (without the /api/v1 prefix) — attachment files are served from the root. */
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');
/** The server's upload limit, said up front. */
const MAX_UPLOAD_MB = 10;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const KIND_STYLE: Record<FileKind, { label: string; className: string }> = {
  image: { label: 'IMG', className: 'bg-info-soft text-info' },
  pdf: { label: 'PDF', className: 'bg-danger-soft text-danger' },
  sheet: { label: 'XLS', className: 'bg-success-soft text-success' },
  doc: { label: 'DOC', className: 'bg-info-soft text-info' },
  slides: { label: 'PPT', className: 'bg-warning-soft text-warning' },
  archive: { label: 'ZIP', className: 'bg-ground text-ink-2' },
  text: { label: 'TXT', className: 'bg-ground text-ink-2' },
  other: { label: 'FILE', className: 'bg-ground text-ink-2' },
};

/** How a file can be shown inside the app (null: it can only be downloaded). */
type PreviewMode = 'image' | 'pdf' | 'text' | 'office';
function previewMode(kind: FileKind, filename: string, mimeType: string, canOffice: boolean): PreviewMode | null {
  if (kind === 'image' || kind === 'pdf' || kind === 'text') return kind;
  if (canOffice && /\.(docx|xlsx|pptx)$/i.test(filename)) return 'office';
  if (mimeType === 'text/csv' || /\.csv$/i.test(filename)) return 'text';
  return null;
}
/** Longest text shown in a preview (the rest is in the download). */
const TEXT_PREVIEW_MAX = 200_000;

/**
 * A file shown inside the app: a picture as itself, a PDF in the browser's viewer (loaded as a
 * private copy, since the server always sends non-pictures as downloads), text and CSV as plain text
 * — never as markup. Escape closes the preview only, not the task panel.
 */
function FilePreview({ a, href, mode, loadOffice, onClose }: { a: DrawerAttachment; href: string; mode: PreviewMode; loadOffice?: LoadOfficePreview; onClose: () => void }) {
  const ref = useDialog(onClose, { initialFocus: 'container' });
  const [view, setView] = useState<{ url?: string; text?: string; cut?: boolean; office?: OfficePreview; error?: string }>(mode === 'image' ? { url: href } : {});
  useEffect(() => {
    if (mode === 'image') return;
    let url: string | null = null;
    let live = true;
    (async () => {
      if (mode === 'office') {
        try {
          const office = await loadOffice!(a.id);
          if (live) setView({ office });
        } catch (err) {
          if (live) setView({ error: `${failureMessage(err, 'Couldn’t load the preview.')} You can still download the file.` });
        }
        return;
      }
      try {
        const r = await fetch(href);
        if (!r.ok) throw new Error(String(r.status));
        if (mode === 'pdf') {
          url = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: 'application/pdf' }));
          if (live) setView({ url });
        } else {
          const text = await r.text();
          if (live) setView({ text: text.slice(0, TEXT_PREVIEW_MAX), cut: text.length > TEXT_PREVIEW_MAX });
        }
      } catch {
        if (live) setView({ error: 'Couldn’t load the preview. You can still download the file.' });
      }
    })();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [href, mode, a.id, loadOffice]);
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[60] grid place-items-center p-2 sm:p-6">
        <div className="absolute inset-0 bg-ink/50" onClick={onClose} aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="true" aria-label={`Preview of ${a.filename}`} tabIndex={-1} className="card relative flex h-[min(90dvh,56rem)] w-full max-w-4xl flex-col overflow-hidden outline-none">
          <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
            <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={a.filename}>{a.filename}</span>
            <span className="text-xs text-ink-3">{formatSize(a.sizeBytes)}</span>
            <a href={href} download={a.filename} className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink hover:border-brand hover:text-brand">
              Download
            </a>
            <button type="button" onClick={onClose} aria-label="Close preview" className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-ground">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-ground/40">
            {view.error ? (
              <p role="alert" className="p-4 text-sm text-danger">{view.error}</p>
            ) : mode === 'image' ? (
              <img src={href} alt={a.filename} className="mx-auto max-h-full max-w-full object-contain p-2" />
            ) : mode === 'office' ? (
              view.office ? <OfficeView preview={view.office} /> : <p className="p-4 text-sm text-ink-3">Loading…</p>
            ) : mode === 'pdf' ? (
              view.url ? <iframe src={view.url} title={`PDF: ${a.filename}`} className="h-full w-full bg-white" /> : <p className="p-4 text-sm text-ink-3">Loading…</p>
            ) : view.text !== undefined ? (
              <>
                <pre dir="auto" className="whitespace-pre-wrap break-words p-4 font-mono text-xs text-ink">{view.text}</pre>
                {view.cut ? <p className="px-4 pb-4 text-xs text-ink-3">Only the beginning is shown — download the file for the rest.</p> : null}
              </>
            ) : (
              <p className="p-4 text-sm text-ink-3">Loading…</p>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/** A Word document's paragraphs, a workbook's sheets (one tab each) or a deck's slides — all as plain text. */
function OfficeView({ preview }: { preview: OfficePreview }) {
  const [sheet, setSheet] = useState(0);
  const more = <p className="px-4 pb-4 text-xs text-ink-3">Only the first rows and columns are shown — download the file for the rest.</p>;
  if (preview.kind === 'document') {
    return (
      <div className="flex flex-col gap-2 p-4 text-sm text-ink">
        {preview.paragraphs.length === 0 ? <p className="text-ink-3">This document has no text.</p> : null}
        {preview.paragraphs.map((t, i) => (
          <p key={i} dir="auto" className="whitespace-pre-wrap break-words text-start">{t}</p>
        ))}
        {preview.truncated ? <p className="text-xs text-ink-3">Only the beginning is shown — download the file for the rest.</p> : null}
      </div>
    );
  }
  if (preview.kind === 'slides') {
    return (
      <div className="flex flex-col gap-3 p-4">
        {preview.slides.map((s) => (
          <section key={s.number} aria-labelledby={`slide-${s.number}`} className="rounded-lg border border-line bg-surface p-3">
            <h3 id={`slide-${s.number}`} className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Slide {s.number}</h3>
            {s.lines.length === 0 ? <p className="text-sm text-ink-3">No text on this slide.</p> : null}
            {s.lines.map((l, i) => (
              <p key={i} dir="auto" className="whitespace-pre-wrap break-words text-start text-sm text-ink">{l}</p>
            ))}
          </section>
        ))}
        {preview.truncated ? more : null}
      </div>
    );
  }
  const current = preview.sheets[Math.min(sheet, preview.sheets.length - 1)];
  return (
    <div className="flex flex-col">
      {preview.sheets.length > 1 ? (
        <div role="tablist" aria-label="Sheets" className="flex flex-none gap-1 overflow-x-auto border-b border-line px-3 pt-2">
          {preview.sheets.map((s, i) => (
            <button
              key={s.name + i}
              type="button"
              role="tab"
              aria-selected={i === sheet}
              onClick={() => setSheet(i)}
              className={`min-h-9 whitespace-nowrap rounded-t-md px-3 text-xs font-medium ${i === sheet ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {!current || current.rows.length === 0 ? (
        <p className="p-4 text-sm text-ink-3">This sheet is empty.</p>
      ) : (
        <div className="overflow-auto p-3">
          <table aria-label={current.name} className="border-collapse text-xs">
            <tbody>
              {current.rows.map((row, r) => (
                <tr key={r} className={r === 0 ? 'bg-ground font-semibold' : ''}>
                  {row.map((cell, c) => (
                    <td key={c} dir="auto" className="max-w-[16rem] truncate border border-line px-2 py-1 text-start text-ink" title={cell}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {current?.truncated ? more : null}
    </div>
  );
}

interface Upload {
  key: string;
  name: string;
  fraction: number;
  error?: string;
}

function AttachmentRow({ a, onDelete, onPreview }: { a: DrawerAttachment; onDelete?: (id: string) => Promise<void> | void; onPreview?: LoadOfficePreview }) {
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const kind = fileKind(a.mimeType ?? '', a.filename);
  const mode = previewMode(kind, a.filename, (a.mimeType ?? '').toLowerCase(), Boolean(onPreview));
  const href = `${API_ORIGIN}${a.url}`;
  const canDelete = Boolean(onDelete) && a.canDelete !== false;
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-2">
      <div className="flex items-center gap-2.5">
        {kind === 'image' ? (
          <img src={href} alt={a.filename} loading="lazy" className="h-10 w-10 flex-none rounded-md border border-line object-cover" />
        ) : (
          <span aria-hidden="true" className={`grid h-10 w-10 flex-none place-items-center rounded-md text-[10px] font-bold ${KIND_STYLE[kind].className}`}>
            {KIND_STYLE[kind].label}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {/* Pictures open in the browser to view; every other file (PDF included) downloads under its own name — the server only serves pictures inline. */}
          <a href={href} download={downloadNameFor(a.filename)} target="_blank" rel="noreferrer" dir="auto" title={a.filename} className="block truncate text-sm font-medium text-ink hover:text-brand hover:underline">
            {a.filename}
          </a>
          <span className="text-xs text-ink-3">{formatSize(a.sizeBytes)}</span>
        </div>
        {mode ? (
          <button
            type="button"
            onClick={() => setPreviewing(true)}
            aria-label={`Preview ${a.filename}`}
            title="Preview"
            className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ground hover:text-brand sm:h-7 sm:w-7"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        ) : null}
        {canDelete && !confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${a.filename}`}
            title="Delete"
            className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger sm:h-7 sm:w-7"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
            </svg>
          </button>
        ) : null}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-2">Delete this file?</span>
          <button
            type="button"
            onClick={async () => {
              setConfirming(false);
              setProblem(null);
              try {
                await onDelete?.(a.id);
              } catch (err) {
                setProblem(failureMessage(err, 'Couldn’t delete the file.'));
              }
            }}
            className="h-8 rounded-md px-2 font-semibold text-danger hover:bg-danger-soft"
          >
            Yes, delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="h-8 rounded-md px-2 text-ink-2 hover:bg-ground">
            Keep
          </button>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      ) : null}
      {previewing && mode ? <FilePreview a={a} href={href} mode={mode} loadOffice={onPreview} onClose={() => setPreviewing(false)} /> : null}
    </li>
  );
}

/** Files on the task: drop or browse to upload (with progress), preview, download, delete. */
export function AttachmentsSection({
  attachments,
  onUpload,
  onDelete,
  onPreview,
}: {
  attachments: DrawerAttachment[];
  onUpload?: (file: File, onProgress?: (fraction: number) => void) => Promise<unknown> | void;
  onDelete?: (id: string) => Promise<void> | void;
  /** Loads Word / Excel / PowerPoint previews; without it those files only download. */
  onPreview?: LoadOfficePreview;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const seq = useRef(0);
  const sectionRef = useRef<HTMLElement>(null);
  const pasteKey = detectPlatform() === 'mac' ? '⌘V' : 'Ctrl+V';

  // A picture pasted anywhere in the open task (Ctrl+V) — a screenshot, an image copied from a page
  // or a document — is attached, and the list comes into view so its upload shows. Text pasted into
  // a box stays text (see pastedFiles).
  const uploadAllRef = useRef<(files: File[]) => void>(() => {});
  useEffect(() => {
    if (!onUpload) return;
    const onPaste = (e: ClipboardEvent) => {
      const section = sectionRef.current;
      const scope = section?.closest('[role="dialog"]') ?? section?.parentElement;
      const target = e.target instanceof Node ? e.target : null;
      if (!section || !scope || !target || !scope.contains(target)) return;
      const files = pastedFiles(e.clipboardData, { typing: target instanceof Element && isTypingTarget(target) });
      if (files.length === 0) return;
      e.preventDefault();
      uploadAllRef.current(files);
      section.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onUpload]);

  function uploadAll(files: File[]) {
    if (!onUpload) return;
    for (const file of files) {
      const key = `u${++seq.current}`;
      setUploads((u) => [...u, { key, name: file.name, fraction: 0 }]);
      const update = (patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
      let sending: Promise<unknown>;
      try {
        sending = Promise.resolve(onUpload(file, (fraction) => update({ fraction })));
      } catch (err) {
        sending = Promise.reject(err);
      }
      sending.then(
          () => setUploads((u) => u.filter((x) => x.key !== key)),
          (err) => update({ error: failureMessage(err, 'Couldn’t upload the file.') }),
        );
    }
  }
  uploadAllRef.current = uploadAll;
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  return (
    <section ref={sectionRef} aria-labelledby="task-files-heading">
      <h3 id="task-files-heading" className="eyebrow mb-2">
        Attachments{attachments.length > 0 ? <span className="ms-1.5 font-normal normal-case tracking-normal text-ink-3">{attachments.length}</span> : null}
      </h3>
      <div
        data-testid="attachment-dropzone"
        data-dragging={dragging ? 'true' : undefined}
        onDragEnter={(e) => {
          if (!onUpload || !hasFiles(e)) return;
          e.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (!onUpload || !hasFiles(e)) return;
          e.preventDefault();
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          if (!onUpload) return;
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          uploadAll(Array.from(e.dataTransfer?.files ?? []));
        }}
        className={`flex flex-col gap-2 rounded-xl transition-colors ${dragging ? 'bg-brand/5 ring-2 ring-brand/50' : ''}`}
      >
        {attachments.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {attachments.map((a) => (
              <AttachmentRow key={a.id} a={a} onDelete={onDelete} onPreview={onPreview} />
            ))}
          </ul>
        ) : !onUpload ? (
          <p className="text-sm text-ink-3">No attachments.</p>
        ) : null}
        {uploads.map((u) => (
          <div key={u.key} className="rounded-lg border border-line bg-surface p-2 text-xs">
            <div className="flex items-center gap-2">
              <span dir="auto" className="min-w-0 flex-1 truncate font-medium text-ink">
                {u.name}
              </span>
              {u.error ? (
                <button type="button" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))} className="h-7 rounded px-1.5 text-ink-2 hover:bg-ground">
                  Dismiss
                </button>
              ) : (
                <span className="tabular-nums text-ink-3">{Math.round(u.fraction * 100)}%</span>
              )}
            </div>
            {u.error ? (
              <p role="alert" className="mt-1 text-danger">
                {`${u.name}: ${u.error}`}
              </p>
            ) : (
              <div
                role="progressbar"
                aria-label={`Uploading ${u.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(u.fraction * 100)}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ground"
              >
                <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${Math.round(u.fraction * 100)}%` }} />
              </div>
            )}
          </div>
        ))}
        {onUpload ? (
          <label className="flex min-h-[64px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-line px-3 py-3 text-center transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30 hover:border-brand">
            <span className="text-xs font-medium text-ink-2">
              {dragging ? 'Drop to upload' : (
                <>
                  Drop files here or <span className="font-semibold text-brand underline-offset-2 hover:underline">browse</span>
                </>
              )}
            </span>
            <span className="text-[11px] text-ink-3">
              Or paste a picture ({pasteKey}) · up to {MAX_UPLOAD_MB} MB each
            </span>
            <input
              type="file"
              multiple
              className="sr-only"
              aria-label="Attach files"
              onChange={(e) => {
                uploadAll(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
        ) : null}
      </div>
    </section>
  );
}
