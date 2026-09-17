import { assetUrl } from '../../api/client';

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** Profile image path (server-relative like /uploads/<key>, or an absolute URL). Falls back to initials. */
  src?: string | null;
}

const SIZE: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-16 w-16 text-lg',
};

export function Avatar({ name, size = 'md', src }: AvatarProps) {
  const resolved = src && src.startsWith('/') ? assetUrl(src) : src ?? undefined;
  if (resolved) {
    return (
      <img
        src={resolved}
        alt={name}
        title={name}
        className={`inline-block flex-none rounded-full border border-surface object-cover ${SIZE[size]}`}
      />
    );
  }

  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <span
      title={name}
      aria-label={name}
      className={`inline-flex flex-none items-center justify-center rounded-full border border-surface bg-brand/10 font-semibold text-brand ${SIZE[size]}`}
    >
      {initials}
    </span>
  );
}
