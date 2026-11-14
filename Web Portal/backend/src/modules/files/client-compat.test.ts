import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { createFileLinks } from './file-links';
import { createFileAccess } from './file-access';
import { registerUploads } from './file-route';

// 1.23.29 Private file links — the old-app compatibility proof (design §6, §9, §10 "Extension" and
// "Android"). The owner's rule (13 Nov): nothing under Android App/ or Extension/ changes, so these cases
// live here and use the apps' own helpers as they are: the extension's file-kind.js and chat signature,
// the current Android source's attachments.ts, and the signed 1.1.0 app's attachmentHref (copied word for
// word from `git show v1.1.0:"Android App/src/lib/attachments.ts"`, and checked against today's source).
// Each client turns the server's signed `url` into an address, and that address opens the file.

const ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const ANDROID_ATTACHMENTS = join(ROOT, 'Android App', 'src', 'lib', 'attachments.ts');
const EXTENSION_FILE_KIND = join(ROOT, 'Extension', 'src', 'file-kind.js');
const EXTENSION_MESSAGE = join(ROOT, 'Extension', 'app', 'chat', 'message.js');

// The signed Android app people have (1.1.0, built 17 Oct; the same in 1.0.1): attachmentHref, word for word.
const V110_ATTACHMENT_HREF = `export function attachmentHref(apiBase: string, url: string): string {
  if (/^https?:\\/\\//i.test(url)) return url;
  const origin = apiBase.replace(/\\/api\\/v\\d+\\/?$/, '').replace(/\\/+$/, '');
  return \`\${origin}\${url.startsWith('/') ? '' : '/'}\${url}\`;
}`;
function attachmentHrefV110(apiBase: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const origin = apiBase.replace(/\/api\/v\d+\/?$/, '').replace(/\/+$/, '');
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

type Android = { attachmentHref(apiBase: string, url: string): string; serverFileHref(apiBase: string, url: string | null | undefined): string | null };
type Extension = { isUploadPath(url: string): boolean; attachmentUrl(apiBase: string, url: string): string | null };
let android: Android;
let extension: Extension;
let messageSignature: (m: unknown) => string;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const KEY = '3f2b9c1e-8d4a-4b7e-9f10-2a6c5d7e8f90.png';
const OLD_KEY = '0b6f5f0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f.JPEG'; // v0.1.0 kept the uploader's own extension
const USER = { id: 'cmh3k2x9a0001qz8f7w6v5u4t', ver: 3 };
const dir = mkdtempSync(join(tmpdir(), 'pf-compat-'));
const links = createFileLinks({ secret: 'pf-compat-secret' });
let server: FastifyInstance;

beforeAll(async () => {
  android = (await import(pathToFileURL(ANDROID_ATTACHMENTS).href)) as Android;
  extension = (await import(pathToFileURL(EXTENSION_FILE_KIND).href)) as Extension;
  messageSignature = ((await import(pathToFileURL(EXTENSION_MESSAGE).href)) as { messageSignature: (m: unknown) => string }).messageSignature;
  for (const k of [KEY, OLD_KEY]) writeFileSync(join(dir, k), PNG);
  server = Fastify();
  const access = createFileAccess({ store: { async rowsOf() { return { taskIds: ['t1'], chats: [] }; }, async isPublicPicture() { return false; }, async taskIsLive() { return true; } }, canViewTask: async () => true, canSeeConversation: async () => true });
  await registerUploads(server, { root: dir, links, access, accountState: async (id) => (id === USER.id ? { tokenVersion: USER.ver, active: true, roles: ['EMPLOYEE'] } : null) });
  await server.ready();
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Ask the server for an address a client built (its path and query, as the phone's browser or <img> would). */
async function fetchAs(address: string | null): Promise<number> {
  if (!address) return 0;
  const u = new URL(address);
  return (await server.inject({ method: 'GET', url: `${u.pathname}${u.search}` })).statusCode;
}

const API_BASES = ['https://task.mico360.com/api/v1', 'http://192.168.1.20:4000/api/v1/', 'http://localhost:4000/api/v1'];

describe('today’s clients accept the signed link in the same `url` field, and the address they build opens the file', () => {
  it('the Android app people have (1.1.0): attachmentHref keeps the query, and the address opens', async () => {
    for (const api of API_BASES) {
      const url = links.sign(KEY, USER);
      const href = attachmentHrefV110(api, url);
      expect(href).toBe(`${api.replace(/\/api\/v1\/?$/, '')}${url}`);
      expect(await fetchAs(href)).toBe(200);
    }
  });

  it('the 1.1.0 copy above is today’s Android source word for word (the next build behaves the same)', () => {
    expect(readFileSync(ANDROID_ATTACHMENTS, 'utf8').replace(/\r\n/g, '\n')).toContain(V110_ATTACHMENT_HREF);
  });

  it('the current Android source: attachmentHref (task files) and serverFileHref (previews, chat) accept it', async () => {
    for (const api of API_BASES) {
      const url = links.sign(KEY, USER);
      const origin = api.replace(/\/api\/v1\/?$/, '');
      expect(android.attachmentHref(api, url)).toBe(`${origin}${url}`);
      expect(android.serverFileHref(api, url)).toBe(`${origin}${url}`);
      expect(await fetchAs(android.serverFileHref(api, url))).toBe(200);
    }
  });

  it('the extension: isUploadPath and attachmentUrl accept it (no dot pair, no backslash in what is added)', async () => {
    for (const api of API_BASES) {
      const url = links.sign(KEY, USER);
      expect(extension.isUploadPath(url)).toBe(true);
      const href = extension.attachmentUrl(api, url);
      expect(href).toBe(`${api.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}${url}`);
      expect(await fetchAs(href)).toBe(200);
    }
  });

  it('the website: origin + url (attachments.tsx, api/chat.ts fileUrl) — a server-relative path, never doubled', async () => {
    const url = links.sign(KEY, USER);
    expect(url.startsWith('/uploads/')).toBe(true);
    expect(await fetchAs(`https://task.mico360.com${url}`)).toBe(200);
  });

  it('an old v0.1.0 name (the uploader’s own extension) is signed and accepted the same way', async () => {
    const url = links.sign(OLD_KEY, USER);
    expect(extension.isUploadPath(url)).toBe(true);
    expect(await fetchAs(android.serverFileHref(API_BASES[0]!, url))).toBe(200);
    expect(await fetchAs(attachmentHrefV110(API_BASES[0]!, url))).toBe(200);
  });

  it('the extension doesn’t redraw a polled message within a 6-hour block (its signature stays the same)', () => {
    const block = Date.UTC(2026, 10, 13, 6);
    const at = (ms: number) => createFileLinks({ secret: 'pf-compat-secret', now: () => ms });
    const message = (url: string) => ({ body: 'drawing', editedAt: null, deletedAt: null, attachments: [{ id: 'a1', url }], reactions: [] });
    const first = messageSignature(message(at(block + 60_000).sign(KEY, USER)));
    expect(messageSignature(message(at(block + 5 * 3600_000).sign(KEY, USER)))).toBe(first);
    expect(messageSignature(message(at(block + 6 * 3600_000).sign(KEY, USER)))).not.toBe(first); // next block: once
  });
});
