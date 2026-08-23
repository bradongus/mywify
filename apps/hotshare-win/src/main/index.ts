import { app, BrowserWindow, Tray, Menu, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { HotspotController } from './hotspot';
import { FirewallEnforcer } from './firewall';
import { BillingEngine } from './billing';
import { EntitlementClient } from './entitlement';
import { UplinkGuard } from './uplink';
import { PortalServer } from './portal';
import { RendererServer } from './rendererServer';
import { SettingsStore } from './settings';
import { isLinux, isWindows, SUBNET, checkPrerequisites } from './platform';

// Default the owner dashboard to skip the external license-server entitlement
// check (no Edge Function required). Override with HOTSHARE_SKIP_ENTITLEMENT=0
// to re-enable licensing enforcement.
if (!process.env.HOTSHARE_SKIP_ENTITLEMENT) {
  process.env.HOTSHARE_SKIP_ENTITLEMENT = '1';
}

// Single instance: a second launch must never fight over port 80 or the DB.
// It focuses the already-running dashboard window instead and quits.
if (!app.requestSingleInstanceLock()) {
  console.log('hotshare is already running — this instance will quit.');
  app.quit();
}

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let rendererServer: RendererServer | null = null;

// Tunnel health status shown in the tray (updated by UplinkGuard events).
let uplinkStatus: 'ok' | 'degraded' | 'failed-back' | 'busy' = 'ok';

function tunnelLabel(): string {
  if (!uplink.isActive()) return 'Tunnel: off';
  switch (uplinkStatus) {
    case 'busy': return 'Tunnel: working...';
    case 'failed-back': return 'Tunnel: failed back!';
    case 'degraded': return 'Tunnel: degraded';
    default: return 'Tunnel: OK';
  }
}

const billing = new BillingEngine(path.join(app.getPath('userData'), 'hotshare.db'));
const settings = new SettingsStore(path.join(app.getPath('userData'), 'hotshare.db'));
const uplink = new UplinkGuard();
const hotspot = new HotspotController(
  {
    ssid: settings.get().ssid,
    password: settings.get().password,
    tunnelRequired: settings.get().uplinkGuardEnabled,
  },
  uplink
);
const firewall = new FirewallEnforcer();
const entitlement = new EntitlementClient();
const portal = new PortalServer(billing, entitlement, settings, hotspot, uplink);

app.whenReady().then(async () => {
  // Check prerequisites on Linux
  if (isLinux) {
    const { ok, missing } = await checkPrerequisites();
    if (!ok) {
      console.error('Missing prerequisites:', missing);
      // Show error dialog and quit
      const { dialog } = await import('electron');
      dialog.showErrorBox(
        'Missing Requirements',
        `The following are required for hotspot sharing:\n\n${missing.join('\n')}\n\nPlease install them and try again.`
      );
      app.quit();
      return;
    }
  }

// Create system tray — use .png on Linux, .ico on Windows
  const iconExt = isLinux ? 'png' : 'ico';
  const iconPath = path.join(__dirname, `../../assets/icon.${iconExt}`);
  try {
    tray = new Tray(iconPath);
  } catch {
    tray = new Tray(require('electron').nativeImage.createEmpty());
  }
  tray.setToolTip('hotshare');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'hotshare', enabled: false },
    { type: 'separator' },
    { label: 'Show Dashboard', click: () => mainWindow?.show() },
    { label: 'Hotspot: Starting...', enabled: false, id: 'hotspot-status' },
    { label: 'Clients: 0', enabled: false, id: 'client-count' },
    { type: 'separator' },
    { label: 'Start Sharing', click: () => startHotspot() },
    { label: 'Stop Sharing', click: () => stopHotspot() },
    { type: 'separator' },
    { label: tunnelLabel(), enabled: false, id: 'tunnel-status' },
    { label: 'Enable Uplink Guard', type: 'checkbox', checked: false, click: () => toggleUplink() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));

  // Create dashboard window
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    title: 'hotshare — Dashboard',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  // Serve the SPA over localhost HTTP — history-based routing (react-router)
  // renders a black window when loaded via file://
  rendererServer = new RendererServer();
  // Portal first: the dashboard's API calls are proxied to it, so the proxy
  // target must be the portal's REAL port (80, or the fallback if busy).
  const portalPort = await portal.start(80);
  if (!portalPort) console.error('Portal server is NOT running — dashboard API calls will fail.');
  const rendererUrl = await rendererServer.start(
    path.join(__dirname, '../../src/renderer/public'),
    portalPort ? `http://127.0.0.1:${portalPort}` : undefined
  );
  console.log(`Dashboard serving at ${rendererUrl}`);
  mainWindow.loadURL(rendererUrl);

  // Dev auto-reload: after a `npm run build` the dashboard refreshes itself,
  // so there's no need to Ctrl+R in the window after changing SPA code.
  if (process.env.NODE_ENV === 'development') {
    const spaDir = path.join(__dirname, '../../src/renderer/public');
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      fs.watch(spaDir, { recursive: true }, (_event, filename) => {
        if (filename && /\.(html|js|css)$/.test(String(filename))) {
          if (reloadTimer) clearTimeout(reloadTimer);
          reloadTimer = setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              console.log('SPA changed — reloading dashboard');
              mainWindow.reload();
            }
          }, 300);
        }
      });
    } catch (e) {
      console.error('SPA watcher failed:', (e as Error).message);
    }
  }

  // Show the dashboard automatically once loaded (do not depend on the tray)
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow?.hide();
  });

  // IPC handlers for renderer
  ipcMain.handle('get-state', () => getState());
  ipcMain.handle('get-clients', () => billing.getConnectedClients());
  ipcMain.handle('get-plans', () => billing.getPlans());
  ipcMain.handle('create-plan', (_, plan) => billing.createPlan(plan));
  ipcMain.handle('update-plan', (_, id, data) => billing.updatePlan(id, data));
  ipcMain.handle('delete-plan', (_, id) => billing.deletePlan(id));
  ipcMain.handle('get-vouchers', () => billing.getVouchers());
  ipcMain.handle('generate-vouchers', (_, planId, count) => billing.generateVouchers(planId, count));
  ipcMain.handle('deactivate-voucher', (_, id) => billing.deactivateVoucher(id));
  ipcMain.handle('get-revenue', (_, period) => billing.getRevenue(period));
  ipcMain.handle('disconnect-client', (_, mac) => firewall.disconnectClient(mac));
  ipcMain.handle('block-client', (_, mac) => firewall.blockClient(mac));
  ipcMain.handle('redeem-code', (_, code: string, mac: string) => billing.redeemCode(code, mac || 'unknown'));
  ipcMain.handle('check-entitlement', () => entitlement.check());
  ipcMain.handle('subscribe', () => entitlement.subscribe());
  ipcMain.handle('login', (_, email) => entitlement.login(email));

  // Auto-start hotspot after entitlement check
  const ent = await entitlement.check();
  const skipEntitlement = process.env.HOTSHARE_SKIP_ENTITLEMENT === '1';
  if (ent.granted || skipEntitlement) {
    // Self-healing WARP: health monitor + daily rotation + failback policy.
    // onFailback moves guest egress to/from the tunnel live (no hotspot restart).
    const s = settings.get();
    uplink.configureMonitor({
      probeIntervalSec: s.warpProbeIntervalSec,
      rotateCooldownMin: s.warpCooldownMin,
      failbackAllowed: s.warpFailback,
      dailyRotateHour: s.warpRotateHour,
      onEvent: (e) => {
        switch (e.type) {
          case 'reset': case 'rotate': uplinkStatus = 'busy'; break;
          case 'reset-failed': case 'rotate-failed': uplinkStatus = 'degraded'; break;
          case 'failback': uplinkStatus = 'failed-back'; break;
          case 'restored': uplinkStatus = 'ok'; break;
        }
        updateTray('tunnel-status', tunnelLabel());
      },
      onFailback: (failedBack) => {
        void hotspot.refreshEgress().catch((err) => console.error('[uplink] egress swap failed:', (err as Error).message));
      },
    });
    // If Uplink Guard was enabled before quitting, bring the tunnel back up so
    // guest egress uses it (and hotspot start fails fast otherwise).
    if (s.uplinkGuardEnabled && !uplink.isActive()) {
      try {
        await uplink.start();
        console.log('Uplink Guard auto-started (setting enabled)');
      } catch (e) {
        console.error('Uplink Guard auto-start failed:', (e as Error).message);
      }
    }
    await startHotspot();
  }
});

