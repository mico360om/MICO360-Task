#!/usr/bin/env node
/**
 * Builds the MICO360 Tasks release packages into ./Installer, one folder per place it installs:
 *
 *   1-Hostinger-Web-Server/MICO360-Tasks-Server-Hostinger-<v>.zip   Linux/Hostinger deploy package
 *                                             (backend source for deploy.sh + the built web app).
 *   2-Windows-Office-Server/MICO360-Tasks-Server-Setup-<v>.exe      Windows installer: self-contained
 *                                             server (Node.js, MySQL, API, web app) with a tray launcher.
 *   3-Android-App/MICO360-Tasks-<v>.apk       (built by tools/release/build-apk.sh)
 *   4-Chrome-Extension/MICO360-Tasks-Chrome-Extension-<v>.zip       Chrome Web Store / "Load unpacked".
 *
 * Each folder's README.md (tracked) is its step-by-step guide.
 *
 * Usage (Windows, from the repo root):  node tools/release/build-release.mjs [web] [lock] [windows] [extension] [hostinger] [checksums]
 * No arguments = all of them (`lock` refreshes Web Portal/backend/package-lock.json). Needs: Node 20+, the .NET SDK (for its C# compiler; the programs
 * target the .NET Framework 4.x built into Windows) and a MySQL 8.0 "ZIP archive" for Windows
 * (MYSQL_HOME, default D:/mico-mysql/mysql-8.0.46-winx64). Staging happens in RELEASE_STAGE_DIR
 * (default %TEMP%/mico360-release), outside the synced project folder.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'Installer');
/** One folder per environment the release installs into (each has its own README.md guide). */
const TARGET = {
  hostinger: path.join(OUT, '1-Hostinger-Web-Server'),
  windows: path.join(OUT, '2-Windows-Office-Server'),
  android: path.join(OUT, '3-Android-App'),
  extension: path.join(OUT, '4-Chrome-Extension'),
};
const STAGE = path.resolve(process.env.RELEASE_STAGE_DIR || path.join(os.tmpdir(), 'mico360-release'));
const MYSQL_HOME = process.env.MYSQL_HOME || 'D:/mico-mysql/mysql-8.0.46-winx64';
const BACKEND = path.join(ROOT, 'Web Portal', 'backend');
const FRONTEND = path.join(ROOT, 'Web Portal', 'frontend');
const EXTENSION = path.join(ROOT, 'Extension');
const WIN_SRC = path.join(ROOT, 'tools', 'release', 'windows');
const VERSION = readJson(path.join(ROOT, 'package.json')).version;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function log(message) {
  console.log(`\n▶ ${message}`);
}

