# Hotshare — WiFi Sharing Platform (Educational Project)

A full-stack case study in building a multi-platform WiFi sharing application with payment integration, tunnel networking, and cross-platform desktop/mobile clients.

Built to demonstrate real-world patterns in: monorepo architecture, Electron + native Android development, Supabase backend, WireGuard tunneling, and payment gateway integration.

> **Disclaimer:** This project is for educational and research purposes. Study the architecture, learn from the implementation, and apply the patterns to your own projects.

## What This Project Demonstrates

```
YOU ──(monthly subscription via Paystack)──► OWNER ──(vouchers)──► CLIENTS
```

- **Tier 1 (platform owner revenue):** App owners subscribe via Paystack (M-Pesa/cards/PesaLink). 30-day free trial per device, then subscription required.
- **Tier 2 (hotspot operator revenue):** Owners create voucher plans and charge connected clients (M-Pesa, cash, etc.).

## Architecture

```
hotshare/
├─ packages/
│   ├─ shared-core/          # TypeScript: voucher spec, entitlement protocol, ledger types
│   ├─ admin-spa/            # React/TypeScript: guest portal + owner admin + developer dashboard
│   └─ website/              # React/TypeScript: public landing page
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

## Key Learning Topics

### 1. ISP TTL Rewriting & WireGuard Tunnels

Some ISPs enforce "one device" by rewriting all downlink reply TTLs to 1. This kills forwarded guest traffic (TTL≤1 → ICMP time-exceeded in the router's `ip_forward`). This project demonstrates a built-in WireGuard tunnel module that bypasses this restriction automatically.

### 2. Cross-Platform Hotspot Management

| Platform | Approach |
|----------|----------|
| **Windows** | C# WinRT wrapper (`NetworkOperatorTetheringManager`) + Electron |
| **Android** | Kotlin reflection (`SoftApController`) + native Ktor server |

### 3. Entitlement System Design

- 30-day trial with 48-hour offline grace period
- Device fingerprinting (hardware ID)
- HMAC-signed voucher codes (`HS-XXXXXXXX` format)
- Supabase Row Level Security for data isolation

### 4. Monorepo Architecture

npm workspaces with shared TypeScript packages, separate platform apps, and a unified build/release pipeline via GitHub Actions.

## Getting Started

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- Supabase account (free tier)
- Paystack account (test mode)

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

Zero-dependency TypeScript library demonstrating:
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

React/TypeScript landing page with OS detection and download buttons.

## Build Instructions

### Release Build (GitHub Actions)

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the
Windows installer and Android APK/AAB, then attaches them to a draft GitHub Release.

**Android signing secrets** (optional — without them the APK is unsigned):

| Secret | Purpose |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of `release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | signing key alias |
| `ANDROID_KEY_PASSWORD` | key password |

### Windows Installer (manual)

Requires: Node.js ≥ 20, .NET 8 SDK on Windows.

```bash
bash tools/build-win.sh
# Output: apps/hotshare-win/release/hotshare Setup *.exe
```

### Android APK + AAB

Requires: JDK 17, Android SDK 35.

```bash
cd apps/hotshare-android
./gradlew assembleRelease bundleRelease
# APK:  app/build/outputs/apk/release/app-release-unsigned.apk
# AAB:  app/build/outputs/bundle/release/app-release.aab (for Play Store)
```

### Backend Configuration

Pass project properties (they land in `BuildConfig`):

```bash
gradle assembleDebug \
  -PHOTSHARE_SUPABASE_URL=https://your-project.supabase.co \
  -PHOTSHARE_SUPABASE_ANON_KEY=your-anon-key \
  -PHOTSHARE_VOUCHER_SECRET=your-shared-secret
```

### Deploy License API

```bash
export SUPABASE_PROJECT_REF=your-project-id
bash tools/deploy-api.sh
```

## Component Deep Dive

### Android — What Runs on the Phone

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

### Uplink Guard on Android

Unlike the desktop app there is no iptables egress to swap: the OS tethering NAT
owns the default route, so when the tunnel is up guests ride it and when it
fails back guests fall through to mobile data. The health monitor (probe
`https://1.1.1.1` through the tunnel + WireGuard handshake age) still runs the
reset → rotate → failback → restore ladder.

### Windows — What Runs on the Machine

| Component | When | What it does |
|---|---|---|
| Electron main process | App start | Orchestrates everything, system tray |
| DNS interceptor (Node) | Hotspot on | All DNS → 192.168.137.1 (portal redirect) |
| Firewall enforcer (netsh) | Hotspot on | Per-IP block for unpaid clients |
| Portal server (Express) | Hotspot on | Guest portal on port 80, admin on 8080 |
| Entitlement client | Every 6h | Checks license via Supabase API |
| Uplink Guard (WireGuard) | Optional | Tunnel for hostile ISP networks |
| C# helper (WinRT) | Start/stop | Hotspot start/stop + client list |

## Database Schema

See `supabase/migrations/001_initial_schema.sql` for the full PostgreSQL schema with Row Level Security policies. Key tables:

- **devices** — one row per installed app instance (fingerprinted by hardware ID)
- **plans** — pricing tiers created by each hotspot owner
- **vouchers** — HMAC-signed redemption codes
- **transactions** — payment log (subscription + voucher types)
- **connected_clients** — synced from device for admin visibility

## Costs

| Stage | Monthly Cost |
|---|---|
| Build + pilot | $0 (Supabase Free + Vercel Hobby) |
| First paying owners | $0 (500K invocations ≈ ~3,300 devices) |
| ~3,300 devices | $25 (Supabase Pro) |
| 100,000 devices | ~$55 |

## License

This project is for educational and research purposes. Study the architecture, learn from the implementation, and apply the patterns to your own projects.
