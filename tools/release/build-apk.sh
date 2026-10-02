#!/usr/bin/env bash
# Builds the signed production APK into ./Installer/3-Android-App (Windows + Git Bash, Android SDK, JDK 17).
#
#   MICO360_KEYSTORE_PASSWORD='…' bash tools/release/build-apk.sh
#
# Uses the release keystore kept (git-ignored) at "Android App/apk/release.keystore", so the APK
# installs as an update over earlier versions. The build runs in APK_BUILD_DIR (default
# D:/mico-apk-build, outside the synced project folder) from a fresh `expo prebuild --clean`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/Android App"
BUILD="${APK_BUILD_DIR:-/d/mico-apk-build}"
SDK="${ANDROID_HOME:-C:/Users/$USERNAME/AppData/Local/Android/Sdk}"
KEYSTORE="${MICO360_KEYSTORE:-$APP/apk/release.keystore}"
: "${MICO360_KEYSTORE_PASSWORD:?Set MICO360_KEYSTORE_PASSWORD to the release keystore password}"
win() { cygpath -m "$1"; }   # native Windows programs need C:/… paths (MSYS path conversion is off)
VERSION="$(node -p "require(process.argv[1]).expo.version" "$(win "$APP/app.json")")"
OUT="$ROOT/Installer/3-Android-App/MICO360-Tasks-$VERSION.apk"
export MSYS_NO_PATHCONV=1

echo "▶ Syncing the app source to $BUILD"
mkdir -p "$BUILD"
find "$BUILD" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name '*.log' -exec rm -rf {} +
(cd "$APP" && tar --exclude=node_modules --exclude=android --exclude=ios --exclude=.git --exclude=.expo \
  --exclude=.expo-export-check --exclude=dist --exclude=apk -cf - .) | (cd "$BUILD" && tar -xf -)

echo "▶ Installing dependencies"
(cd "$BUILD" && npm ci --no-audit --no-fund)

echo "▶ Generating the native project (expo prebuild --clean)"
(cd "$BUILD" && APP_ENV=production CI=1 npx expo prebuild --platform android --clean --no-install)
printf 'sdk.dir=%s\n' "$SDK" > "$BUILD/android/local.properties"
grep -q 'usesCleartextTraffic="true"' "$BUILD/android/app/src/main/AndroidManifest.xml" \
  || { echo "✖ the office-network (cleartext) plugin did not apply"; exit 1; }

echo "▶ Building the release APK (Gradle)"
(cd "$BUILD/android" && APP_ENV=production NODE_ENV=production SENTRY_DISABLE_AUTO_UPLOAD=true ANDROID_HOME="$SDK" \
  ./gradlew :app:assembleRelease --no-daemon > "$BUILD/gradle-build.log" 2>&1) \
  || { tail -40 "$BUILD/gradle-build.log"; exit 1; }

echo "▶ Signing with the release key"
BUILD_TOOLS="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
"$BUILD_TOOLS/apksigner.bat" sign --ks "$(win "$KEYSTORE")" --ks-key-alias mico360 \
  --ks-pass env:MICO360_KEYSTORE_PASSWORD --key-pass env:MICO360_KEYSTORE_PASSWORD \
  --out "$(win "$BUILD/app-release-signed.apk")" "$(win "$BUILD/android/app/build/outputs/apk/release/app-release.apk")"
"$BUILD_TOOLS/apksigner.bat" verify --print-certs "$(win "$BUILD/app-release-signed.apk")" | grep -E "Signer #1 certificate (DN|SHA-256)"

mkdir -p "$(dirname "$OUT")"
cp "$BUILD/app-release-signed.apk" "$OUT"
echo "✔ $OUT ($(du -h "$OUT" | cut -f1))"