async function startHotspot() {
  try {
    await hotspot.start();
    await firewall.start();
  } catch (e) {
    updateTray('hotspot-status', `Hotspot: Error — ${(e as Error).message}`);
  }
  // The portal (dashboard API + captive portal) is started at app startup,
  // regardless of hotspot state, so the dashboard is always usable.
  updateTray('hotspot-status', hotspot.isRunning() ? 'Hotspot: Running' : 'Hotspot: Error');
}

async function stopHotspot() {
  // The portal keeps running (dashboard API + captive portal for guests);
  // only the hotspot itself is stopped.
  firewall.stop();
  await hotspot.stop();
  updateTray('hotspot-status', 'Hotspot: Stopped');
}

async function toggleUplink() {
  try {
    if (uplink.isActive()) {
      await uplink.stop();
    } else {
      await uplink.start();
    }
    // Move guest traffic to/from the tunnel without restarting the hotspot
    await hotspot.refreshEgress();
  } catch (e) {
    console.error('Uplink Guard toggle failed:', (e as Error).message);
  }
}

function getState() {
  return {
    hotspotActive: hotspot.isRunning(),
    internetOk: true,
    uplinkGuardEnabled: uplink.isActive(),
    clientCount: billing.getConnectedClients().filter(c => c.isConnected).length,
    maxClients: settings.get().maxClients,
  };
}

function updateTray(id: string, label: string) {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'hotshare', enabled: false },
    { type: 'separator' },
    { label: 'Show Dashboard', click: () => mainWindow?.show() },
    { label: hotspot.isRunning() ? 'Hotspot: Running' : 'Hotspot: Stopped', enabled: false, id: 'hotspot-status' },
    { label: `Clients: ${billing.getConnectedClients().filter(c => c.isConnected).length}`, enabled: false, id: 'client-count' },
    { type: 'separator' },
    { label: 'Start Sharing', click: () => startHotspot() },
    { label: 'Stop Sharing', click: () => stopHotspot() },
    { type: 'separator' },
    { label: tunnelLabel(), enabled: false, id: 'tunnel-status' },
    { label: 'Enable Uplink Guard', type: 'checkbox', checked: uplink.isActive(), click: () => toggleUplink() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

app.on('window-all-closed', () => {
  // Prevent app from quitting — keep running in system tray
});

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', async () => {
  await stopHotspot();
  if (uplink.isActive()) await uplink.stop();
  rendererServer?.stop();
});
