import { useId } from 'react';

export interface LogoProps {
  /** Pixel size of the square mark. */
  size?: number;
  /**
   * `brand` = brand-gradient tile with a white check (use on light surfaces, header, favicon).
   * `inverse` = frosted white tile with a brand check (use on the brand-red panel / dark grounds).
   */
  variant?: 'brand' | 'inverse';
  className?: string;
  title?: string;
}

/**
 * The MICO360 Tasks graphic mark — a rounded app tile with an integrated
 * checkmark + progress node. Graphic only (no text), scalable, theme-aware.
 */
export function Logo({ size = 36, variant = 'brand', className, title = 'MICO360 Tasks' }: LogoProps) {
  const gid = useId();
  const inverse = variant === 'inverse';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      <defs>
        <linearGradient id={`${gid}-tile`} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#C7513F" />
          <stop offset="0.55" stopColor="#8B1E1E" />
          <stop offset="1" stopColor="#5E1414" />
        </linearGradient>
        <linearGradient id={`${gid}-sheen`} x1="10" y1="6" x2="24" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* App tile */}
      <rect
        x="3"
        y="3"
        width="42"
        height="42"
        rx="13"
        fill={inverse ? '#ffffff' : `url(#${gid}-tile)`}
      />
      {/* Soft top-left highlight for depth */}
      <rect x="3" y="3" width="42" height="42" rx="13" fill={`url(#${gid}-sheen)`} />

      {/* Progress node at the check's start */}
      <circle cx="15.5" cy="24.5" r="2.6" fill={inverse ? '#8B1E1E' : '#ffffff'} />
      {/* Checkmark */}
      <path
        d="M15.5 24.5 L22 31 L33 18"
        stroke={inverse ? '#8B1E1E' : '#ffffff'}
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
