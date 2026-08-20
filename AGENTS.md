# AGENTS.md

Workspace: mywify (npm workspaces: `apps/*`, `packages/*`). The main desktop app is `apps/hotshare-win` (Electron + TypeScript, compiled with `npx tsc` into `dist/main/`).

## Run commands

The app needs root for the hotspot (hostapd/dnsmasq/iptables/port 80) on Linux:

```bash
cd apps/hotshare-win
sudo DISPLAY=:0.0 XAUTHORITY=/home/<user>/.Xauthority \
  HOTSHARE_SKIP_ENTITLEMENT=1 ELECTRON_DISABLE_GPU=1 \
  /path/to/workspace/node_modules/.bin/electron . --no-sandbox
```

**One-liner for daily dev:** `scripts/start-dev.sh` — grants root X access (`xhost +SI:localuser:root`), kills stale instances, and launches with the dev env vars. Use it instead of typing the kill+launch dance by hand.

- `HOTSHARE_SKIP_ENTITLEMENT=1` bypasses the licensing check for dev.
- `ELECTRON_DISABLE_GPU=1` avoids GPU crashes on Kali/VM (GLES errors are cosmetic).
- `--no-sandbox` is required when running Electron as root.
- The app is **single-instance**: launching while one is running focuses the existing dashboard window and quits. Port 80 conflicts can only come from foreign services; the portal then falls back to a random free port (logged) and the dashboard still works end-to-end.
- To kill a stale instance (run kill and launch as **separate commands on separate lines** — pasting them on one line makes pkill match nothing):
  ```bash
  sudo pkill -9 -f "electron/dist/electron"
  sudo pkill -f "node_modules/.bin/electron"
  ```

## Cross-platform "running as root + showing the UI" matrix

The app's privileged backend needs elevation on some OSes; **each OS authorizes the GUI process differently**. Fixes below were validated on Linux (Kali).

### Linux — X11 (validated)

- Problem: X rejects the root process with `Authorization required, but no authorization protocol specified`, so the window/tray never renders.
- Root cause: the X server's access-control list only lists the owning user (`xhost` → `SI:localuser:<user>`); root is denied even with a valid cookie file.
- Fix (session-scoped, resets when X restarts):
  ```bash
  DISPLAY=:0.0 xhost +SI:localuser:root
  ```
  and/or launch with explicit `DISPLAY=:0.0 XAUTHORITY=/home/<user>/.Xauthority`. If `~/.Xauthority` looks stale (old mtime), the live cookie may live elsewhere — `xhost +SI:localuser:root` is the reliable fix.
- The dashboard window is `show:false` by design; it is shown on `ready-to-show` now, so the UI appears without the tray.

### Linux — Wayland

- Electron must run as the **normal user**, not root (root can't access the user's `XDG_RUNTIME_DIR`, mode 0700). Don't rely on `xhost`; use `WAYLAND_DISPLAY`/`XDG_RUNTIME_DIR` as the user. Prefer a privileged helper (polkit/setuid) over running the whole Electron app as root.

### Windows (not yet validated)

