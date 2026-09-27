// Expo config plugin: allow plain-http connections so the app can reach a self-hosted MICO360 Tasks
// server on the office network, which has no TLS certificate. The app itself only allows http to
// private addresses (src/lib/server-address.ts); every other server must use https.
const { withAndroidManifest } = require('expo/config-plugins');

/** Set android:usesCleartextTraffic on the <application> element of a parsed AndroidManifest. */
function applyLanCleartext(androidManifest) {
  const application = androidManifest.manifest.application && androidManifest.manifest.application[0];
  if (!application) throw new Error('AndroidManifest.xml has no <application> element');
  application.$ = { ...(application.$ || {}), 'android:usesCleartextTraffic': 'true' };
  return androidManifest;
}

function withLanCleartext(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = applyLanCleartext(cfg.modResults);
    return cfg;
  });
}

module.exports = withLanCleartext;
module.exports.applyLanCleartext = applyLanCleartext;
