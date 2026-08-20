#!/bin/bash
# hotshare — Android Release Build Script
# Requires: JDK 17, Android SDK 35, Gradle 8.11+, Node.js >= 20 (for the SPA).

set -e

echo "=== hotshare Android Release Build ==="

# Check prerequisites
command -v java >/dev/null 2>&1 || { echo "JDK 17 required"; exit 1; }
command -v gradle >/dev/null 2>&1 || { echo "Gradle 8.11+ required (wrapper jar is not committed)"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm required (admin SPA must be bundled)"; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# The Android preBuild task runs this itself, but building it here first gives
# clearer errors and lets you pass -PHOTSHARE_* flags without a rebuild.
echo "[0/3] Building admin SPA..."
npm run build --workspace=@hotshare/admin-spa

cd apps/hotshare-android

# Build release APK
echo "[1/3] Building release APK..."
gradle assembleRelease

# Build AAB for Play Store
echo "[2/3] Building AAB for Play Store..."
gradle bundleRelease

echo ""
echo "=== Build Complete ==="
echo "APK:  app/build/outputs/apk/release/app-release.apk"
echo "AAB:  app/build/outputs/bundle/release/app-release.aab"
echo ""
echo "Signing: set KEYSTORE_PATH/KEYSTORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD"
echo "Backend: add -PHOTSHARE_SUPABASE_URL=... -PHOTSHARE_SUPABASE_ANON_KEY=..."
echo "         -PHOTSHARE_VOUCHER_SECRET=... to the gradle commands above."