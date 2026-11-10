import { useState } from 'react';
import { assetUrl } from '../../api/client';
import { faceUrlOf } from '../../lib/person-photo';
import { personInitials } from '../../lib/initials';
import { DENSE_FACE } from '../../lib/density-tokens';

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** Profile image path (server-relative like /uploads/<key>, or an absolute URL). Falls back to initials (also when it doesn't load). */
  src?: string | null;
  /** A face in a row of a list, table or board: 20px in compact rows (1.23.0, lib/density). */
  dense?: boolean;
  /** The person's name is written right beside the face: hide the face from screen readers (no name said twice). */
  decorative?: boolean;
}

const SIZE: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-16 w-16 text-lg',
};

/**
 * A person's photo to show, or null for the initials. First the photo's small face copy (avatar
 * thumbnails: a few KB, lib/person-photo), then — if that doesn't load — the photo itself, then none
 * (removed, a dead link, offline). A new photo is tried again. Shared by every face that shows a photo.
 */
export function usePersonPhoto(src: string | null | undefined): { url: string | null; onError: () => void } {
  const resolve = (u: string | null) => (u ? (u.startsWith('/') ? assetUrl(u) : u) || null : null);
  const tries = [resolve(faceUrlOf(src)), resolve(src ?? null)].filter((u): u is string => !!u);
  const [failed, setFailed] = useState<string[]>([]);
  const url = tries.find((u) => !failed.includes(u)) ?? null;
  return { url, onError: () => setFailed((was) => (url && !was.includes(url) ? [...was, url] : was)) };
}

export function Avatar({ name, size = 'md', src, dense = false, decorative = false }: AvatarProps) {
  const sizing = dense ? `${SIZE[size]} ${DENSE_FACE}` : SIZE[size];
  const photo = usePersonPhoto(src);
  if (photo.url) {
    return (
      <img
        src={photo.url}
        alt={decorative ? '' : name}
        aria-hidden={decorative || undefined}
        title={name}
        // Faces fill long lists (a board, Activity): fetched as they come into view, decoded off the main thread.
        loading="lazy"
        decoding="async"
        onError={photo.onError}
        className={`inline-block flex-none rounded-full border border-surface object-cover ${sizing}`}
      />
    );
  }

  // Letters only: "Mohammed (OXY)" is "MO", not "M(".
  const initials = personInitials(name);

  return (
    <span
      title={name}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      // The brand tint over a solid card-coloured backing: it looks the same on a card, but avatars
      // stacked over each other no longer show the letters behind through the tint.
      className={`inline-flex flex-none items-center justify-center rounded-full border border-surface bg-surface bg-[linear-gradient(rgb(var(--c-brand)/0.1),rgb(var(--c-brand)/0.1))] font-semibold text-brand ${sizing}`}
    >
      {initials}
    </span>
  );
}