function run(cmd, args, opts = {}) {
  const shell = /^(npm|npx)$/.test(cmd); // .cmd shims need a shell on Windows
  const res = spawnSync(shell ? [cmd, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' ') : cmd, shell ? [] : args, {
    stdio: 'inherit',
    shell,
    ...opts,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${res.status})`);
}

function clean(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copy(src, dst, filter = () => true) {
  fs.cpSync(src, dst, { recursive: true, filter: (s) => filter(s.replace(/\\/g, '/')) });
}

function powershell(script) {
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
}

/**
 * Zip a folder's contents: a plain deflate zip with forward-slash entry names, as the Chrome Web
 * Store and Linux unzip require (PowerShell's ZipFile writes "backend\src\app.ts", and Windows'
 * tar.exe crashes on large trees). Files are sorted, so the same input gives the same archive.
 */
function zipDir(srcDir, zipFile) {
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

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sizeMb(file) {
  return (fs.statSync(file).size / 1024 / 1024).toFixed(1);
}

// ------------------------------------------------------------------ web app + API build

function buildWeb() {
  log('Building the web app and the API');
  run('npm', ['run', 'build', '--workspace', '@mico360/frontend'], { cwd: ROOT });
  run('npm', ['run', 'build', '--workspace', '@mico360/backend'], { cwd: ROOT });
  for (const f of [path.join(FRONTEND, 'dist', 'index.html'), path.join(FRONTEND, 'dist', '.well-known', 'assetlinks.json'), path.join(BACKEND, 'dist', 'src', 'server.js')]) {
    if (!fs.existsSync(f)) throw new Error(`Build output missing: ${f}`);
  }
}

/** A copy of the monorepo's manifests (root + workspaces + lockfile) for installing exact, tested versions. */
function monorepoManifests(dir) {
  clean(dir);
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(dir, 'package-lock.json'));
  for (const ws of readJson(path.join(ROOT, 'package.json')).workspaces) {
    fs.mkdirSync(path.join(dir, ws), { recursive: true });
    fs.copyFileSync(path.join(ROOT, ws, 'package.json'), path.join(dir, ws, 'package.json'));
  }
}

/** Install the backend's dependencies at the versions in the root lockfile (no install scripts). */
function installBackendDeps(dir, { dev }) {
  monorepoManifests(dir);
  run('npm', ['ci', '--workspace', '@mico360/backend', dev ? '--include=dev' : '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir });
  const nm = path.join(dir, 'node_modules');
  fs.rmSync(path.join(nm, '@mico360'), { recursive: true, force: true }); // workspace links
  fs.rmSync(path.join(nm, '.bin'), { recursive: true, force: true });
  return nm;
}

// ------------------------------------------------------------------ Windows installer

function findCsc() {
  const sdkRoot = 'C:/Program Files/dotnet/sdk';
  const sdks = fs.existsSync(sdkRoot) ? fs.readdirSync(sdkRoot).filter((d) => /^\d+\./.test(d)) : [];
  sdks.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of sdks) {
    const csc = path.join(sdkRoot, v, 'Roslyn', 'bincore', 'csc.dll');
    if (fs.existsSync(csc)) return csc;
  }
  throw new Error('The .NET SDK C# compiler (Roslyn csc.dll) was not found. Install the .NET SDK.');
}

function compile(out, sources, { resources = [], stage }) {
  const fw = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319';
  const refs = ['mscorlib', 'System', 'System.Core', 'System.Drawing', 'System.Windows.Forms', 'System.IO.Compression', 'System.IO.Compression.FileSystem'];
  run('dotnet', [
    findCsc(),
    '-nologo', '-nostdlib', '-noconfig', '-target:winexe', '-langversion:latest', '-optimize+', '-warnaserror-', '-nowarn:1701,1702',
    `-out:${out}`,
    `-win32manifest:${path.join(WIN_SRC, 'app.manifest')}`,
    `-win32icon:${path.join(stage, 'app.ico')}`,
    ...refs.map((r) => `-r:${fw}/${r}.dll`),
    ...resources.map(([file, name]) => `-resource:${file},${name}`),
    path.join(stage, 'AssemblyInfo.cs'),
    ...sources,
  ]);
}

/**
 * Scan a built program with the antivirus on this machine (Kaspersky's command-line scanner, when
 * installed) and stop the build if it is flagged. The programs are unsigned, so heuristic scanners can
 * mistake them for malware (seen: VHO:Trojan.Win32.Sdum.gen on one build of the launcher) — a flagged
 * file must never ship. Fix by code-signing the programs and reporting the false positive.
 */
function antivirusCheck(file) {
  const roots = ['C:/Program Files (x86)/Kaspersky Lab', 'C:/Program Files/Kaspersky Lab'];
  const avp = roots
    .filter((r) => fs.existsSync(r))
    .flatMap((r) => fs.readdirSync(r).map((d) => path.join(r, d, 'avp.com')))
    .find((f) => fs.existsSync(f));
  if (!avp) return;
  const res = spawnSync(avp, ['SCAN', file, '/i0'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const hit = /(suspicion|detected)\s+(\S+)/.exec(res.stdout ?? '');
  if (hit) {
    throw new Error(`${path.basename(file)} is flagged by Kaspersky as ${hit[2]} — do not ship it. This program is a false positive for heuristic scanners; code-sign the build and report the false positive to Kaspersky, then rebuild.`);
  }
  if (!/Total OK:\s+[1-9]/.test(res.stdout ?? '')) throw new Error(`Kaspersky could not scan ${path.basename(file)}:
${(res.stdout ?? '').slice(-600)}`);
  console.log(`  antivirus check (Kaspersky): ${path.basename(file)} is clean`);
}

/** Multi-size .ico (16–256 px, PNG-compressed) from the square app icon, via System.Drawing. */
function makeIcon(pngFile, icoFile) {
  powershell(`
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${pngFile}')
$sizes = 16,24,32,48,64,128,256
$images = foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
  $g.DrawImage($src, 0, 0, $s, $s); $g.Dispose()
  $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  ,$ms.ToArray()
}
$fs = [System.IO.File]::Create('${icoFile}')
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $d = $images[$i]
  $w.Write([byte]($s % 256)); $w.Write([byte]($s % 256)); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$d.Length); $w.Write([UInt32]$offset)
  $offset += $d.Length
}
foreach ($d in $images) { $w.Write($d) }
$w.Close(); $src.Dispose()
`);
}

function buildWindows() {
  log('Building the Windows installer');
  const stage = path.join(STAGE, 'windows');
  const payload = path.join(stage, 'payload');
  clean(stage);
  fs.mkdirSync(payload, { recursive: true });
  const licenses = path.join(payload, 'licenses');
  fs.mkdirSync(licenses);

  // Node.js runtime (the official Windows build links its C runtime statically).
  fs.mkdirSync(path.join(payload, 'node'));
  fs.copyFileSync(process.execPath, path.join(payload, 'node', 'node.exe'));
  const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE');
  if (fs.existsSync(nodeLicense)) fs.copyFileSync(nodeLicense, path.join(licenses, 'Node.js-LICENSE.txt'));

  // MySQL server + the client tools the launcher uses; debug symbols and test tools are left out.
  const mysqlBin = path.join(MYSQL_HOME, 'bin');
  if (!fs.existsSync(path.join(mysqlBin, 'mysqld.exe'))) throw new Error(`MySQL not found at ${MYSQL_HOME} (set MYSQL_HOME)`);
  const binOut = path.join(payload, 'mysql', 'bin');
  fs.mkdirSync(binOut, { recursive: true });
  for (const f of fs.readdirSync(mysqlBin)) {
    const keep = ['mysqld.exe', 'mysql.exe', 'mysqladmin.exe', 'mysqldump.exe'].includes(f) || (f.endsWith('.dll') && !/-debug\.dll$/i.test(f));
    if (keep) fs.copyFileSync(path.join(mysqlBin, f), path.join(binOut, f));
  }
  copy(path.join(MYSQL_HOME, 'share'), path.join(payload, 'mysql', 'share'));
  fs.copyFileSync(path.join(MYSQL_HOME, 'LICENSE'), path.join(licenses, 'MySQL-LICENSE.txt'));
  // MySQL needs the Microsoft C++ runtime; ship it next to mysqld (app-local) so no separate install is needed.
  for (const dll of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']) {
    fs.copyFileSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', dll), path.join(binOut, dll));
  }

  // The API: compiled code, schema + migrations, brand assets and production dependencies.
  const backendOut = path.join(payload, 'app', 'backend');
  fs.mkdirSync(backendOut, { recursive: true });
  fs.copyFileSync(path.join(BACKEND, 'package.json'), path.join(backendOut, 'package.json'));
  copy(path.join(BACKEND, 'dist', 'src'), path.join(backendOut, 'dist', 'src'), (f) => !/\.(test\.js|d\.ts|js\.map)$/.test(f) && !/\/dist\/src\/tests?\//.test(f));
  fs.mkdirSync(path.join(backendOut, 'prisma'));
  fs.copyFileSync(path.join(BACKEND, 'prisma', 'schema.prisma'), path.join(backendOut, 'prisma', 'schema.prisma'));
  copy(path.join(BACKEND, 'prisma', 'migrations'), path.join(backendOut, 'prisma', 'migrations'));
  copy(path.join(BACKEND, 'assets'), path.join(backendOut, 'assets'));

  log('Installing production dependencies (exact versions from package-lock.json)');
  const nm = installBackendDeps(path.join(STAGE, 'npm-prod'), { dev: false });
  fs.renameSync(nm, path.join(backendOut, 'node_modules'));
  // The Prisma CLI (a dev dependency) applies migrations on start; take it from the tested install.
  const rootNm = path.join(ROOT, 'node_modules');
  for (const pkg of ['prisma', '@prisma/engines', '@prisma/engines-version', '@prisma/debug', '@prisma/fetch-engine', '@prisma/get-platform']) {
    const dst = path.join(backendOut, 'node_modules', pkg);
    if (!fs.existsSync(dst)) copy(path.join(rootNm, pkg), dst, (f) => !/\.tmp\d*$/.test(f));
  }
  log('Generating the Prisma client for MySQL on Windows');
  run(process.execPath, [path.join(backendOut, 'node_modules', 'prisma', 'build', 'index.js'), 'generate', '--schema', path.join(backendOut, 'prisma', 'schema.prisma')], {
    cwd: backendOut,
    env: { CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });

  // The web app, served by the API itself (WEB_ROOT).
  copy(path.join(FRONTEND, 'dist'), path.join(payload, 'app', 'web'));
  // The Android app, so staff can install it from the office server ("Download for Android" on the
  // sign-in page finds it at /downloads/MICO360-Tasks.apk). Build it first with build-apk.sh.
  const apk = path.join(TARGET.android, `MICO360-Tasks-${readJson(path.join(ROOT, 'Android App', 'app.json')).expo.version}.apk`);
  if (fs.existsSync(apk)) {
    fs.mkdirSync(path.join(payload, 'app', 'web', 'downloads'), { recursive: true });
    fs.copyFileSync(apk, path.join(payload, 'app', 'web', 'downloads', 'MICO360-Tasks.apk'));
  } else {
    console.warn(`! ${path.relative(ROOT, apk)} not found — the installer will not include the Android app (run build-apk.sh first).`);
  }

  // Launcher + uninstaller.
  makeIcon(path.join(ROOT, 'Android App', 'assets', 'icon.png'), path.join(stage, 'app.ico'));
  fs.writeFileSync(
    path.join(stage, 'AssemblyInfo.cs'),
    `using System.Reflection;
