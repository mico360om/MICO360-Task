import { describe, it, expect } from 'vitest';
import { keyCandidates, parseRestoreArgs, restoreTargetUrl } from './backup-cli';

describe('the backup key the restore tool tries', () => {
  it('trimmed first (as the server reads it), then exactly as written, without and with its line end', () => {
    expect(keyCandidates('  a long enough backup key  \n')).toEqual(['a long enough backup key', '  a long enough backup key  ', '  a long enough backup key  \n']);
    expect(keyCandidates('a long enough backup key\r\n')).toEqual(['a long enough backup key', 'a long enough backup key\r\n']);
    expect(keyCandidates('a long enough backup key')).toEqual(['a long enough backup key']);
    expect(keyCandidates('   \n')).toEqual([]);
    expect(keyCandidates(undefined)).toEqual([]);
    expect(keyCandidates('')).toEqual([]);
  });
});

describe('backup:restore arguments', () => {
  it('a copy into a named database, with its files into a folder', () => {
    expect(parseRestoreArgs(['copy.tar.gz', '--into', 'mico360_restored', '--files-into', '/home/u/uploads-restored'])).toEqual({
      file: 'copy.tar.gz',
      into: 'mico360_restored',
      filesInto: '/home/u/uploads-restored',
      noFiles: false,
      force: false,
      check: false,
      keyFile: null,
      envFile: null,
      url: null,
    });
  });

  it('every option', () => {
    expect(parseRestoreArgs(['c.tar.gz.enc', '--url', 'mysql://u:p@h:3306/x', '--no-files', '--force', '--key-file', 'k.txt', '--env-file', 'server.env'])).toMatchObject({
      file: 'c.tar.gz.enc',
      url: 'mysql://u:p@h:3306/x',
      noFiles: true,
      force: true,
      keyFile: 'k.txt',
      envFile: 'server.env',
    });
    expect(parseRestoreArgs(['c.tar.gz', '--check'])).toMatchObject({ file: 'c.tar.gz', check: true });
  });

  it('says what is missing, in plain words', () => {
    expect(() => parseRestoreArgs([])).toThrow(/Which backup file/);
    expect(() => parseRestoreArgs(['c.tar.gz'])).toThrow(/--into/);
    expect(() => parseRestoreArgs(['c.tar.gz', '--into', 'db'])).toThrow(/--files-into.*--no-files/);
    expect(() => parseRestoreArgs(['c.tar.gz', '--into'])).toThrow(/--into needs/);
    expect(() => parseRestoreArgs(['c.tar.gz', '--into', 'db', '--no-files', '--bogus'])).toThrow(/--bogus/);
  });

  it('the target: --url as given, else the server in DATABASE_URL with the database named by --into', () => {
    expect(restoreTargetUrl({ url: 'mysql://a:b@h:3306/x', into: null }, 'mysql://u:p@127.0.0.1:3306/live')).toBe('mysql://a:b@h:3306/x');
    expect(restoreTargetUrl({ url: null, into: 'mico360_restored' }, 'mysql://u:p%40ss@127.0.0.1:3306/live?connection_limit=5')).toBe('mysql://u:p%40ss@127.0.0.1:3306/mico360_restored?connection_limit=5');
    expect(() => restoreTargetUrl({ url: null, into: 'x' }, undefined)).toThrow(/DATABASE_URL/);
  });
});
