import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { apkVersionName, createHostedApkVersion, manifestVersionName } from './apk-version';

/** The binary AndroidManifest.xml of the real 1.3.2 build (as Android packs it). */
const MANIFEST = readFileSync(join(__dirname, '__fixtures__', 'AndroidManifest-1.3.2.bin'));

/** A ZIP (an APK is one) with these entries, stored or deflated as asked. */
function zipOf(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(e.data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(e.data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('manifestVersionName — the version written in an Android app', () => {
  it('reads versionName from the binary manifest of a real build', () => {
    expect(manifestVersionName(MANIFEST)).toBe('1.3.2');
  });
  it('anything else: null', () => {
    expect(manifestVersionName(Buffer.from('<manifest android:versionName="9.9.9"/>'))).toBeNull();
    expect(manifestVersionName(Buffer.alloc(0))).toBeNull();
    expect(manifestVersionName(MANIFEST.subarray(0, 200))).toBeNull();
  });
});

describe('apkVersionName — from the app file itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apk-version-'));
  const write = (name: string, data: Buffer) => {
    const file = join(dir, name);
    writeFileSync(file, data);
    return file;
  };

  it('finds the manifest among the other files, compressed or not', () => {
    const other = { name: 'classes.dex', data: Buffer.alloc(5000, 7), deflate: true };
    expect(apkVersionName(write('a.apk', zipOf([other, { name: 'AndroidManifest.xml', data: MANIFEST, deflate: true }])))).toBe('1.3.2');
    expect(apkVersionName(write('b.apk', zipOf([{ name: 'AndroidManifest.xml', data: MANIFEST }, other])))).toBe('1.3.2');
  });

  it('a file that isn’t an app, has no manifest, or doesn’t exist: null', () => {
    expect(apkVersionName(write('c.apk', Buffer.from('not a zip at all')))).toBeNull();
    expect(apkVersionName(write('d.apk', zipOf([{ name: 'README.txt', data: Buffer.from('hi') }])))).toBeNull();
    expect(apkVersionName(join(dir, 'missing.apk'))).toBeNull();
  });

  it.skipIf(!existsSync('D:/mico-apk-build/android/app/build/outputs/apk/release/app-release.apk'))('reads a whole real APK (local build)', () => {
    expect(apkVersionName('D:/mico-apk-build/android/app/build/outputs/apk/release/app-release.apk')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('createHostedApkVersion: the first app file that exists, read again only when it is replaced', () => {
    const hosted = join(dir, 'MICO360-Tasks.apk');
    const fallback = write('fallback.apk', zipOf([{ name: 'AndroidManifest.xml', data: MANIFEST, deflate: true }]));
    const version = createHostedApkVersion([join(dir, 'none.apk'), hosted, fallback]);
    expect(version()).toBe('1.3.2'); // only the fallback exists yet
    writeFileSync(hosted, 'not an app');
    const later = new Date(Date.now() + 5000);
    utimesSync(hosted, later, later);
    expect(version()).toBeNull(); // the first file that exists is the one served: unreadable → unknown
    rmSync(dir, { recursive: true, force: true });
    expect(version()).toBeNull();
  });
});
