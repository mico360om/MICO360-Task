import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { isValidTimeZone, normalizeOnlineLink, onlineLinkField, timeZoneField } from './meeting-validation';

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects made-up ones', () => {
    expect(isValidTimeZone('Asia/Muscat')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Muscat')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('normalizeOnlineLink (MTG-08)', () => {
  it('adds https:// when no scheme was typed', () => {
    expect(normalizeOnlineLink('meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(normalizeOnlineLink('  zoom.us/j/123?pwd=x  ')).toBe('https://zoom.us/j/123?pwd=x');
    expect(normalizeOnlineLink('localhost:3000/room')).toBe('https://localhost:3000/room');
  });

  it('keeps http(s) links and turns a blank value into null', () => {
    expect(normalizeOnlineLink('https://teams.microsoft.com/l/meetup-join/x')).toBe('https://teams.microsoft.com/l/meetup-join/x');
    expect(normalizeOnlineLink('http://intranet.local/call')).toBe('http://intranet.local/call');
    expect(normalizeOnlineLink('   ')).toBeNull();
  });

  it('rejects script, data and other non-web schemes, and malformed links', () => {
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'mailto:a@b.co', 'ftp://files.example.com', 'https://', 'meet google com']) {
      expect(() => normalizeOnlineLink(bad), bad).toThrow();
    }
  });

  it('plugs into zod schemas as nullable/optional fields', () => {
    const schema = z.object({ onlineLink: onlineLinkField, timeZone: timeZoneField });
    expect(schema.parse({ onlineLink: 'meet.google.com/x', timeZone: 'Asia/Muscat' })).toEqual({ onlineLink: 'https://meet.google.com/x', timeZone: 'Asia/Muscat' });
    expect(schema.parse({ onlineLink: null, timeZone: null })).toEqual({ onlineLink: null, timeZone: null });
    expect(schema.parse({})).toEqual({});
    expect(schema.safeParse({ onlineLink: 'javascript:alert(1)' }).success).toBe(false);
    expect(schema.safeParse({ timeZone: 'Muscat' }).success).toBe(false);
  });
});
