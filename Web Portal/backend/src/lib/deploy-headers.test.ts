import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
