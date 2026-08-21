# Hotshare — WiFi Sharing Platform (Educational Project)

A full-stack case study in building a multi-platform WiFi sharing application with payment integration, networking modules, and cross-platform desktop/mobile clients.

Built to demonstrate real-world patterns in: monorepo architecture, Electron + native Android development, Supabase backend, and payment gateway integration.

> **Disclaimer:** This project is for educational and research purposes. Study the architecture, learn from the implementation, and apply the patterns to your own projects.

---

## For ISP Providers

**Are your customers sharing their WiFi with others?**

Hotspot sharing costs ISPs revenue when one subscription serves multiple users. Current technical blocks (TTL rewriting) are increasingly ineffective as clients adopt tunneling solutions.

### The Problem

- One subscriber, dozens of hidden devices behind their connection
- Revenue loss from unshared subscription fees
- Network congestion from unmanaged traffic
- Crude detection methods (TTL hacks) frustrate legitimate users

### The Solution

We provide ISPs with:

- **Real-time hotspot detection** — Identify sharing activity per subscriber using TCP fingerprinting, User-Agent analysis, and traffic pattern recognition
- **Device counting** — Know exactly how many devices are behind each connection
- **Management dashboard** — Monitor, flag, and manage hotspot activity across your network
- **API integration** — Connect to your existing billing and provisioning systems
- **Policy enforcement** — Configure thresholds, alerts, and automated responses

### How It Works

```
ISP Network → Mirror Port/NetFlow → Detection API → Dashboard
                                                       ↓
                                            Device Count + Alert
                                            Billing Integration
                                            Policy Enforcement
```

### Contact

**Interested in deploying hotspot detection for your network?**

- **Email:** [your-email@example.com]
- **GitHub:** [github.com/bradongus/mywify](https://github.com/bradongus/mywify)

---

## What This Project Demonstrates

- Multi-platform monorepo with shared TypeScript packages
- Electron desktop app with native system integrations
- Android native app with Ktor embedded server
- Supabase backend with Row Level Security
- Payment gateway integration (Paystack)
- Cross-device entitlement and licensing system

## Architecture

```
hotshare/
├─ packages/
│   ├─ shared-core/          # TypeScript: voucher spec, entitlement protocol, ledger types
│   ├─ admin-spa/            # React/TypeScript: guest portal + owner admin
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
| Payments | Paystack (M-Pesa, cards, PesaLink) |

## Key Learning Topics

### 1. Cross-Platform Hotspot Management

| Platform | Approach |
|----------|----------|
| **Windows** | C# WinRT wrapper + Electron |
| **Android** | Kotlin reflection + native Ktor server |

Each platform handles hotspot creation, client management, and access control differently due to OS-level API differences.

### 2. Entitlement System Design

- Trial period with offline grace window
- Device fingerprinting
- HMAC-signed voucher codes
- Supabase Row Level Security for data isolation

### 3. Monorepo Architecture

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
- **Voucher code generation** (HMAC-signed)
- **Entitlement protocol** (trial, offline grace, subscription check)
- **Ledger types** (Device, Plan, Voucher, Transaction, ConnectedClient)
- **Payment adapter interface**

```typescript
import { generateCode, checkEntitlement, createTrialDevice } from '@hotshare/shared-core';

const code = generateCode();
const device = createTrialDevice('mac-address');
const entitlement = checkEntitlement(device);
```

### `@hotshare/admin-spa`

React/TypeScript SPA. Three views:
- **Guest Portal** (`/`): Voucher entry page for connected clients
- **Owner Admin** (`/admin/*`): Dashboard, clients, vouchers, plans, revenue, settings
- **Developer Dashboard**: Manage all devices and subscriptions

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
```

### Android APK + AAB

Requires: JDK 17, Android SDK 35.

```bash
cd apps/hotshare-android
./gradlew assembleRelease bundleRelease
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

## Component Overview

### Android

| Component | Purpose |
|---|---|
| MainActivity | Permissions, WebView admin + status display |
| SoftApController | Hotspot management, client list, allow/block |
| SweeperService | Foreground service for access control |
| AdminServer (Ktor) | Embedded HTTP server for admin + guest portal |
| EntitlementClient | License verification via Supabase API |
| UplinkGuard | Network tunnel module |

### Windows

| Component | Purpose |
|---|---|
| Electron main process | App orchestration, system tray |
| Portal server (Express) | Guest portal + admin dashboard |
| Entitlement client | License verification |
| Uplink Guard | Network tunnel module |
| C# helper (WinRT) | System-level hotspot control |

## Database Schema

See `supabase/migrations/001_initial_schema.sql` for the PostgreSQL schema with Row Level Security. Key tables:

- **devices** — installed app instances
- **plans** — pricing tiers per owner
- **vouchers** — signed redemption codes
- **transactions** — payment log
- **connected_clients** — synced from device



## License

**Open Source:** This project is for educational and research purposes.


