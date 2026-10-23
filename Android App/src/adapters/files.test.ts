import { describe, it, expect, vi, beforeEach } from 'vitest';

// The phone's file system, as far as an export uses it (expo-file-system is native).
const fs = vi.hoisted(() => ({
  deleted: [] as string[],
  download: (): Promise<unknown> => Promise.resolve(undefined),
}));
vi.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: vi.fn(async () => undefined),
  readDirectoryAsync: vi.fn(async () => []),
  getInfoAsync: vi.fn(async () => ({ exists: false })),
  deleteAsync: vi.fn(async (uri: string) => void fs.deleted.push(uri)),
  moveAsync: vi.fn(async () => undefined),
  createDownloadResumable: vi.fn(() => ({ downloadAsync: () => fs.download(), cancelAsync: async () => undefined })),
}));
vi.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: async () => undefined }));

const { exportFiles } = await import('./files');

describe('an export’s download that fails part way leaves no file behind (final review A10)', () => {
  beforeEach(() => {
    fs.deleted.length = 0;
  });

  it('the connection dropping mid-download deletes what had arrived', async () => {
    fs.download = () => Promise.reject(new Error('connection reset'));
    await expect(exportFiles.download('https://x.test/api/v1/reports/export.xlsx', 'report.xlsx', {})).rejects.toThrow('connection reset');
    expect(fs.deleted).toContain('file:///cache/exports/report.xlsx');
  });

  it('a download stopped before it ended deletes it too', async () => {
    fs.download = () => Promise.resolve(undefined);
    await expect(exportFiles.download('https://x.test/api/v1/reports/export.pdf', 'report.pdf', {})).rejects.toThrow();
    expect(fs.deleted).toContain('file:///cache/exports/report.pdf');
  });

  it('a finished download is kept (the share sheet opens it)', async () => {
    fs.download = () => Promise.resolve({ status: 200, headers: {}, uri: 'file:///cache/exports/report.csv' });
    await expect(exportFiles.download('https://x.test/api/v1/reports/export.csv', 'report.csv', {})).resolves.toMatchObject({ uri: 'file:///cache/exports/report.csv' });
    expect(fs.deleted).not.toContain('file:///cache/exports/report.csv');
  });
});
