import qrcode from 'qrcode-generator';

/** The QR code of `text` as rows of dark (true) / light modules; error correction M, smallest type that fits. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
