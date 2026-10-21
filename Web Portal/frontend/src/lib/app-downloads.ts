/**
 * The Chrome extension this site hosts: every web build zips the extension of the same release into
 * its downloads/ (scripts/bundle-extension.mjs), served at one address that never changes. The
 * server says the same (backend lib/web-app.ts HOSTED_EXTENSION_PATH).
 */
export const HOSTED_EXTENSION_PATH = '/downloads/MICO360-Tasks-Chrome-Extension.zip';

/** How to install a zipped extension (it isn't in the Chrome Web Store). */
export const EXTENSION_INSTALL_HINT =
  'To install: unzip it, open chrome://extensions, turn on Developer mode, then choose Load unpacked and pick the unzipped folder.';