- Run Electron as the **normal user**; elevation is delegated to the C# helper `apps/hotshare-win/csharp/HotshareHelper.exe` (compiled for net8.0), which triggers UAC for hotspot start/stop/clients. No display authorization problem — the helper is console-only. Ensure `NODE_ENV`/`process.resourcesPath` paths resolve for dev vs packaged builds.
- The WireGuard driver is **bundled** (`apps/hotshare-win/bin/wireguard-amd64-1.1.msi`, ~3 MB) and **silently installed on first enable**: `uplink.ts` `ensureWindowsDriver()` runs the helper's new `wireguard-install <msi>` command (`msiexec /i ... /qn /norestart`) when `%ProgramFiles%\WireGuard\wireguard.exe` is absent — this happens automatically inside `start()` before the tunnel service is created, so the dashboard's one-tap "Turn on protected internet" works on a fresh Windows box. Helper also gained `wireguard-status` (tunnel service + driver presence as JSON).
- Tunnel management on Windows is **service-based, not wg-quick**: `start()` → `wireguard.exe /installtunnelservice hotshare <conf>` (or `/starttunnelservice` if the service survives), `stop()` → `/uninstalltunnelservice hotshare` (uninstall always removes the service, so a regenerated config is always re-read on the next start). `wg.exe`/`wireguard.exe` are resolved from `%ProgramFiles%\WireGuard` via `wgCli()`, falling back to PATH (the MSI adds it).
- `generateWarpConfig()`/`regenerateDevice()` are **no longer Linux-only**: the bundled `bin/wgcf-windows-x64.exe` does register/generate identically. `DNS =` lines are **kept on Windows** (the client owns DNS; the Linux strip exists only because this box lacks resolvconf/resolvectl and wg-quick hard-fails). Status/probe commands are platform-neutral: `wg show ...` via `wgCli('wg')`, `curl --interface wg0` (ships with Win10 1803+), and `attemptRestore()` checks `wg show interfaces` instead of `ip link show`.
- **No egress rules on Windows** — `hotspot.ts` `applyEgressRules()`/`refreshEgress()` are Linux-only no-ops now. Windows Mobile Hotspot NATs via the OS default route, which the WireGuard full tunnel owns; guests should ride `wg0` automatically (**the one big unknown to prove on hardware: whether the Mobile Hotspot shares the WG default route with the OS client**). The TTL mangle and `lookup 51820` policy rules never run there.
- Packaging: `bin/wgcf-*` + `bin/wireguard-*.msi` ship via `extraResources` → `resources/bin/`; the helper's published build → `resources/csharp/`.
- Dev caveats on this box: no `dotnet` SDK installed — the helper binary can only be rebuilt/validated on a Windows machine.

### macOS (not yet validated)

- macOS apps don't run as root for hotspot sharing; the OS handles network privacy via TCC prompts (first-run dialog). Keep the entitlement/licensing check (`EntitlementClient`). Electron window works out of the box; do not disable GPU globally.

## Linux hotspot: 2.4 GHz pinning is REQUIRED (validated)

The WiFi radio cannot run a 5 GHz managed link and a 2.4 GHz AP simultaneously. If the client is on 5 GHz (e.g. `channel 149`), a hardcoded `channel=1` hostapd config fails with `nl80211: Could not configure driver mode`.

`src/main/hotspot.ts` `startLinux()` must (already implemented — do not regress):
1. Clean up leftovers from a killed instance FIRST (`cleanupLeftovers()`: kill `/run/hotshare-hostapd.pid` + `/run/hotshare-dnsmasq.pid`, remove stale iptables/ip rules, delete `wlanAp`, undo the `hotshare-ap-24` pin, restore the original Wi-Fi). A SIGKILLed app leaves hostapd broadcasting the OLD SSID — guests then see a stale network and the new instance's own start fails with EBUSY on `wlanAp` deletion.
2. Pin the client to the 2.4 GHz BSSID of the current network via `nmcli con add ... wifi.bssid <bssid> connection.autoconnect no` + `nmcli con up hotshare-ap-24`.
3. Read the landed channel from `iw dev <iface> info` (must be ≤ 14) and use it in the hostapd config.
4. Disable offloads on the AP interface: `ethtool -K wlanAp tx off rx off tso off gso off gro off sg off` (iwlwifi concurrent-AP fix).
5. Add the AP-subnet routing rule: `ip rule add to 192.168.100.0/24 lookup main priority 1000`.
6. Normalize guest TTL: `iptables -t mangle -A POSTROUTING -o <uplink> -j TTL --ttl-set 64` — carrier APs drop packets whose TTL was decremented by the extra hop ("connected but no internet" = tethering detection).
7. Guests use the AP gateway as DNS: dnsmasq runs `port=53` and `dhcp-option=option:dns-server,192.168.100.1` (NOT external resolvers — 1.1.1.1 is often blocked/filtered).
8. On stop, restore the original Wi-Fi connection (`nmcli con up <saved>` after deleting `hotshare-ap-24`), saved to `/run/hotshare-state`.

