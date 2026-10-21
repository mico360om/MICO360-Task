// The zip writer shared by the release packages and the web build (no npm packages needed).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Zip a folder's contents: a plain deflate zip with forward-slash entry names, as the Chrome Web
 * Store and Linux unzip require (PowerShell's ZipFile writes "backend\src\app.ts", and Windows'
 * tar.exe crashes on large trees). Files are sorted, so the same input gives the same archive.
 */
export function zipDir(srcDir, zipFile) {
  const files = fs
    .readdirSync(srcDir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(srcDir, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
    .sort();
  if (files.length > 0xffff) throw new Error(`${zipFile}: too many files for a zip without ZIP64`);
  fs.rmSync(zipFile, { force: true });
  const fd = fs.openSync(zipFile, 'w');
  const central = [];
  let offset = 0;
  const write = (buf) => {
    fs.writeSync(fd, buf);
    offset += buf.length;
  };
  for (const rel of files) {
    const full = path.join(srcDir, rel);
    const data = fs.readFileSync(full);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = zlib.crc32(data);
    const m = fs.statSync(full).mtime;
    const time = (m.getHours() << 11) | (m.getMinutes() << 5) | (m.getSeconds() >> 1);
    const date = ((Math.max(m.getFullYear(), 1980) - 1980) << 9) | ((m.getMonth() + 1) << 5) | m.getDate();
    const name = Buffer.from(rel, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // made by: DOS / FAT attributes
    header.writeUInt16LE(20, 6);
    local.copy(header, 8, 6, 30); // flags … name length
    header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, name]));
    write(local);
    write(name);
    write(body);
    if (offset > 0xffffffff) throw new Error(`${zipFile}: larger than 4 GB`);
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  write(cd);
  write(end);
  fs.closeSync(fd);
}