[assembly: AssemblyTitle("MICO360 Tasks Server")]
[assembly: AssemblyProduct("MICO360 Tasks Server")]
[assembly: AssemblyCompany("MICO360")]
[assembly: AssemblyCopyright("© ${new Date().getFullYear()} MICO360")]
[assembly: AssemblyVersion("${VERSION}.0")]
[assembly: AssemblyFileVersion("${VERSION}.0")]
[assembly: AssemblyInformationalVersion("${VERSION}")]
`,
  );
  const shared = fs.readdirSync(path.join(WIN_SRC, 'Shared')).map((f) => path.join(WIN_SRC, 'Shared', f));
  const logoW = path.join(BACKEND, 'assets', 'logo-w.png');
  // Each program's own source first, then the shared code.
  compile(path.join(payload, 'MICO360 Tasks Server.exe'), [path.join(WIN_SRC, 'Launcher', 'Program.cs'), ...shared], { stage, resources: [[logoW, 'logo-w.png']] });
  compile(path.join(payload, 'Uninstall.exe'), [path.join(WIN_SRC, 'Uninstall', 'Program.cs'), ...shared], { stage, resources: [[logoW, 'logo-w.png']] });
  antivirusCheck(path.join(payload, 'MICO360 Tasks Server.exe'));
  antivirusCheck(path.join(payload, 'Uninstall.exe'));
  fs.writeFileSync(
    path.join(payload, 'README.txt'),
    `MICO360 Tasks Server ${VERSION} for Windows