The old `DnsInterceptor` (dns.ts) is removed — it answered every DNS query with a hardcoded portal IP (192.168.137.1, wrong subnet) and made guest internet impossible. The guest portal is still served at `http://192.168.100.1` (port 80) for vouchers/payment; there is no L3 enforcement yet, so guests get internet regardless of payment state.

## Guest internet REQUIRES the WireGuard tunnel on AIRMAX networks (validated)

Root cause found empirically: the ISP's AIRMAX upstream router **rewrites every downlink reply to TTL=1**. Host-local traffic survives (TTL isn't decremented on delivery), but forwarded guest replies die in the AIRMAX `ip_forward` (time-exceeded) before our NAT ever sees them. This is NOT the usual tethering detection:

- `xt_ttl` is **absent** from this kernel (not a module, not builtin, no package provides it) — the TTL mangle rule in `applyEgressRules()` fails silently with a log line. Building it from source is possible (headers + `xt_ttl.c` from kernel.org) but was never needed.
- A TTL rule would NOT help anyway: the reply already arrives with TTL=1, and normalizing `-o wlan0` can't restore a packet that died in the upstream's forward.
- **Only a tunnel works**: replies come back inside the tunnel with normal TTL; the outer packet terminates at our host (local delivery ignores TTL).

Implementation (`hotspot.ts`, do not regress):

