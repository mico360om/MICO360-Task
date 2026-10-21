// The web build carries the Chrome extension of the same release: zipped into dist/downloads, where
// the footer's "Chrome extension" link finds it (the server serves it at
// /downloads/MICO360-Tasks-Chrome-Extension.zip). Run after `vite build`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageExtension } from '../../../tools/release/extension-package.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const extension = path.resolve(here, '../../../Extension');
const zip = path.resolve(here, '../dist/downloads/MICO360-Tasks-Chrome-Extension.zip');

if (!fs.existsSync(path.join(extension, 'manifest.json'))) {
  console.log('No Extension folder here: the web build carries no Chrome extension.');
} else {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mico360-extension-'));
  try {
    const { version } = packageExtension(extension, stage, zip);
    console.log(`✔ Chrome extension ${version} → dist/downloads/${path.basename(zip)}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
