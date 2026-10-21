import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WEBSITE_ONLY_PAGES, websiteLinkLabel, websiteOpenFailed, websitePageUrl } from './website';

describe('Open on the website (6b): the admin pages the app doesn’t have', () => {
  it('lists AI Management, System Settings and Audit Logs, as the website’s Admin menu', () => {
    expect(WEBSITE_ONLY_PAGES.map((p) => [p.label, p.path])).toEqual([
      ['AI Management', '/admin/ai'],
      ['System Settings', '/admin/settings'],
      ['Audit Logs', '/admin/audit'],
    ]);
  });

  it('opens the page on the website of the server the app is connected to', () => {
    expect(websitePageUrl('https://task.mico360.com/api/v1', '/admin/ai')).toBe('https://task.mico360.com/admin/ai');
    expect(websitePageUrl('https://tasks.example.com/api/v1/', '/admin/audit')).toBe('https://tasks.example.com/admin/audit');
    // A site served under a folder keeps it.
    expect(websitePageUrl('https://example.com/mico/api/v1', '/admin/settings')).toBe('https://example.com/mico/admin/settings');
    // An office server on the local network, as every request may use.
    expect(websitePageUrl('http://192.168.1.20:4000/api/v1', '/admin/ai')).toBe('http://192.168.1.20:4000/admin/ai');
  });

  it('opens only its own known pages: never another address, another site or a script', () => {
    for (const path of ['https://evil.example/admin/ai', '//evil.example/admin/ai', 'javascript:alert(1)', '/admin/ai/../../x', '/admin/users', '/admin/ai?next=https://evil.example', '']) {
      expect(websitePageUrl('https://task.mico360.com/api/v1', path), path).toBeNull();
    }
  });

  it('never opens plain http on the internet, or a server address that isn’t one', () => {
    expect(websitePageUrl('http://task.mico360.com/api/v1', '/admin/ai')).toBeNull();
    expect(websitePageUrl('not a url', '/admin/ai')).toBeNull();
    expect(websitePageUrl('https://user:pw@task.mico360.com/api/v1', '/admin/ai')).toBeNull();
  });

  it('tells TalkBack it leaves the app, and gives the address when no browser opens it', () => {
    expect(websiteLinkLabel('AI Management')).toBe('AI Management, opens on the website');
    expect(websiteOpenFailed('https://task.mico360.com/admin/ai')).toEqual({
      title: 'Couldn’t open the website',
      message: 'Open this address in your browser:\nhttps://task.mico360.com/admin/ai',
    });
  });
});

const sidebar = resolve(__dirname, '../../../Web Portal/frontend/src/components/Sidebar.tsx');
describe.skipIf(!existsSync(sidebar))('the same pages as the website’s Admin menu', () => {
  it('names and addresses', () => {
    const source = readFileSync(sidebar, 'utf8');
    for (const p of WEBSITE_ONLY_PAGES) expect(source).toContain(`{ label: '${p.label}', to: '${p.path}'`);
  });
});
