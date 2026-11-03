import { useState } from 'react';
import { assetUrl } from '../../api/client';

export type CompanyLogoSize = 16 | 20 | 32 | 48;

/** A building: a company without a logo (or one that couldn't be loaded). */
export function BuildingIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
      <path d="M15 9h4a1 1 0 0 1 1 1v11" />
      <path d="M3 21h18M8 8h3M8 12h3M8 16h3" />
    </svg>
  );
}

/**
 * A company's logo, square, the picture kept whole (`object-contain`). Without one — or when it can't
 * be loaded — a building icon. Next to the company's name it says nothing itself (`alt=""`); where
 * it stands alone, give `alt` the company's name.
 */
export function CompanyLogo({ company, size, alt = '' }: { company: { name: string; logoUrl: string | null } | null; size: CompanyLogoSize; alt?: string }) {
  const src = company?.logoUrl ? assetUrl(company.logoUrl) : undefined;
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <BuildingIcon size={size} />;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      onError={() => setFailed(src)}
      className="flex-none rounded object-contain"
      style={{ width: size, height: size }}
    />
  );
}
