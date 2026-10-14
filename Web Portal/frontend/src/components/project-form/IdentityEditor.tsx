import { useRef, useState } from 'react';
import { PROJECT_COLORS, PROJECT_ICON_KEYS, PROJECT_ICON_LABEL, ProjectIconGlyph, readableOn } from '../../lib/project-icons';
import { ImageCropper, type CroppedImage } from './ImageCropper';

/** Names people use for the colours on offer (each swatch's accessible name). */
export const COLOR_NAMES: Record<string, string> = {
  '#8B1E1E': 'Maroon', '#B5432E': 'Brick', '#C2410C': 'Orange', '#B7791F': 'Amber', '#4D7C0F': 'Olive', '#2E7D53': 'Green', '#0F766E': 'Teal',
  '#0E7490': 'Cyan', '#1E5A8B': 'Blue', '#4338CA': 'Indigo', '#7A5AA8': 'Violet', '#9D174D': 'Berry', '#475569': 'Slate', '#1F2937': 'Charcoal',
};

/** Picture files a project can use, and the largest one accepted before cropping. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/** What a chosen file can't be (null when it is fine to crop). */
export function imageFileProblem(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return `“${file.name}” can’t be used — use a PNG, JPG or WebP image.`;
  if (file.size > MAX_SOURCE_BYTES) return `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB — pictures can be up to 10 MB.`;
  if (file.size === 0) return `“${file.name}” is empty.`;
  return null;
}

export type ImageChoice = { kind: 'keep' } | { kind: 'new'; blob: Blob; previewUrl: string } | { kind: 'remove' };

/**
 * How the project looks: a colour and an icon (or its initials), or an uploaded picture —
 * dropped on the panel or chosen from the device, then cropped.
 */
export function IdentityEditor({
  color,
  icon,
  hasImage,
  onColor,
  onIcon,
  onImage,
}: {
  color: string;
  icon: string | null;
  /** A picture is set (saved or newly chosen). */
  hasImage: boolean;
  onColor: (c: string) => void;
  onIcon: (i: string | null) => void;
  onImage: (choice: ImageChoice) => void;
}) {
  const [tab, setTab] = useState<'icon' | 'image'>(hasImage ? 'image' : 'icon');
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textOn = readableOn(color);

  function take(f: File | undefined | null) {
    if (!f) return;
    const p = imageFileProblem(f);
    setProblem(p);
    setFile(p ? null : f);
  }

  const tabButton = (t: 'icon' | 'image', label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      aria-pressed={tab === t}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tab === t ? 'bg-surface text-ink shadow-soft' : 'text-ink-2 hover:text-ink'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-2xl border border-line bg-ground/60 p-3 sm:p-4">
      <div role="group" aria-label="Appearance" className="mb-3 inline-flex rounded-xl bg-line/40 p-1">
        {tabButton('icon', 'Icon & colour')}
        {tabButton('image', 'Image')}
      </div>

      {tab === 'icon' ? (
        <div className="flex flex-col gap-4">
          {hasImage ? <p className="text-xs text-ink-2">A picture is set, so it is shown instead of the icon. Remove it on the Image tab to use the icon.</p> : null}
          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-2">Colour</legend>
            <div className="flex flex-wrap items-center gap-2">
              {PROJECT_COLORS.map((c) => (
                <label key={c} className="relative cursor-pointer" title={COLOR_NAMES[c]}>
                  <input type="radio" name="project-color" value={c} checked={color.toUpperCase() === c.toUpperCase()} onChange={() => onColor(c)} aria-label={COLOR_NAMES[c] ?? c} className="peer sr-only" />
                  <span
                    aria-hidden="true"
                    className="block h-8 w-8 rounded-full ring-offset-2 ring-offset-ground transition-transform peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-brand hover:scale-110"
                    style={{ background: c }}
                  />
                </label>
              ))}
              <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs font-semibold text-ink-2 hover:border-brand">
                <span aria-hidden="true" className="h-4 w-4 rounded-full border border-line" style={{ background: color }} />
                Custom
                <input type="color" value={color} onChange={(e) => onColor(e.target.value.toUpperCase())} aria-label="Custom colour" className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-2">Icon</legend>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
              {[null, ...PROJECT_ICON_KEYS].map((key) => {
                const checked = icon === key;
                return (
                  <label key={key ?? 'initials'} className="relative cursor-pointer" title={key ? PROJECT_ICON_LABEL[key] : 'Initials'}>
                    <input type="radio" name="project-icon" checked={checked} onChange={() => onIcon(key)} aria-label={key ? PROJECT_ICON_LABEL[key] : 'Initials'} className="peer sr-only" />
                    <span
                      aria-hidden="true"
                      className={`grid h-10 w-full place-items-center rounded-xl border text-xs font-bold transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand ${checked ? 'border-transparent' : 'border-line bg-surface text-ink-2 hover:border-brand hover:text-ink'}`}
                      style={checked ? { background: color, color: textOn } : undefined}
                    >
                      {key ? <ProjectIconGlyph icon={key} size={18} /> : 'Aa'}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      ) : file ? (
        <ImageCropper
          file={file}
          onCancel={() => setFile(null)}
          onDone={(img: CroppedImage) => {
            setFile(null);
            onImage({ kind: 'new', ...img });
          }}
        />
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files?.[0]); }}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? 'border-brand bg-brand/5' : 'border-line bg-surface'}`}
        >
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-2">
            <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-4.5-4.5L7 20" />
          </svg>
          <p className="text-sm text-ink">Drag a logo or picture here, or</p>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label="Project image file" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white">
              {hasImage ? 'Replace picture' : 'Choose a picture'}
            </button>
            {hasImage ? (
              <button type="button" onClick={() => onImage({ kind: 'remove' })} className="rounded-lg border border-line px-3.5 py-1.5 text-sm font-semibold text-danger hover:border-danger">
                Remove picture
              </button>
            ) : null}
          </div>
          <p className="text-xs text-ink-2">PNG, JPG or WebP, up to 10 MB. You can crop it next; it is saved as a square.</p>
          {problem ? <p role="alert" className="text-sm font-medium text-danger">{problem}</p> : null}
        </div>
      )}
    </div>
  );
}
