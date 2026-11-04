import type { SearchKind } from '../../lib/search-everything';

/** Each kind's line icon (24px grid, drawn in the current colour). */
const PATHS: Record<SearchKind, JSX.Element> = {
  task: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>,
  project: <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  meeting: <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M8 3.5v4M16 3.5v4M4 10h16" /></>,
  note: <><path d="M5 4.5h14v10l-5 5H5z" /><path d="M14 19.5v-5h5M8 9h8M8 12.5h4" /></>,
  minutes: <><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4M10 12h5M10 15.5h5" /></>,
  file: <path d="m19 11.5-6.8 6.8a4.2 4.2 0 0 1-6-6l7.1-7.1a2.8 2.8 0 0 1 4 4l-7 7a1.4 1.4 0 0 1-2-2l6.4-6.4" />,
  inspection: <><rect x="5.5" y="4.5" width="13" height="16" rx="2" /><path d="M9 4.5V3.5h6v1M9 12l2 2 4-4.5" /></>,
};

/** The kind's icon in a small tinted square (decorative: the kind is also written next to it). */
export function KindIcon({ kind, size = 'md', className = '' }: { kind: SearchKind; size?: 'sm' | 'md'; className?: string }) {
  const box = size === 'sm' ? 'h-6 w-6 rounded-md' : 'h-8 w-8 rounded-lg';
  const px = size === 'sm' ? 14 : 16;
  return (
    <span aria-hidden="true" data-kind-icon={kind} className={`grid flex-none place-items-center bg-brand/10 text-brand ${box} ${className}`}>
      <svg viewBox="0 0 24 24" width={px} height={px} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[kind]}
      </svg>
    </span>
  );
}
