/** Line icons for the chat (24×24, current colour, hidden from assistive tech — the button names them). */
import type { ReactNode } from 'react';

function Icon({ size = 18, children, strokeWidth = 1.8, className }: { size?: number; children: ReactNode; strokeWidth?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}
type P = { size?: number; className?: string };

export const BackIcon = (p: P) => <Icon {...p} strokeWidth={2}><path d="M15 18l-6-6 6-6" /></Icon>;
export const SearchIcon = (p: P) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>;
export const PlusIcon = (p: P) => <Icon {...p} strokeWidth={2}><path d="M12 5v14M5 12h14" /></Icon>;
export const CloseIcon = (p: P) => <Icon {...p} strokeWidth={2}><path d="M18 6 6 18M6 6l12 12" /></Icon>;
export const ChevronIcon = (p: P) => <Icon {...p} strokeWidth={2}><path d="m6 9 6 6 6-6" /></Icon>;
export const MoreIcon = (p: P) => <Icon {...p} strokeWidth={2.4}><path d="M5 12h.01M12 12h.01M19 12h.01" /></Icon>;
export const SendIcon = (p: P) => <Icon {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></Icon>;
export const PaperclipIcon = (p: P) => <Icon {...p}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Icon>;
export const SmileIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01M15 9h.01" /></Icon>;
export const ReplyIcon = (p: P) => <Icon {...p}><path d="M9 17 4 12l5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></Icon>;
export const CopyIcon = (p: P) => <Icon {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>;
export const EditIcon = (p: P) => <Icon {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>;
export const TrashIcon = (p: P) => <Icon {...p}><path d="M3 6h18" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></Icon>;
export const UsersIcon = (p: P) => <Icon {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></Icon>;
export const BellIcon = (p: P) => <Icon {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></Icon>;
export const BellOffIcon = (p: P) => <Icon {...p}><path d="M13.73 21a2 2 0 0 1-3.46 0" /><path d="M18.63 13A17.9 17.9 0 0 1 18 8" /><path d="M6.26 6.26A5.9 5.9 0 0 0 6 8c0 7-3 9-3 9h14" /><path d="M18 8a6 6 0 0 0-9.33-5" /><path d="m1 1 22 22" /></Icon>;
export const StarIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" width={p.size ?? 18} height={p.size ?? 18} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true" className={p.className}>
    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);
export const ArchiveIcon = (p: P) => <Icon {...p}><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></Icon>;
export const VolumeIcon = (p: P) => <Icon {...p}><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" /></Icon>;
export const VolumeOffIcon = (p: P) => <Icon {...p}><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="m23 9-6 6M17 9l6 6" /></Icon>;
export const FileIcon = (p: P) => <Icon {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></Icon>;
export const DownloadIcon = (p: P) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></Icon>;
export const ClockIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
export const AlertIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></Icon>;
export const HashIcon = (p: P) => <Icon {...p} strokeWidth={2.2}><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></Icon>;
export const ArrowDownIcon = (p: P) => <Icon {...p} strokeWidth={2}><path d="M12 5v14M19 12l-7 7-7-7" /></Icon>;
export const MessageIcon = (p: P) => <Icon {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Icon>;
export const WifiOffIcon = (p: P) => <Icon {...p}><path d="m1 1 22 22" /><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" /></Icon>;

/** The ticks on your own messages: one = sent, two = delivered, two bold = read. */
export function Ticks({ double, bold }: { double: boolean; bold?: boolean }) {
  const Check = ({ x = 0 }: { x?: number }) => (
    <path d={`M${1 + x} 6.5 ${5 + x} 10.5 ${15 + x} 1.5`} />
  );
  return (
    <svg viewBox="0 0 20 12" width={double ? 17 : 13} height="10" fill="none" stroke="currentColor" strokeWidth={bold ? 2.6 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <Check />
      {double ? <Check x={4} /> : null}
    </svg>
  );
}
