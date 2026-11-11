import { useId, useState } from 'react';
import { buttonClass } from '../../ui/Button';
import { problemText, sizeText } from './manage-ui';

/** Pictures a lesson step or a signature may be (the server checks the contents too). */
export const PICTURE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';
/** Documents and downloads: PDF, Office, pictures, text and zip (the server's list). */
export const DOCUMENT_TYPES = '.pdf,.docx,.xlsx,.pptx,.txt,.csv,.zip,.png,.jpg,.jpeg,.gif,.webp,application/pdf';

/**
 * "Upload a document": a button-looking label for a file box (a keyboard reaches the box; its focus shows on the
 * button). The chosen file is handed over and the box emptied, so the same file can be chosen again.
 */
export function FilePickButton({ label, accept, disabled, onPick, variant = 'secondary' }: { label: string; accept: string; disabled?: boolean; onPick: (file: File) => void; variant?: 'primary' | 'secondary' }) {
  const id = useId();
  return (
    <span className="inline-flex">
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
        className="peer sr-only"
      />
      <label htmlFor={id} className={buttonClass(variant, 'sm', `cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 peer-disabled:pointer-events-none peer-disabled:opacity-60 [@media(pointer:coarse)]:!min-h-11`)}>
        {label}
      </label>
    </span>
  );
}

/** An upload with its progress (0–100) and its problem in plain words; refused before sending when too big. */
export function useUpload() {
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  async function run<T>(file: File, maxBytes: number, send: (onProgress: (f: number) => void) => Promise<T>): Promise<T | null> {
    setProblem(null);
    if (file.size > maxBytes) {
      setProblem(`“${file.name}” is ${sizeText(file.size)}: the most is ${sizeText(maxBytes)}.`);
      return null;
    }
    setProgress(0);
    try {
      return await send((f) => setProgress(Math.round(Math.max(0, Math.min(1, f)) * 100)));
    } catch (err) {
      setProblem(`Couldn’t upload “${file.name}”. ${problemText(err)}`);
      return null;
    } finally {
      setProgress(null);
    }
  }
  return { progress, problem, busy: progress !== null, run, clear: () => setProblem(null), fail: setProblem };
}

/** "Uploading… 40%" with a bar, read out as it goes. */
export function UploadProgress({ progress, label = 'Uploading' }: { progress: number | null; label?: string }) {
  if (progress === null) return null;
  return (
    <div className="flex items-center gap-3" role="status">
      <progress max={100} value={progress} aria-label={label} className="h-2 w-40 overflow-hidden rounded-full [&::-moz-progress-bar]:bg-brand [&::-webkit-progress-bar]:bg-ground [&::-webkit-progress-value]:bg-brand" />
      <span className="text-xs text-ink-2">{`${label}… ${progress}%`}</span>
    </div>
  );
}
