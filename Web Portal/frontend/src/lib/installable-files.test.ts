import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The installable website's static files (public/): the manifest, the icons drawn from the brand mark
// (scripts/make-app-icons.mjs), the offline page and index.html's Apple tags.
const PUBLIC = resolve(__dirname, '../../public');
const read = (p: string) => readFileSync(resolve(PUBLIC, p), 'utf8');
const INDEX = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

/** A PNG's width, height and colour type (2 = RGB, no transparency; 6 = RGBA), from its header. */
function png(p: string) {
  const b = readFileSync(resolve(PUBLIC, p));
  expect(b.subarray(1, 4).toString('latin1'), p).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25] };
}

interface Manifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
  shortcuts: { name: string; url: string; icons?: { src: string }[] }[];
}

describe('the web app manifest (public/manifest.webmanifest)', () => {
  const m = JSON.parse(read('manifest.webmanifest')) as Manifest;

  it('names the app, opens the person’s usual start page, standalone, in the brand colours', () => {
    expect(m.name).toBe('MICO360 Tasks');
    expect(m.short_name).toBe('MICO360');
    expect(m.id).toBe('/');
    expect(m.start_url).toBe('/');
    expect(m.scope).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#8B1E1E');
    // The page's own first-paint colour (index.html's loading screen), so opening the app doesn't flash.
    expect(INDEX).toContain(m.background_color);
  });

  it('has 192 and 512 PNG icons and a 512 maskable one, each the size it says', () => {
    expect(m.icons.map((i) => `${i.sizes} ${i.purpose ?? 'any'}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const icon of m.icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src.startsWith('/')).toBe(true);
      const size = png(icon.src.slice(1));
      expect(`${size.width}x${size.height}`, icon.src).toBe(icon.sizes);
    }
    // A maskable icon is cut to the phone's shape: the brand colour reaches every edge (no transparency).
    expect(png('icons/icon-maskable-512.png').colourType).toBe(2);
  });

  it('offers New task, My Tasks and Meetings as shortcuts, each a page of the site', () => {
    expect(m.shortcuts.map((s) => [s.name, s.url])).toEqual([
      ['New task', '/my-tasks?new=task'],
      ['My Tasks', '/my-tasks'],
      ['Meetings', '/meetings'],
    ]);
    for (const s of m.shortcuts) for (const i of s.icons ?? []) expect(existsSync(resolve(PUBLIC, i.src.slice(1))), i.src).toBe(true);
  });
});

describe('index.html: the iPhone and iPad tags', () => {
  it('a 180px PNG home-screen icon (iOS ignores an SVG), with no transparent corners', () => {
    expect(INDEX).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(INDEX).not.toContain('rel="apple-touch-icon" href="/favicon.svg"');
    const icon = png('apple-touch-icon.png');
    expect([icon.width, icon.height, icon.colourType]).toEqual([180, 180, 2]);
  });

  it('the installed app’s title and status bar; the manifest itself is linked by the page on staff pages only', () => {
    expect(INDEX).toContain('<meta name="apple-mobile-web-app-title" content="MICO360" />');
    expect(INDEX).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default" />');
    expect(INDEX).toContain('<meta name="theme-color" content="#8B1E1E" />');
    // Not in the file every page shares: lib/manifest-link adds it on staff pages (never /client).
    expect(INDEX).not.toMatch(/rel="manifest"/);
    expect(INDEX).not.toMatch(/apple-mobile-web-app-capable/);
  });
});

describe('the offline page (public/offline.html)', () => {
  const page = read('offline.html');

  it('says what happened and what still works, with a way to try again', () => {
    expect(page).toContain('<html lang="en">');
    expect(page).toContain('You’re offline');
    expect(page).toContain('This page needs a connection.');
    expect(page).toMatch(/Inspections you already opened keep working offline/);
    // Try again reloads the address the person asked for (no script needed: an empty link is this page).
    expect(page).toMatch(/<a[^>]+href=""[^>]*>Try again<\/a>/);
  });

  it('works under the site’s security policy and holds no data: no script, nothing from another site', () => {
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/\son[a-z]+=/i);
    expect(page).not.toMatch(/(src|href)="(https?:)?\/\//i);
    expect(page).not.toMatch(/\/api\//);
  });

  it('light and dark, in the brand colour', () => {
    expect(page).toContain('@media (prefers-color-scheme: dark)');
    expect(page).toContain('#8B1E1E');
    expect(page).toContain('name="viewport"');
  });
});
