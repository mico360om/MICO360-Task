import { useEffect, useMemo, useState } from 'react';
import { assetUrl } from '../../api/client';
import type { CertificateRef } from '../../api/training';
import logo from '../../assets/logo.png';
import { QrCode, qrModuleCount } from './QrCode';
import { dayKeyIn } from '../../lib/day-words';
import { useCompanyTimeZone } from '../../lib/useCompanyTimeZone';
import {
  CERT_COLORS,
  CERT_PAGE,
  CERT_SCAN,
  CERT_SHAPES,
  CERT_STAMP,
  CERT_TEXT,
  CERT_WREATH,
  certQrBox,
  certificateDay,
  certificateRows,
  certificateStamp,
  certificateWords,
  shapePath,
  type CertFace,
  type CertMeasure,
} from './certificate-art';

const W = CERT_PAGE.width;
const H = CERT_PAGE.height;

/**
 * The faces on screen: the site's own Archivo (900) and IBM Plex Sans, Great Vibes for the name (index.css: the file from
 * the @expo-google-fonts/great-vibes package, fetched only when a certificate is shown), and for an Arabic name
 * Noto Naskh Arabic where the device has it.
 */
const FONT: Record<CertFace, { family: string; weight: number }> = {
  heading: { family: "Archivo, 'IBM Plex Sans', sans-serif", weight: 900 },
  text: { family: "'IBM Plex Sans', system-ui, sans-serif", weight: 400 },
  'text-bold': { family: "'IBM Plex Sans', system-ui, sans-serif", weight: 600 },
  script: { family: "'Great Vibes', cursive", weight: 400 },
  arabic: { family: "'Noto Naskh Arabic', 'IBM Plex Sans', serif", weight: 400 },
};

/** Widths measured with the browser's own fonts (a canvas); an estimate where there is none (tests). */
let canvas: CanvasRenderingContext2D | null | undefined;
const measure: CertMeasure = (text, face, size, spacing = 0) => {
  const chars = Array.from(text).length;
  if (canvas === undefined) {
    try {
      canvas = document.createElement('canvas').getContext('2d');
    } catch {
      canvas = null;
    }
  }
  if (!canvas) return chars * size * (face === 'heading' ? 0.7 : face === 'script' ? 0.45 : 0.56) + spacing * chars;
  canvas.font = `${FONT[face].weight} ${size}px ${FONT[face].family}`;
  return canvas.measureText(text).width + spacing * chars;
};

