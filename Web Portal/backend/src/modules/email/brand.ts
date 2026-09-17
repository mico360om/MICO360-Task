/**
 * Brand + company configuration used by every email template. Defaults are the
 * MICO360 identity; `server.ts` overrides them from env at startup via
 * `configureBrand()` so deployments can set real contact/legal details without
 * touching template code.
 */
export interface Brand {
  /** Legal/company name (used in the copyright line). */
  companyName: string;
  /** Product name shown in headers and subjects. */
  productName: string;
  /** Text wordmark parts (used when no logo image is configured — images are often blocked). */
  wordmark: { pre: string; mid: string; post: string };
  /** Optional hosted logo image URL (falls back to the text wordmark). */
  logoUrl?: string;
  colors: {
    brand: string;
    brand2: string;
    onBrand: string;
    ink: string;
    ink2: string;
    line: string;
    surface: string;
    ground: string;
    footerBg: string;
    footerInk: string;
  };
  /** Web app URL (CTA links, "open the app"). */
  appUrl: string;
  /** Marketing/website URL shown in the footer. */
  websiteUrl: string;
  /** Support inbox shown in the footer + used for "contact us". */
  supportEmail: string;
  /** Postal address line for the footer (CAN-SPAM / good practice). */
  companyAddress: string;
  /** Short tagline shown under the header. */
  tagline: string;
}

export const DEFAULT_BRAND: Brand = {
  companyName: 'MICO360',
  productName: 'MICO360 Tasks',
  wordmark: { pre: 'MICO', mid: '360', post: 'Tasks' },
  colors: {
    brand: '#8B1E1E',
    brand2: '#A83326',
    onBrand: '#FFFFFF',
    ink: '#211B1A',
    ink2: '#6C625F',
    line: '#E6DFDC',
    surface: '#FFFFFF',
    ground: '#F4F2F0',
    footerBg: '#F4F2F0',
    footerInk: '#8A7F7B',
  },
  appUrl: 'http://localhost:5173',
  websiteUrl: 'https://mico360.example',
  supportEmail: 'support@mico360.example',
  companyAddress: 'MICO360, Muscat, Sultanate of Oman',
  tagline: 'Project & task management for teams',
};

let current: Brand = DEFAULT_BRAND;

/** Override the default brand once at startup (server composition root). */
export function configureBrand(overrides: Partial<Brand>): void {
  current = { ...current, ...overrides, colors: { ...current.colors, ...(overrides.colors ?? {}) } };
}

/** The active brand, merged with any per-call overrides. */
export function resolveBrand(overrides?: Partial<Brand>): Brand {
  if (!overrides) return current;
  return { ...current, ...overrides, colors: { ...current.colors, ...(overrides.colors ?? {}) } };
}