===========================================

Start:      Start menu → "MICO360 Tasks Server" (opens http://localhost:<port> in your browser).
Tray icon:  open the app, see the office-network address, back up the database, edit settings,
            restart, or stop the server.
Data:       database, uploaded files, backups, logs and settings (config\\server.env) live in the
            data folder chosen during setup (default %LOCALAPPDATA%\\MICO360 Tasks Server).
Phones:     in the MICO360 Tasks app, tap "Server: … · Change" on the sign-in screen and enter this
            computer's office-network address (tray icon → Office network address…).
Extension:  in the Chrome extension's sign-in screen choose "Advanced: change server" and enter
            http://localhost:<port> (or the office-network address).
Email:      add Mailjet keys to config\\server.env to turn on sign-in codes and password-reset emails.
Uninstall:  Windows Settings → Apps, or Start menu → "Uninstall MICO360 Tasks Server".
            Your data folder is kept unless you choose to delete it.

Included third-party software: Node.js (MIT), MySQL Community Server 8.0 (GPLv2) and the
Microsoft Visual C++ runtime — licenses in the "licenses" folder.
`,
  );
  fs.writeFileSync(
    path.join(licenses, 'Microsoft-VC-Runtime.txt'),
    'msvcp140.dll, vcruntime140.dll and vcruntime140_1.dll are redistributable files of the Microsoft Visual C++ Redistributable, deployed app-locally next to MySQL.\n',
  );

  log('Packing the installer payload');
  const payloadZip = path.join(stage, 'payload.zip');
  zipDir(payload, payloadZip);
  console.log(`payload.zip: ${sizeMb(payloadZip)} MB`);

  fs.mkdirSync(TARGET.windows, { recursive: true });
  const setupExe = path.join(TARGET.windows, `MICO360-Tasks-Server-Setup-${VERSION}.exe`);
  compile(setupExe, [path.join(WIN_SRC, 'Setup', 'Program.cs'), ...shared], {
    stage,
    resources: [[payloadZip, 'payload.zip'], [logoW, 'logo-w.png']],
  });
  antivirusCheck(setupExe);
  console.log(`✔ ${path.relative(ROOT, setupExe)} (${sizeMb(setupExe)} MB)`);
}

// ------------------------------------------------------------------ Chrome extension

function buildExtension() {
  log('Packaging the Chrome extension');
  const manifest = readJson(path.join(EXTENSION, 'manifest.json'));
  const stage = path.join(STAGE, 'extension');
  clean(stage);
  fs.copyFileSync(path.join(EXTENSION, 'manifest.json'), path.join(stage, 'manifest.json'));
  for (const dir of ['app', 'background', 'icons', 'src']) {
    copy(path.join(EXTENSION, dir), path.join(stage, dir), (f) => !/\.test\.js$|\/test-helpers\.js$/.test(f));
  }
  // Every relative import must resolve inside the package (tests and helpers are left out).
  const files = fs.readdirSync(stage, { recursive: true }).map(String).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const text = fs.readFileSync(path.join(stage, f), 'utf8');
    for (const m of text.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(path.join(stage, f)), m[1]);
      if (!fs.existsSync(target)) throw new Error(`${f} imports ${m[1]}, which is not in the package`);
    }
  }
  for (const icon of Object.values(manifest.icons)) {
    if (!fs.existsSync(path.join(stage, icon))) throw new Error(`Missing icon ${icon}`);
  }
  if (!fs.existsSync(path.join(stage, manifest.background.service_worker))) throw new Error('Missing service worker');
  fs.mkdirSync(TARGET.extension, { recursive: true });
  const zip = path.join(TARGET.extension, `MICO360-Tasks-Chrome-Extension-${manifest.version}.zip`);
  zipDir(stage, zip);
  console.log(`✔ ${path.relative(ROOT, zip)} (${files.length} scripts, ${sizeMb(zip)} MB)`);
}

// ------------------------------------------------------------------ backend lockfile

/**
 * Web Portal/backend/package-lock.json, for deploying the backend on its own (deploy.sh → npm ci).
 * It pins the versions the monorepo lockfile tested: install the backend's dependencies from the
 * root lock, then let npm record that exact tree. CI checks it still matches package.json.
 */
function writeBackendLock() {
  log('Writing Web Portal/backend/package-lock.json from the tested dependency versions');
  const nm = installBackendDeps(path.join(STAGE, 'npm-dev'), { dev: true });
  const lockDir = path.join(STAGE, 'lockgen');
  clean(lockDir);
  fs.copyFileSync(path.join(BACKEND, 'package.json'), path.join(lockDir, 'package.json'));
  fs.renameSync(nm, path.join(lockDir, 'node_modules'));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: lockDir });
  fs.copyFileSync(path.join(lockDir, 'package-lock.json'), path.join(BACKEND, 'package-lock.json'));
}

// ------------------------------------------------------------------ Hostinger / Linux package

function buildHostinger() {
  log('Packaging the Hostinger (Linux) server');
  const name = `MICO360-Tasks-Server-Hostinger-${VERSION}`;
  const stage = path.join(STAGE, 'hostinger');
  const pkg = path.join(stage, name);
  clean(stage);
  // Never shipped: installed/built output, local secrets, and the demo seed (it wipes the database
  // and creates test accounts — development only).
  const skip = /\/(node_modules|dist|uploads|coverage|\.vite|\.turbo)(\/|$)|\/\.env(?!\.example$)[^/]*$|\.log$|tsconfig\.tsbuildinfo$|\/prisma\/seed\.ts$/;
  copy(BACKEND, path.join(pkg, 'backend'), (f) => !skip.test(f.slice(BACKEND.replace(/\\/g, '/').length)));
  copy(path.join(FRONTEND, 'dist'), path.join(pkg, 'public_html'));
  copy(path.join(ROOT, 'deploy'), path.join(pkg, 'deploy'));
  fs.mkdirSync(path.join(pkg, 'docs'));
  for (const doc of ['DEPLOY-HOSTINGER.md', 'DEPLOYMENT.md', 'EMAIL.md']) fs.copyFileSync(path.join(ROOT, 'docs', doc), path.join(pkg, 'docs', doc));

  // The backend's standalone lockfile (deploy.sh runs `npm ci` with it) — refreshed from the tested
  // monorepo lockfile, then shipped with the backend source.
  writeBackendLock();
  fs.copyFileSync(path.join(BACKEND, 'package-lock.json'), path.join(pkg, 'backend', 'package-lock.json'));

  fs.writeFileSync(
    path.join(pkg, 'README.txt'),
    `MICO360 Tasks ${VERSION} — server package for Hostinger (or any Linux host with Node.js 20+ and MySQL 8)
==========================================================================================

backend/      The API. Upload it as the Node.js app. Put the live settings file (environment.txt, kept
              beside this package in Installer/1-Hostinger-Web-Server) into it as ".env", then from its
              folder run:
                DB_NAME='…' DB_USER='…' DB_PASSWORD='…' ADMIN_PASSWORD='…' bash deploy.sh
              It installs, builds, creates or updates the tables, and creates the one administrator
              (khurram@prolens-team.com unless ADMIN_EMAIL says otherwise). The database starts empty:
              no test users or demo data. See docs/DEPLOY-HOSTINGER.md.
public_html/  The web app. Upload its contents (including .well-known/) to the site's web root.
              Merge deploy/hostinger/htaccess-security-headers.txt into the existing .htaccess.
              To offer the phone app from the site, upload the APK as public_html/downloads/MICO360-Tasks.apk
              and set ANDROID_APP_URL=/downloads/MICO360-Tasks.apk (otherwise "Download for Android" on the
              sign-in page opens the GitHub releases page).
deploy/       Reference nginx config and security headers.
docs/         Deployment, email and Hostinger runbooks.

The settings file already has TRUST_PROXY=loopback, the JWT secrets, SECRETS_ENCRYPTION_KEY and
MAILJET_WEBHOOK_TOKEN. Still to add before email works: the rotated Mailjet keys
(docs/DEPLOY-HOSTINGER.md lists every setting).

Then add an hPanel cron job, every 15 minutes, so recurring tasks, reminders and the nightly
carry-forward keep running even when nobody has the site open (Hostinger may stop an idle app):
  curl -fsS -o /dev/null https://task.mico360.com/api/v1/health
`,
  );
  if (fs.existsSync(path.join(pkg, 'backend', 'prisma', 'seed.ts'))) throw new Error('The demo seed must not be in the server package');
  fs.mkdirSync(TARGET.hostinger, { recursive: true });
  const zip = path.join(TARGET.hostinger, `${name}.zip`);
  zipDir(stage, zip);
  console.log(`✔ ${path.relative(ROOT, zip)} (${sizeMb(zip)} MB)`);
}

// ------------------------------------------------------------------ checksums

function writeChecksums() {
  // Every package in the environment folders, as folder/file (what `sha256sum -c` expects).
  const files = Object.values(TARGET)
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => fs.readdirSync(dir).filter((f) => /\.(exe|zip|apk)$/i.test(f)).map((f) => `${path.basename(dir)}/${f}`))
    .sort();
  const lines = files.map((f) => `${sha256(path.join(OUT, f))}  ${f}`);
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  log('Checksums');
  console.log(lines.join('\n'));
}

const steps = { web: buildWeb, lock: writeBackendLock, windows: buildWindows, extension: buildExtension, hostinger: buildHostinger, checksums: writeChecksums };
const wanted = process.argv.slice(2);
const order = wanted.length ? wanted : Object.keys(steps);
for (const s of order) {
  if (!steps[s]) throw new Error(`Unknown step "${s}". Steps: ${Object.keys(steps).join(', ')}`);
}
console.log(`MICO360 Tasks ${VERSION} release build → ${OUT}\nstaging in ${STAGE}`);
for (const s of order) steps[s]();
