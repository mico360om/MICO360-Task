import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** The empty border a reader needs around the code, in modules (the QR standard's quiet zone). */
const QUIET = 4;

/**
 * A QR code as an SVG image (1.23.30: the certificate's public check link). Made in the page with qrcode-generator
 * (the server's PDF uses the same package, error correction M): one path of the dark modules in the text colour over
 * a white square with a 4-module quiet zone — put it on a white tile (`bg-white text-black`) so it scans in dark mode
 * too. Nothing is drawn for an empty value or one too long for a QR code.
 */
export function QrCode({ value, size, label }: { value: string; size: number; label: string }) {
  const drawn = useMemo(() => {
    if (!value) return null;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
      return { d, side: n + QUIET * 2 };
    } catch {
      return null;
    }
  }, [value]);
  if (!drawn) return null;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${drawn.side} ${drawn.side}`} width={size} height={size} shapeRendering="crispEdges" className="block">
      <rect width={drawn.side} height={drawn.side} fill="#fff" />
      <path d={drawn.d} fill="currentColor" />
    </svg>
  );
}
