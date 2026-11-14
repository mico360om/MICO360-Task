import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { downloadNameFor } from '../../lib/download';
import { fileKind, type FileKind } from '../../lib/file-kind';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Badge } from '../ui/Badge';
import { ClientEyeIcon } from '../TaskCard';
import { failureMessage } from './save-state';
import { pastedFiles } from '../../lib/clipboard-files';
import { detectPlatform, isTypingTarget } from '../../lib/shortcuts';
import { markFound } from '../../lib/useFoundAnchor';
import type { OfficePreview } from '../../api/attachments';
import { reportFileLinkFailed } from '../../lib/file-link-refresh';

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
  /** 1.23.7: a client uploaded it in the Client portal (marked "From client"). */
  fromClient?: boolean;
  /** 1.23.7: "Show to client" — the project's clients who may view tasks see it in the portal. */
  clientVisible?: boolean;
}

/** 1.23.7: show a file to the project's clients (or not); rejects with the reason to show. */
export type SetFileClientVisible = (attachmentId: string, visible: boolean) => Promise<void> | void;

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
        // 1.23.29: a link that no longer works (403) asks for new links; the list's new one runs this again.
        if (r.status === 403) reportFileLinkFailed(href);
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
        <div className="absolute inset-0 bg-scrim" onClick={onClose} aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="true" aria-label={`Preview of ${a.filename}`} tabIndex={-1} className="card relative flex h-[min(90dvh,56rem)] w-full max-w-4xl flex-col overflow-hidden outline-none">
          <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
            <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={a.filename}>{a.filename}</span>
            <span className="text-xs text-ink-3">{formatSize(a.sizeBytes)}</span>
            <a href={href} download={a.filename} className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink hover:border-brand hover:text-brand [@media(pointer:coarse)]:h-11">
              Download
            </a>
            <button type="button" onClick={onClose} aria-label="Close preview" className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-ground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
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
              className={`min-h-9 [@media(pointer:coarse)]:!min-h-11 whitespace-nowrap rounded-t-md px-3 text-xs font-medium ${i === sheet ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
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

function AttachmentRow({
  a,
  onDelete,
  onPreview,
  onSetClientVisible,
  clientHintId,
}: {
  a: DrawerAttachment;
  onDelete?: (id: string) => Promise<void> | void;
  onPreview?: LoadOfficePreview;
  /** Offered to whoever may show things to clients (who runs the project, or an admin). */
  onSetClientVisible?: SetFileClientVisible;
  /** The section's one hint on where clients see a shown file, read with each tick. */
  clientHintId?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // "Show to client": the tick shows what was ticked while it saves, until the file says so too (back
  // as it was if the save fails; after a moment, whatever the file says).
  const [ticking, setTicking] = useState<boolean | null>(null);
  const [sharing, setSharing] = useState(false);
  const shown = a.clientVisible === true;
  useEffect(() => {
    if (ticking === null || sharing) return;
    if (ticking === shown) {
      setTicking(null);
      return;
    }
    const t = setTimeout(() => setTicking(null), 1000);
    return () => clearTimeout(t);
  }, [ticking, sharing, shown]);
  const share = async (visible: boolean) => {
    setTicking(visible);
    setSharing(true);
    setProblem(null);
    try {
      await onSetClientVisible?.(a.id, visible);
    } catch (err) {
      setTicking(null);
      setProblem(failureMessage(err, 'Couldn’t change who sees the file.'));
    } finally {
      setSharing(false);
    }
  };
  const kind = fileKind(a.mimeType ?? '', a.filename);
  const mode = previewMode(kind, a.filename, (a.mimeType ?? '').toLowerCase(), Boolean(onPreview));
  const href = `${API_ORIGIN}${a.url}`;
  const canDelete = Boolean(onDelete) && a.canDelete !== false;
  // 1.23: a search result opened this file's task (…&file=<id>): the file comes into view, marked.
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const named = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('file');
    if (named === a.id && rowRef.current) markFound(rowRef.current);
  }, [a.id]);
  return (
    <li ref={rowRef} id={`file-${a.id}`} className="flex scroll-mt-24 flex-col gap-1 rounded-lg border border-line bg-surface p-2">
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
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs text-ink-3">{formatSize(a.sizeBytes)}</span>
            {/* 1.23.7: a client's file is marked as a client's comment is. */}
            {a.fromClient ? (
              <span title="Uploaded by a client in the Client portal">
                <Badge tone="info">From client</Badge>
              </span>
            ) : null}
            {/* Who can't change it just sees that a file is shown. */}
            {!onSetClientVisible && shown ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-info-soft px-1.5 py-0.5 text-[11px] font-semibold text-info" title="Clients see this file in the Client portal">
                <ClientEyeIcon size={11} />
                Shown to client
              </span>
            ) : null}
          </span>
        </div>
        {mode ? (
          <button
            type="button"
            onClick={() => setPreviewing(true)}
            aria-label={`Preview ${a.filename}`}
            title="Preview"
            className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ground hover:text-brand sm:h-7 sm:w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
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
            className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger sm:h-7 sm:w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
            </svg>
          </button>
        ) : null}
      </div>
      {onSetClientVisible ? (
        // Lined up under the file's name; the file's name is read with the tick.
        <div className="ps-[3.125rem]">
          <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-md pe-1 text-xs font-medium text-ink-2 hover:text-ink [@media(pointer:coarse)]:!min-h-11">
            <input
              type="checkbox"
              checked={ticking ?? shown}
              disabled={sharing}
              // The visible words first, then which file (several files, one tick each).
              aria-label={`Show to client: ${a.filename}`}
              aria-describedby={clientHintId}
              onChange={(e) => void share(e.target.checked)}
              className="h-4 w-4 flex-none accent-[rgb(var(--c-brand))]"
            />
            <span className={(ticking ?? shown) ? 'text-info' : 'text-ink-3'}>
              <ClientEyeIcon size={13} />
            </span>
            Show to client
          </label>
        </div>
      ) : null}
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
            className="h-8 rounded-md px-2 font-semibold text-danger hover:bg-danger-soft [@media(pointer:coarse)]:h-11"
          >
            Yes, delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="h-8 rounded-md px-2 text-ink-2 hover:bg-ground [@media(pointer:coarse)]:h-11">
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

/**
 * Files on the task: drop or browse to upload (with progress), preview, download, delete. 1.23.7: a
 * client's file is marked "From client"; whoever may show things to clients ticks "Show to client"
 * on any file, the others see which files are shown.
 */
export function AttachmentsSection({
  attachments,
  onUpload,
  onDelete,
  onPreview,
  onSetClientVisible,
  taskShownToClient,
}: {
  attachments: DrawerAttachment[];
  onUpload?: (file: File, onProgress?: (fraction: number) => void) => Promise<unknown> | void;
  onDelete?: (id: string) => Promise<void> | void;
  /** Loads Word / Excel / PowerPoint previews; without it those files only download. */
  onPreview?: LoadOfficePreview;
  /** 1.23.7: "Show to client" on each file — only for whoever may show things to clients. */
  onSetClientVisible?: SetFileClientVisible;
  /** The task itself is shown to clients (its files reach them only then). */
  taskShownToClient?: boolean;
}) {
  const clientHintId = useId();
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
              <AttachmentRow key={a.id} a={a} onDelete={onDelete} onPreview={onPreview} onSetClientVisible={onSetClientVisible} clientHintId={onSetClientVisible ? clientHintId : undefined} />
            ))}
          </ul>
        ) : !onUpload ? (
          <p className="text-sm text-ink-3">No attachments.</p>
        ) : null}
        {/* One hint for every file's "Show to client" tick (each tick is described by it). */}
        {attachments.length > 0 && onSetClientVisible ? (
          <p id={clientHintId} className="text-xs leading-relaxed text-ink-2">
            Show to client: clients see the file in the Client portal only, and only while this task is shown to clients.
            {attachments.some((a) => a.fromClient) ? ' A client always sees their own files.' : ''}
            {taskShownToClient === false ? ' This task isn’t shown to clients now.' : ''}
          </p>
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
                  {/* A phone or tablet has nothing to drop and no paste key: it says what a tap does. */}
                  <span className="[@media(pointer:coarse)]:hidden">Drop files here or <span className="font-semibold text-brand underline-offset-2 hover:underline">browse</span></span>
                  <span className="hidden [@media(pointer:coarse)]:inline">Tap to add <span className="font-semibold text-brand">files or photos</span></span>
                </>
              )}
            </span>
            <span className="text-[11px] text-ink-3">
              <span className="[@media(pointer:coarse)]:hidden">Or paste a picture ({pasteKey}) · up to {MAX_UPLOAD_MB} MB each · pictures are made smaller to save space</span>
              <span className="hidden [@media(pointer:coarse)]:inline">Up to {MAX_UPLOAD_MB} MB each · pictures are made smaller to save space</span>
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