/** Counts up once the certificate's faces have loaded, so the words are measured again with them. */
function useFontsLoaded(): number {
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts?.load) return;
    let live = true;
    const faces = (Object.keys(FONT) as CertFace[]).filter((f) => f !== 'arabic').map((f) => `${FONT[f].weight} 24px ${FONT[f].family}`);
    void Promise.all(faces.map((f) => fonts.load(f).catch(() => []))).then(() => {
      if (live) setLoaded((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, []);
  return loaded;
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** A day on the certificate in full ("14 November 2026", the owner's), in the company's time zone as on its PDF (qa124). */
const fullDay = (iso: string, timeZone: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : certificateDay(dayKeyIn(at, timeZone));
};

/** Where a company's logo loads from: a stored '/uploads/…' on the API's address, a full http(s) address as it is; else none. */
function companyLogoSrc(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/')) return assetUrl(url) ?? null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * The certificate itself (1.23.35), the same design as its PDF: one A4 landscape page drawn in an SVG scaled to the
 * width (its shape kept), light like paper in both themes — the red angled shapes, the logo (the company's, else
 * MICO360's), the words placed by the shared layout (certificate-art.ts, measured with the browser's fonts), the laurel
 * wreath with the QR code of the public check in its middle and "Scan to verify", and the faint stamp once expired or
 * revoked. Its words are real text (read top to bottom; the shapes are hidden decoration), the logo and the QR code
 * are named images. Laid out left to right like the PDF, also on a right-to-left page.
 */
export function CertificatePaper({ certificate: cert }: { certificate: CertificateRef }) {
  const fontsLoaded = useFontsLoaded();
  const timeZone = useCompanyTimeZone();
  // An older server's answer without the day finished: the day it was issued.
  const completedAt = cert.completedAt || cert.issuedAt;
  const companyName = cert.company?.name ?? '';
  const rows = useMemo(
    () =>
      certificateRows(
        { code: cert.code, completedAt, issuedAt: cert.issuedAt, expiresAt: cert.expiresAt, scorePct: cert.scorePct ?? null, issuerName: cert.issuerName ?? null, issuerTitle: cert.issuerTitle ?? null, status: cert.status, revokedAt: cert.revokedAt ?? null, revokedReason: cert.revokedReason ?? null },
        (iso) => fullDay(iso, timeZone),
      ),
    [cert, completedAt, timeZone],
  );
  const plan = useMemo(
    () => certificateWords({ learnerName: cert.learnerName, courseTitle: cert.courseTitle, companyName, productName: 'MICO360 Tasks', rows, signature: null }, measure),
    // fontsLoaded: measured again once the faces are in.
    [cert.learnerName, cert.courseTitle, companyName, rows, fontsLoaded],
  );
  const modules = useMemo(() => qrModuleCount(cert.verifyUrl), [cert.verifyUrl]);
  const box = modules ? certQrBox(modules) : null;
  const stamp = certificateStamp(cert.status);
  const stampWidth = stamp ? measure(stamp.text, 'heading', CERT_STAMP.size) : 0;
  const stampHeight = CERT_STAMP.size * 0.686;
  // The company's logo ('/uploads/…' on the API's address, or a full http(s) address), else MICO360's; MICO360's too when it won't load.
  const companyLogo = companyLogoSrc(cert.company?.logoUrl ?? null);
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null);
  const ownLogo = companyLogo && brokenLogo !== companyLogo ? companyLogo : null;
  const logoSrc = ownLogo ?? logo;
  const { logo: L } = CERT_TEXT;

  return (
    <div data-certificate-frame dir="ltr" className="relative w-full overflow-hidden rounded-md shadow-sm ring-1 ring-black/10" style={{ aspectRatio: `${W} / ${H}`, backgroundColor: '#ffffff', color: CERT_COLORS.ink }}>
      {/* The certificate's words are the drawing's own text (read in order, top to bottom); the shapes are decoration. */}
      <svg data-certificate-paper role="group" aria-label="Certificate of completion" viewBox={`0 0 ${W} ${H}`} textRendering="geometricPrecision" className="absolute inset-0 block h-full w-full" style={{ direction: 'ltr' }}>
        <g aria-hidden="true">
          <rect width={W} height={H} fill={CERT_COLORS.paper} />
          {CERT_SHAPES.map((s, i) => (
            <path key={`s${i}`} d={shapePath(s)} fill={s.color} fillOpacity={s.opacity} />
          ))}
          {CERT_WREATH.paths.map((d, i) => (
            <path key={`w${i}`} d={d} fill={CERT_WREATH.color} />
          ))}
        </g>
        <image role="img" aria-label={ownLogo ? `${companyName || 'Company'} logo` : 'MICO360 Tasks'} href={logoSrc} onError={() => setBrokenLogo(ownLogo)} x={L.x} y={L.top} width={L.width} height={L.height} preserveAspectRatio="xMinYMid meet" />
        <rect aria-hidden="true" x={plan.rule.x} y={plan.rule.y} width={plan.rule.width} height={plan.rule.height} fill={CERT_COLORS.red} />
        {plan.words.map((w, i) => (
          <text key={i} data-certificate-word={w.role} data-certificate-row={w.row} x={w.x} y={w.baseline} fontFamily={FONT[w.face].family} fontWeight={FONT[w.face].weight} fontSize={w.size} letterSpacing={w.spacing || undefined} fill={w.color}>
            {w.text}
          </text>
        ))}
        {box ? (
          <text data-certificate-scan x={CERT_SCAN.cx} y={CERT_SCAN.baseline} textAnchor="middle" fontFamily={FONT['text-bold'].family} fontWeight={600} fontSize={CERT_SCAN.size} fill={CERT_COLORS.ink}>
            Scan to verify
          </text>
        ) : null}
        {stamp ? (
          <g transform={`translate(${CERT_STAMP.cx} ${CERT_STAMP.cy}) rotate(${CERT_STAMP.angle})`} opacity={CERT_STAMP.opacity}>
            <rect x={-stampWidth / 2 - 22} y={-stampHeight / 2 - 20} width={stampWidth + 44} height={stampHeight + 40} rx={14} fill="none" stroke={stamp.color} strokeWidth={5} />
            <text data-certificate-stamp x={0} y={stampHeight / 2} textAnchor="middle" fontFamily={FONT.heading.family} fontWeight={900} fontSize={CERT_STAMP.size} fill={stamp.color}>
              {stamp.text}
            </text>
          </g>
        ) : null}
      </svg>
      {box ? (
        // White in both themes: a QR code on a dark page doesn't scan.
        <div data-certificate-qr className="absolute bg-white text-black" style={{ left: pct(box.x, W), top: pct(box.y, H), width: pct(box.size, W), height: pct(box.size, H) }}>
          <QrCode value={cert.verifyUrl} size={120} label={`QR code: check certificate ${cert.code} online`} className="block h-full w-full" />
        </div>
      ) : null}
    </div>
  );
}
