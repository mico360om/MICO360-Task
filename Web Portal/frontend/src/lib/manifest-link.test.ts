import { describe, it, expect, beforeEach } from 'vitest';
import { MANIFEST_HREF, offersInstall, syncManifestLink } from './manifest-link';

const links = () => [...document.head.querySelectorAll('link[rel="manifest"]')].map((l) => l.getAttribute('href'));
const meta = (name: string) => document.head.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;

describe('the manifest is linked from staff pages only (owner P2: no install offer for clients)', () => {
  beforeEach(() => {
    document.head.innerHTML = '<title>MICO360 Tasks</title>';
  });

  it('staff pages and the sign-in page offer the app', () => {
    for (const path of ['/', '/login', '/dashboard', '/my-tasks', '/meetings/m1', '/inspections/i1', '/privacy', '/about']) {
      expect(offersInstall(path), path).toBe(true);
    }
  });

  it('a client’s pages never do: the shared client page, its privacy notice and the Client portal', () => {
    // …and the public certificate check (review, 13 Nov: outsiders and clients open it).
    for (const path of ['/client', '/client/abc123', '/privacy/client', '/privacy/client/', '/portal', '/portal/projects/p1', '/verify', '/verify/ABC-123']) {
      expect(offersInstall(path), path).toBe(false);
    }
    // Only those: a staff page whose name starts the same is still a staff page.
    expect(offersInstall('/clients')).toBe(true);
    expect(offersInstall('/portals')).toBe(true);
    expect(offersInstall('/verifying')).toBe(true);
  });

  it('adds one manifest link and the installed-app tags, once, on a staff page', () => {
    syncManifestLink(document, '/dashboard');
    syncManifestLink(document, '/my-tasks');
    expect(links()).toEqual([MANIFEST_HREF]);
    expect(MANIFEST_HREF).toBe('/manifest.webmanifest');
    expect(meta('apple-mobile-web-app-capable')).toBe('yes');
    expect(meta('mobile-web-app-capable')).toBe('yes');
  });

  it('removes them on a client’s page', () => {
    syncManifestLink(document, '/dashboard');
    syncManifestLink(document, '/client/abc123');
    expect(links()).toEqual([]);
    expect(meta('apple-mobile-web-app-capable')).toBeNull();
    expect(meta('mobile-web-app-capable')).toBeNull();
    syncManifestLink(document, '/portal');
    expect(links()).toEqual([]);
  });
});
