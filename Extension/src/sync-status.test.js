import { describe, it, expect } from 'vitest';
import { formatRelativeTime, connectionMeta, deriveConnectionState } from './sync-status.js';

const NOW = 1_000_000_000_000;

describe('formatRelativeTime', () => {
  it('shows "Never" when there is no sync yet', () => {
    expect(formatRelativeTime(null, NOW)).toBe('Never');
  });
  it('shows "Just now" under a minute', () => {
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe('Just now');
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe('Just now');
  });
  it('shows minutes', () => {
    expect(formatRelativeTime(NOW - 2 * 60_000, NOW)).toBe('2 min ago');
    expect(formatRelativeTime(NOW - 15 * 60_000, NOW)).toBe('15 min ago');
  });
  it('shows hours', () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe('1 hr ago');
    expect(formatRelativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe('3 hr ago');
  });
  it('shows days (singular/plural)', () => {
    expect(formatRelativeTime(NOW - 25 * 60 * 60_000, NOW)).toBe('1 day ago');
    expect(formatRelativeTime(NOW - 49 * 60 * 60_000, NOW)).toBe('2 days ago');
  });
});

describe('deriveConnectionState', () => {
  it('is offline when the device is offline (even mid-sync)', () => {
    expect(deriveConnectionState({ online: false, syncing: true, lastOk: true })).toBe('offline');
  });
  it('is syncing while online + a sync is in flight', () => {
    expect(deriveConnectionState({ online: true, syncing: true, lastOk: true })).toBe('syncing');
  });
  it('is error when online but the last attempt failed', () => {
    expect(deriveConnectionState({ online: true, syncing: false, lastOk: false })).toBe('error');
  });
  it('is connected otherwise', () => {
    expect(deriveConnectionState({ online: true, syncing: false, lastOk: true })).toBe('connected');
  });
});

describe('connectionMeta', () => {
  it('maps states to labels', () => {
    expect(connectionMeta('connected').label).toBe('Connected');
    expect(connectionMeta('syncing').label).toMatch(/sync/i);
    expect(connectionMeta('offline').label).toBe('Offline');
    expect(connectionMeta('error').label).toMatch(/error/i);
    expect(connectionMeta('bogus').label).toBe('Offline'); // safe fallback
  });
});