- `HotspotController` takes an optional `UplinkGuard`; egress = `wg0` when the tunnel is active, else the Wi-Fi uplink.
- `applyEgressRules(egress)` sets NAT/FORWARD for the guest subnet off the chosen egress; on `wg0` it adds `ip rule add from 192.168.100.0/24 lookup 51820 priority 1001` (belt-and-braces; wg-quick's full-tunnel `not fwmark ... table 51820` rule already covers guests) and skips the TTL mangle attempt.
- `refreshEgress()` live-swaps only the iptables/ip rules when the Uplink Guard toggle changes while the hotspot runs — **no hostapd/dnsmasq restart, guests stay connected**. Hooked from the tray toggle (`index.ts`) and `PUT /api/settings` (`portal.ts`).
- `startLinux()` fails fast if `tunnelRequired` (settings `uplinkGuardEnabled`) but the tunnel is down — silently falling back to `wlan0` would reproduce "connected, no internet".
- `stopLinux()`/`cleanupLeftovers()` also delete `-o wg0` rules + the `lookup 51820` rule (stale-egress hygiene).
- WARP config lives at `~/.hotshare/wg0.conf` of the **root** user (`/root/.hotshare/wg0.conf`) since the app runs as root. Two ways to create it:
  - **One-click (recommended)**: dashboard Settings → Uplink Guard → "Generate free WARP config (1-click)" → `POST /api/settings/uplink-guard/warp` (`portal.ts`) runs `generateWarpConfig()` (`uplink.ts`): the bundled per-OS `wgcf` binary (`apps/hotshare-win/bin/wgcf-linux-x64` or `wgcf-windows-x64.exe`, resolved dev vs `process.resourcesPath` for packaged) does `wgcf register --accept-tos && wgcf generate` in the config dir, writes the config, starts the tunnel, persists `uplinkGuardEnabled=true`, and live-swaps guest egress. The account file (`wgcf-account.toml`) is kept so regeneration reuses the same device. **Strip the `DNS =` line on Linux only** — this box has no `resolvconf`/`resolvectl`, and wg-quick 1.0.20260223 hard-fails when DNS is set (Windows keeps DNS; the client owns it). Guest DNS still works: dnsmasq (192.168.100.1:53) forwards to NetworkManager's 1.1.1.1/8.8.8.8 through the tunnel.
  - Manual import: paste a `.conf` in the same Settings view (saved base64 to the same path).
- Verify: `wg show wg0` shows a handshake; `iptables -t nat -L POSTROUTING -n` lists `-o wg0` MASQUERADE; phone browses; `wg show wg0 transfer` bytes climb.

**Self-healing tunnel (do not regress):** `UplinkGuard` runs a health monitor (tick every `warpProbeIntervalSec`, default 30s): handshake age (`wg show latest-handshakes`, >180s = dead) + `curl --interface wg0 https://1.1.1.1` (through the tunnel, host-side — immune to the ISP's forwarded-traffic policy). Degraded only after `resetAfterFailures` (3) consecutive failures. Recovery ladder, each step emits an event (tray + dashboard):
1. **Reset** — `wg-quick down/up` (60s min between resets).
2. **Rotate device** — `regenerateDevice()`: tear down, rename `wgcf-account.toml` aside (fresh identity), `generateWarpConfig()`, bring up; min interval `warpCooldownMin` (60m). Old account restored if rotation fails.
3. **Failback** (if `warpFailback`): egress → `wlan0` live via `onFailback` → `hotspot.refreshEgress()` (no guest disconnect); dashboard red banner + tray "Tunnel: failed back!". While failed back, `attemptRestore()` retries the tunnel each tick and re-rotates when the cooldown allows; on success it live-swaps egress back to `wg0` and emits `restored`.
4. **Daily rotation** at `warpRotateHour` (default 3 AM, shop closed): fresh device every day dodges per-device usage caps; fires at most once/day and not within 1h of a recovery rotation.
Manual "Rotate device now" = `POST /api/settings/uplink-guard/rotate`. Health surfaced via `/api/device/state` → `tunnelHealth` (counters reset per local day). Monitor + callbacks are wired in `index.ts` boot (`uplink.configureMonitor`), re-applied from `PUT /api/settings` (numbers only — callbacks persist via merge in `configureMonitor`). The monitor timer starts lazily from `start()`; ticks are no-ops while the tunnel is off. Harness test: `node /tmp/opencode/uplink-test.js` (stubs root-only bits, asserts the whole ladder). The dashboard's one-tap flow is `POST /api/settings/uplink-guard/toggle` (`{enabled}`) — it auto-generates the WARP config when none exists (this is the only endpoint the SPA's main protection button uses; `/warp` remains for API compat).

Do NOT regress the settings flow: `HotspotController` is constructed from `SettingsStore` values (`index.ts`), `updateConfig()` merges new SSID/password, and `restart()` = stop + start (hostapd config is regenerated from `this.config`). The dashboard's Settings page prompts to restart automatically when the SSID/password changed while the hotspot is running.

Reference working script: `/usr/local/bin/wifi-hotspot`.

## Renderer must be served over HTTP, not file:// (ALL OSes — black window fix)

The SPA (Vite build in `src/renderer/public/`) uses react-router history routing (`RouterProvider`). Loading it with `BrowserWindow.loadFile()` produces:

```
No routes matched location "file:///.../index.html"
```

and a black/empty window. The app now serves it via `src/main/rendererServer.ts` (localhost-only HTTP, SPA fallback to `index.html`, random port) and `mainWindow.loadURL(...)`. Keep this on every OS. The server binds `127.0.0.1` so hotspot guests can never reach the dashboard.

The RendererServer also **proxies `/api/*` to the portal server on port 80** so the dashboard's fetch calls work inside Electron (the SPA uses same-origin relative `/api` paths). Settings writes are loopback-guarded in `portal.ts` (`isLocal()`), so guests hitting port 80 directly can't change owner settings. The SPA source is `packages/admin-spa`; its vite `outDir` points at `../../apps/hotshare-win/src/renderer/public` so `npm run build` ships the dashboard into the app. Settings are persisted via `src/main/settings.ts` (better-sqlite3 `settings` table in `hotshare.db`) and fed into the `HotspotController` on startup.

## Node_modules gotchas

- This is a workspace: Electron is hoisted to the **root** `node_modules/electron`, not `apps/hotshare-win/node_modules`. Run it via `/path/to/workspace/node_modules/.bin/electron`.
- The project uses npm's `allow-scripts` (only `better-sqlite3` approved in root `package.json`), so Electron's postinstall (binary download) is blocked. If `node_modules/electron/dist/electron` is missing, run manually: `node node_modules/electron/install.js` from the workspace root.
- Fresh 35.x binary downloads can `ETIMEDOUT`; a cached zip in `~/.cache/electron/<hash>/electron-v33.4.11-linux-x64.zip` is the fallback (unzip into `node_modules/electron/dist/`). `electron --version` will then differ from the package version — acceptable for dev.
