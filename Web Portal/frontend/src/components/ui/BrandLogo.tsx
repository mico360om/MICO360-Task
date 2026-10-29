import logo from '../../assets/logo.png';
import logoW from '../../assets/logo-w.png';

export interface BrandLogoProps {
  /** Its height (and any spacing): e.g. "h-9". */
  className?: string;
  alt?: string;
  /** Below the fold or in a hidden panel: fetch only when shown (the other theme's copy never is). */
  lazy?: boolean;
}

/**
 * The MICO360 logo, one picture per theme: dark letters on the light theme, white letters on the dark
 * one (the dark-lettered logo alone vanished on a dark card). The size attributes reserve its space.
 */
export function BrandLogo({ className = 'h-9', alt = 'MICO360', lazy = false }: BrandLogoProps) {
  const common = { alt, width: 409, height: 192, decoding: 'async' as const, ...(lazy ? { loading: 'lazy' as const } : {}) };
  return (
    <>
      <img src={logo} {...common} className={`${className} w-auto max-w-full object-contain dark:hidden`} />
      <img src={logoW} {...common} className={`${className} hidden w-auto max-w-full object-contain dark:block`} />
    </>
  );
}
