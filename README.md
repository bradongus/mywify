# hotshare

WiFi-sharing app that lets owners share their internet connection and charge clients via vouchers. Owners pay a monthly subscription to use the app (1-month free trial).

## Revenue Model

```
YOU ──(monthly subscription via Paystack)──► OWNER ──(vouchers)──► CLIENTS
```

- **Tier 1 (your revenue):** Owners subscribe to hotshare via Paystack (M-Pesa/cards/PesaLink). 30-day free trial per device, then subscription required.
- **Tier 2 (their revenue):** Owners set their own voucher plans and charge their connected clients however they like (M-Pesa, cash, etc.).

## Why Uplink Guard

Some ISPs enforce "one device" by rewriting all downlink reply TTLs to 1. This kills forwarded guest traffic (TTL≤1 → ICMP time-exceeded in the router's `ip_forward`). hotshare ships with a built-in WireGuard tunnel module that fixes this automatically.

## Architecture

```
hotshare/
├─ packages/
│   ├─ shared-core/          # TypeScript: voucher spec, entitlement protocol, ledger types
│   ├─ admin-spa/            # React/TypeScript: guest portal + owner admin + developer dashboard
│   └─ website/              # React/TypeScript: public landing page (hotshare.vercel.app)
│
├─ apps/
│   ├─ license-api/          # Supabase Edge Functions (Deno/TS) + Postgres
│   ├─ hotshare-win/         # Electron + React/TS + C# WinRT helper
│   └─ hotshare-android/     # Native Kotlin + Room + Ktor + WebView
│
├─ supabase/                 # SQL migrations
├─ tools/                    # Build/pack scripts
└── README.md
```

## Tech Stack

| Layer | Tech |
|---|---|
| License API | Supabase Edge Functions (Deno) + Postgres + Auth |
| Admin SPA hosting | Vercel (static React/TS) |
| Windows app | Electron + React/TS + C# WinRT helper |
| Android app | Native Kotlin + Room + Ktor + WebView |
| Payments (Tier 1) | Paystack (M-Pesa STK push, cards, PesaLink) |
| Payments (Tier 2) | On-device vouchers (payment-agnostic) |
| Uplink Guard | WireGuard tunnel module |

## Getting Started

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- Supabase account (free tier)
- Paystack account (test mode, then live)

### Install

```bash
npm install
```

### Run Tests

```bash
npm run test
```

### Run Admin SPA (dev)

```bash
npm run dev:spa
```

Opens at `http://localhost:5173`.

### Run Website (dev)

```bash
npm run dev:website
```

Opens at `http://localhost:5174`.

### Setup Supabase

1. Create a new Supabase project (free tier)
2. Run the migration in the SQL editor:
   ```bash
   cat supabase/migrations/001_initial_schema.sql
   ```
3. Copy your Supabase URL and anon key into `packages/admin-spa/.env`:
   ```
   VITE_API_URL=http://localhost:8080
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

## Packages

### `@hotshare/shared-core`

Zero-dependency TypeScript library. Provides:
- **Voucher code generation** (`HS-XXXXXXXX` format, HMAC-signed)
- **Entitlement protocol** (30-day trial, 48h offline grace, subscription check)
- **Ledger types** (Device, Plan, Voucher, Transaction, ConnectedClient)
- **Payment adapter interface** (Paystack, manual code, SMS parser)

```typescript
import { generateCode, checkEntitlement, createTrialDevice } from '@hotshare/shared-core';

const code = generateCode();           // "HS-7K2M9P1X"
const device = createTrialDevice('mac-address');
const entitlement = checkEntitlement(device); // { granted: true, status: 'trial', ... }
```

### `@hotshare/admin-spa`

React/TypeScript SPA. Three views:
- **Guest Portal** (`/`): Voucher entry page shown to connected clients
- **Owner Admin** (`/admin/*`): Dashboard, clients, vouchers, plans, revenue, settings
- **Developer Dashboard** (hosted separately on Vercel): Manage all devices and subscriptions

### `@hotshare/website`

React/TypeScript landing page. Single-page marketing site with:
- **Hero section**: Download buttons for Windows + Android
- **OS detection**: Automatically shows the right primary download button
- **Dark theme**: Matches the admin-spa design system

Deployed to Vercel. Uses GitHub Releases for binary hosting.

## Build Phases

- [x] **Phase 0:** Monorepo scaffold, shared-core, admin SPA, Supabase schema, tests
- [x] **Phase 1:** License API (Supabase Edge Functions + Paystack integration)
- [x] **Phase 2:** Windows MVP (Electron app + DNS interceptor + WireGuard)
- [x] **Phase 3:** Android app (Kotlin + reflection SoftAP layer)
- [x] **Phase 4:** Release packaging + build scripts

## Release Build

### Automated (GitHub Actions)

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the
Windows installer (`hotshare-setup.exe`) and the Android APK/AAB
(`hotshare.apk` / `hotshare.aab`) and attaches them to a draft GitHub Release —
the website's download buttons resolve straight to those URLs.

Repo secrets required for a **signed** Android build:

| Secret | Purpose |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of `release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | signing key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Without them the Android job still succeeds but emits an unsigned APK.

### Windows Installer (manual)

Requires: Node.js ≥ 20, .NET 8 SDK on Windows.

```bash
bash tools/build-win.sh
# Output: apps/hotshare-win/release/hotshare Setup *.exe
```

### Android APK + AAB

Requires: JDK 17, Android SDK 35.

```bash
bash tools/build-android.sh
# APK:  app/build/outputs/apk/release/app-release.apk
# AAB:  app/build/outputs/bundle/release/app-release.aab (for Play Store)
```

### Deploy License API

```bash
export SUPABASE_PROJECT_REF=your-project-id
bash tools/deploy-api.sh
```

### WARP Preset (optional, test Cloudflare ToS first)

```bash
python3 tools/generate-warp.py --output configs/warp.conf
```

## Android App — Build Instructions

The Android app builds on Kali (or any machine with Android SDK). Prerequisites: Android SDK 35, JDK 17, Gradle 8.11+, and Node.js ≥ 20 (the preBuild task compiles the admin SPA with vite and bundles it into `assets/spa`).

The gradle wrapper jar is not committed, so drive Gradle directly (or let CI's `gradle/actions/setup-gradle` pick it up):

```bash
cd apps/hotshare-android
gradle assembleDebug
```

APK output: `app/build/outputs/apk/debug/app-debug.apk`

The SPA must be built first. If npm is available the build task runs
`npm run build --workspace=@hotshare/admin-spa` automatically (it copies
`apps/hotshare-win/src/renderer/public` into `app/src/main/assets/spa`); if npm
is missing it falls back to the last pre-built copy and fails if there is none.

### Backend configuration

Pass project properties (they land in `BuildConfig` and the license/voucher code):

```bash
gradle assembleDebug \
  -PHOTSHARE_SUPABASE_URL=https://your-project.supabase.co \
  -PHOTSHARE_SUPABASE_ANON_KEY=your-anon-key \
  -PHOTSHARE_VOUCHER_SECRET=your-shared-secret
```

`HOTSHARE_VOUCHER_SECRET` must match `packages/shared-core` so vouchers issued
on desktop redeem on Android and vice versa. It defaults to
`hotshare-dev-secret-change-in-prod`.

### Signing a release

```bash
gradle assembleRelease bundleRelease
```

Set the env vars below (or use the GitHub Actions secrets) — without
`KEYSTORE_PASSWORD` the release build produces an **unsigned** APK:

```bash
export KEYSTORE_PATH=/path/to/release.keystore   # defaults to app/release.keystore
export KEYSTORE_PASSWORD=...                     # enables signing
export KEY_ALIAS=...
export KEY_PASSWORD=...
```

### What runs on the phone

| Component | When | What it does |
|---|---|---|
| MainActivity | App open | Permissions + battery exemption, WebView admin + status display |
| SoftApController | Start | Reflection: start hotspot, client list, allow/block |
| SweeperService | Foreground | Every 10s: disconnect unpaid MACs (force-disconnect, else block) |
| AdminServer (Ktor) | Always | Serves React admin SPA on 127.0.0.1:8080 + guest portal on :80 |
| EntitlementClient | Every 6h | Checks license via Supabase API |
| UplinkGuard | Optional | Built-in WireGuard tunnel (wg-go) + self-healing health monitor |
| HotspotManager | Toggle | Capability check, entitlement gate, sweeper + tunnel wiring |
| CapabilityDetector | App start | Checks STA+AP + force-disconnect support |

### Capability Detection

On first launch, the app checks:
1. `WifiManager.isStaConcurrencyForLocalOnlyConnectionsSupported()` — can the device share WiFi while connected?
2. `SoftApCapability.areFeaturesSupported(SOFTAP_FEATURE_CLIENT_FORCE_DISCONNECT)` — can we force-disconnect clients?
3. Max supported clients

If force-disconnect is unsupported, the sweeper blocks unpaid clients instead
(they stay connected until they drop; a future release will rotate the hotspot
password to kick everyone).

### Uplink Guard on Android

Unlike the desktop app there is no iptables egress to swap: the OS tethering NAT
owns the default route, so when the tunnel is up guests ride it and when it
fails back guests fall through to mobile data. The health monitor (probe
`https://1.1.1.1` through the tunnel + WireGuard handshake age) still runs the
reset → rotate → failback → restore ladder. The first enable opens the Android
VPN permission dialog; the tunnel is brought up automatically after you accept.

## Windows App — Build Instructions

The Windows app runs on the **user's Windows machine** (not Kali). Prerequisites: Node.js ≥ 20, .NET 8 SDK, Visual Studio or MSBuild.

```bash
cd apps/hotshare-win
npm install
npx tsc
npx electron-builder --win
```

### C# Hotspot Helper

The C# helper wraps WinRT `NetworkOperatorTetheringManager` for hotspot control. Build separately:

```bash
cd apps/hotshare-win/csharp
dotnet publish -c Release -r win-x64
```

The compiled `HotshareHelper.exe` is placed in `csharp/bin/Release/net8.0/` and bundled by electron-builder.

### What runs on your machine

| Component | When | What it does |
|---|---|---|
| Electron main process | App start | Orchestrates everything, system tray |
| DNS interceptor (Node) | Hotspot on | All DNS → 192.168.137.1 (portal redirect) |
| Firewall enforcer (netsh) | Hotspot on | Per-IP block for unpaid clients |
| Portal server (Express) | Hotspot on | Guest portal on port 80, admin on 8080 |
| Entitlement client | Every 6h | Checks license via Supabase API |
| Uplink Guard (WireGuard) | Optional | Tunnel for hostile ISP networks |
| C# helper (WinRT) | Start/stop | Hotspot start/stop + client list |

## Quick Start (for testing on your own machine)

```bash
# 1. Install
npm install

# 2. Run shared-core tests
npm test

# 3. Run admin SPA (dev)
npm run dev:spa
# Opens http://localhost:5173

# 4. Deploy license API (needs Supabase project)
export SUPABASE_PROJECT_REF=your-project-id
bash tools/deploy-api.sh

# 5. Build Windows app (on Windows)
bash tools/build-win.sh

# 6. Build Android app (needs Android SDK)
bash tools/build-android.sh
```

## Costs

| Stage | Monthly Cost |
|---|---|
| Build + pilot | $0 (Supabase Free + Vercel Hobby) |
| First paying owners | $0 (500K invocations ≈ ~3,300 devices) |
| ~3,300 devices | $25 (Supabase Pro) |
| 100,000 devices | ~$55 |

## License

Private — not for distribution.
