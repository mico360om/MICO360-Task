// One-off: the installable website's PNG icons, drawn from the brand mark (public/favicon.svg,
// components/ui/Logo.tsx). Run again only when the mark changes:
//   node scripts/make-app-icons.mjs
// It uses sharp, which the monorepo already has (the server shrinks pictures with it); the website
// itself gains no dependency. The PNGs are committed under public/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// The mark's check and its start node, as in favicon.svg (a 48-unit square).
const check = (scale) => `
  <g transform="translate(24 24) scale(${scale}) translate(-24 -24.5)">
    <circle cx="15.5" cy="24.5" r="2.6" fill="#ffffff"/>
    <path d="M15.5 24.5 L22 31 L33 18" stroke="#ffffff" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>`;

const defs = (x1, y1, x2, y2) => `
  <defs>
    <linearGradient id="t" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#C7513F"/>
      <stop offset="0.55" stop-color="#8B1E1E"/>
      <stop offset="1" stop-color="#5E1414"/>
    </linearGradient>
    <linearGradient id="s" x1="10" y1="6" x2="24" y2="26" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>`;

/** "any": the rounded tile on a clear ground, exactly the favicon. */
const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${defs(6, 4, 42, 44)}
  <rect x="3" y="3" width="42" height="42" rx="13" fill="url(#t)"/>
  <rect x="3" y="3" width="42" height="42" rx="13" fill="url(#s)"/>
  ${check(1)}
</svg>`;

/**
 * Full bleed: the brand colour to every edge (a phone cuts its own shape out of it). `scale` sizes the
 * check: 1 keeps it inside the maskable safe zone (the middle 80% circle) with room to spare; the
 * Apple icon (iOS rounds a square's corners only) is a little larger, like the check on the tile.
 */
const bleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${defs(3, 1, 45, 47)}
  <rect x="0" y="0" width="48" height="48" fill="url(#t)"/>
  <rect x="0" y="0" width="48" height="48" fill="url(#s)"/>
  ${check(scale)}
</svg>`;

async function png(svg, size, file, { opaque = false } = {}) {
  let img = sharp(Buffer.from(svg), { density: Math.ceil((72 * size) / 48) * 2 }).resize(size, size);
  if (opaque) img = img.flatten({ background: '#8B1E1E' });
  const out = join(PUBLIC, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await img.png({ compressionLevel: 9 }).toBuffer());
  console.log(`${file} ${size}x${size}`);
}

await png(tile, 192, 'icons/icon-192.png');
await png(tile, 512, 'icons/icon-512.png');
await png(bleed(1), 512, 'icons/icon-maskable-512.png', { opaque: true });
await png(bleed(48 / 42), 180, 'apple-touch-icon.png', { opaque: true });
