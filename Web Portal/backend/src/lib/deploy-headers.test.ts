import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CSP_REPORT_PATH, reportingHeaders, webAppCsp } from './web-app';

// The web server configs in deploy/ (nginx, Hostinger's .htaccess) must send the same page headers as
// the backend's own web server (lib/web-app.ts): a client page's address is its private link, so it
// is never sent on as a referrer. Skipped where deploy/ isn't checked out next to the backend.
const repo = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');
const NGINX_SITE = 'deploy/nginx/task.mico360.com.conf';
const NGINX_HEADERS = 'deploy/nginx/security-headers.conf';
const HTACCESS = 'deploy/hostinger/htaccess-security-headers.txt';

describe.skipIf(!existsSync(resolve(repo, NGINX_SITE)))('deploy configs: client pages send no referrer', () => {
  it('nginx: /client/ pages get Referrer-Policy no-referrer, every other page the usual policy', () => {
    const site = read(NGINX_SITE);
    const map = /map \$request_uri \$mico360_referrer \{([^}]+)\}/.exec(site)?.[1] ?? '';
    expect(map).toMatch(/default\s+"strict-origin-when-cross-origin";/);
    expect(map).toMatch(/~\^\/client\/\s+"no-referrer";/);
    const headers = read(NGINX_HEADERS);
    expect(headers).toContain('add_header Referrer-Policy $mico360_referrer always;');
    expect(headers).not.toContain('add_header Referrer-Policy "strict-origin-when-cross-origin"');
  });

  it('Hostinger (.htaccess): the same rule, also after the SPA rewrite to index.html', () => {
    const h = read(HTACCESS);
    expect(h).toContain('SetEnvIf Request_URI "^/client/" MICO360_CLIENT_PAGE');
    expect(h).toContain('SetEnvIf REDIRECT_MICO360_CLIENT_PAGE .+ MICO360_CLIENT_PAGE');
    expect(h).toContain('Header always set Referrer-Policy "strict-origin-when-cross-origin" env=!MICO360_CLIENT_PAGE');
    expect(h).toContain('Header always set Referrer-Policy "no-referrer" env=MICO360_CLIENT_PAGE');
  });
});

// 1.22.4 (the Error log): the three copies of the page policy stay exactly as strict as the backend's
// own (lib/web-app.ts) — the deploy copies name only the live site's wss:// socket — and all of them
// tell browsers where to report what the policy blocks.
describe.skipIf(!existsSync(resolve(repo, NGINX_SITE)))('deploy configs: the same security policy, reporting to the server', () => {
  const live = 'task.mico360.com';
  const expected = webAppCsp(live).replace(`connect-src 'self' ws://${live} wss://${live}`, `connect-src 'self' wss://${live}`);
  const endpoints = reportingHeaders(live, 'https');

  it('nginx: the policy, Reporting-Endpoints and Report-To', () => {
    const h = read(NGINX_HEADERS);
    expect(/add_header Content-Security-Policy "([^"]+)" always;/.exec(h)?.[1]).toBe(expected);
    expect(h).toContain(`add_header Reporting-Endpoints '${endpoints['Reporting-Endpoints']}' always;`);
    expect(h).toContain(`add_header Report-To '${endpoints['Report-To']}' always;`);
  });

  it('Hostinger (.htaccess): the same three headers', () => {
    const h = read(HTACCESS);
    expect(/Header always set Content-Security-Policy "([^"]+)"/.exec(h)?.[1]).toBe(expected);
    const quoted = (v: string) => v.replace(/"/g, '\\"');
    expect(h).toContain(`Header always set Reporting-Endpoints "${quoted(endpoints['Reporting-Endpoints']!)}"`);
    expect(h).toContain(`Header always set Report-To "${quoted(endpoints['Report-To']!)}"`);
  });

  it('the report endpoint is the server’s, and the policy is the one before 1.22.4 plus the PDF preview’s blob: frames and reporting', () => {
    expect(CSP_REPORT_PATH).toBe('/api/v1/client-errors/csp');
    expect(expected).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' wss://task.mico360.com; frame-src 'self' blob: https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; report-uri /api/v1/client-errors/csp; report-to mico360-csp",
    );
  });

  it('the hidden source maps are never served by nginx or Hostinger either', () => {
    expect(read(NGINX_SITE)).toMatch(/location ~\* \\.map\$ \{\s*return 404;\s*\}/);
    expect(read(HTACCESS)).toContain('RedirectMatch 404 "\\.map$"');
  });
});
