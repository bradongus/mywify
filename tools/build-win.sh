#!/bin/bash
# hotshare — Windows Release Build Script
# Run on Windows with: bash tools/build-win.sh

set -e

echo "=== hotshare Windows Release Build ==="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Node.js required"; exit 1; }
command -v dotnet >/dev/null 2>&1 || { echo ".NET SDK required"; exit 1; }

# Build C# helper
echo "[1/4] Building C# hotspot helper..."
cd apps/hotshare-win/csharp
dotnet publish -c Release -r win-x64 --self-contained
cd ../..

# Install dependencies
echo "[2/4] Installing dependencies..."
npm install

# Compile TypeScript
echo "[3/4] Compiling TypeScript..."
npx tsc

# Build Electron installer
echo "[4/4] Building Electron installer..."
npx electron-builder --win

echo ""
echo "=== Build Complete ==="
echo "Installer: apps/hotshare-win/release/hotshare Setup *.exe"
