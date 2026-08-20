import express from 'express';
import path from 'node:path';
import type { BillingEngine } from './billing';
import type { EntitlementClient } from './entitlement';
import type { SettingsStore } from './settings';
import type { HotspotController } from './hotspot';
import type { UplinkGuard } from './uplink';

export class PortalServer {
  private app = express();
  private server: ReturnType<typeof express.application.listen> | null = null;
  private billing: BillingEngine;
  private entitlement: EntitlementClient;
  private settings: SettingsStore;
  private hotspot: HotspotController;
  private uplink: UplinkGuard;

  constructor(
    billing: BillingEngine,
    entitlement: EntitlementClient,
    settings: SettingsStore,
    hotspot: HotspotController,
    uplink: UplinkGuard
  ) {
    this.billing = billing;
    this.entitlement = entitlement;
    this.settings = settings;
    this.hotspot = hotspot;
    this.uplink = uplink;
    this.setupRoutes();
  }

  // Settings writes must come from the local machine (Electron dashboard via
  // the RendererServer proxy). Hotspot guests hitting port 80 directly are on
  // the AP subnet and must not be able to change owner settings.
  private isLocal(req: express.Request): boolean {
    const ip = req.socket.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }

  private settingsResponse(req: express.Request) {
    const s = this.settings.get();
    return { ...s, password: this.isLocal(req) ? s.password : (s.password ? '••••••••' : '') };
  }

  private setupRoutes() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../../src/renderer/public')));

    // Device API (called by portal/admin SPA)
    this.app.get('/api/device/state', async (_req, res) => {
      const ent = await this.entitlement.check();
      res.json({
        platform: process.platform,
        hotspotActive: this.hotspot.isRunning(),
        internetOk: true,
        uplinkGuardEnabled: this.uplink.isActive(),
        tunnelHealth: this.uplink.getHealth(),
        clientCount: this.billing.getConnectedClients().filter(c => c.isConnected).length,
        maxClients: this.settings.get().maxClients,
      });
    });

    this.app.get('/api/device', async (_req, res) => {
      const ent = await this.entitlement.check();
      res.json({
        deviceId: this.entitlement.getDeviceId(),
        subscriptionStatus: ent.status,
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        subscriptionEndsAt: ent.expiresAt,
      });
    });

    // Settings
    this.app.get('/api/settings', (req, res) => {
      res.json(this.settingsResponse(req));
    });

    this.app.put('/api/settings', async (req, res) => {
      if (!this.isLocal(req)) {
        res.status(403).json({ error: 'Settings can only be changed from the dashboard' });
        return;
      }
      const { ssid, password, maxClients, uplinkGuardEnabled, mpesaNumber, wireguardConfig, warpRotateHour, warpFailback, warpProbeIntervalSec, warpCooldownMin } = req.body || {};
      if (ssid !== undefined && (typeof ssid !== 'string' || ssid.length < 1 || ssid.length > 32)) {
        res.status(400).json({ error: 'SSID must be 1-32 characters' });
        return;
      }
      if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 8 || password.length > 63)) {
        res.status(400).json({ error: 'Password must be 8-63 characters' });
        return;
      }
      if (maxClients !== undefined && (typeof maxClients !== 'number' || maxClients < 1 || maxClients > 50)) {
        res.status(400).json({ error: 'Max clients must be 1-50' });
        return;
      }
      if (warpRotateHour !== undefined && (typeof warpRotateHour !== 'number' || warpRotateHour < -1 || warpRotateHour > 23)) {
        res.status(400).json({ error: 'Rotation hour must be 0-23 (-1 to disable)' });
        return;
      }
      if (warpProbeIntervalSec !== undefined && (typeof warpProbeIntervalSec !== 'number' || warpProbeIntervalSec < 10 || warpProbeIntervalSec > 600)) {
        res.status(400).json({ error: 'Probe interval must be 10-600 seconds' });
        return;
      }
      if (warpCooldownMin !== undefined && (typeof warpCooldownMin !== 'number' || warpCooldownMin < 5 || warpCooldownMin > 1440)) {
        res.status(400).json({ error: 'Rotation cooldown must be 5-1440 minutes' });
        return;
      }

      if (wireguardConfig && typeof wireguardConfig === 'string') {
        this.uplink.importConfigContent(Buffer.from(wireguardConfig, 'base64').toString('utf-8'));
      }
      if (typeof uplinkGuardEnabled === 'boolean') {
        if (uplinkGuardEnabled && !this.uplink.isActive()) {
          try {
            await this.uplink.start();
          } catch (e) {
            res.status(400).json({ error: `Uplink Guard: ${(e as Error).message}` });
            return;
          }
        } else if (!uplinkGuardEnabled && this.uplink.isActive()) {
          await this.uplink.stop();
        }
      }

      this.settings.update({
        ssid,
        password: password === '' ? undefined : password,
        maxClients,
        uplinkGuardEnabled,
        mpesaNumber: typeof mpesaNumber === 'string' ? mpesaNumber : undefined,
        warpRotateHour,
        warpFailback,
        warpProbeIntervalSec,
        warpCooldownMin,
      });

      // Apply new SSID/password to the next hotspot start
      const s = this.settings.get();
      this.hotspot.updateConfig({ ssid: s.ssid, password: s.password, tunnelRequired: s.uplinkGuardEnabled });

      // Re-apply tunnel health policy (daily rotation hour, failback, timings)
      this.uplink.configureMonitor({
        probeIntervalSec: s.warpProbeIntervalSec,
        rotateCooldownMin: s.warpCooldownMin,
        failbackAllowed: s.warpFailback,
        dailyRotateHour: s.warpRotateHour,
      });

      // Move guests to/from the tunnel live when the Uplink Guard toggle
      // changed while the hotspot is running (no hotspot restart needed).
      if (this.hotspot.isRunning()) {
        try {
          await this.hotspot.refreshEgress();
        } catch (e) {
          res.status(400).json({ error: `Egress update failed: ${(e as Error).message}` });
          return;
        }
      }

      res.json({ ok: true, settings: this.settingsResponse(req) });
    });

    this.app.post('/api/settings/restart-hotspot', async (req, res) => {
      if (!this.isLocal(req)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      try {
        await this.hotspot.restart();
        res.json({ ok: true });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });

    this.app.post('/api/hotspot/toggle', async (req, res) => {
      if (!this.isLocal(req)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const { enabled } = req.body || {};
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }
      try {
        if (enabled) {
          if (this.hotspot.isRunning()) {
            res.json({ ok: true, hotspotActive: true });
            return;
          }
          await this.hotspot.start();
        } else {
          if (!this.hotspot.isRunning()) {
            res.json({ ok: true, hotspotActive: false });
            return;
          }
          await this.hotspot.stop();
        }
        res.json({ ok: true, hotspotActive: this.hotspot.isRunning() });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });

    // One-click free Cloudflare WARP setup: register + generate + write the
    // config, start the tunnel, and move guest egress onto it (all automated).
    this.app.post('/api/settings/uplink-guard/warp', async (req, res) => {
      if (!this.isLocal(req)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      try {
        await this.uplink.generateWarpConfig();
        await this.uplink.start();
        this.settings.update({ uplinkGuardEnabled: true });
        const s = this.settings.get();
        this.hotspot.updateConfig({ tunnelRequired: s.uplinkGuardEnabled });
        if (this.hotspot.isRunning()) {
          await this.hotspot.refreshEgress();
        }
        res.json({ ok: true, uplinkGuardEnabled: true });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });

    // Manual rotation: fresh WARP device + restart the tunnel. Egress is
    // unchanged (still wg0) unless the hotspot was failed back — in that case
    // the health monitor restores egress on its next successful probe.
    this.app.post('/api/settings/uplink-guard/rotate', async (req, res) => {
      if (!this.isLocal(req)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      try {
        await this.uplink.regenerateDevice();
        res.json({ ok: true, tunnelHealth: this.uplink.getHealth() });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });

    this.app.post('/api/settings/uplink-guard/toggle', async (req, res) => {
      if (!this.isLocal(req)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const { enabled } = req.body || {};
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }
      try {
        if (enabled) {
          if (!this.uplink.isConfigPresent()) {
            await this.uplink.generateWarpConfig();
          }
          if (!this.uplink.isActive()) {
            await this.uplink.start();
          }
        } else if (this.uplink.isActive()) {
          await this.uplink.stop();
        }
        this.settings.update({ uplinkGuardEnabled: enabled });
        const s = this.settings.get();
        this.hotspot.updateConfig({ tunnelRequired: s.uplinkGuardEnabled });
        if (this.hotspot.isRunning()) {
          await this.hotspot.refreshEgress();
        }
        res.json({ ok: true, uplinkGuardEnabled: enabled, tunnelHealth: this.uplink.getHealth() });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });

    // Plans
    this.app.get('/api/plans', (_req, res) => {
      res.json(this.billing.getPlans());
    });

    this.app.post('/api/plans', (req, res) => {
      try {
        const plan = this.billing.createPlan(req.body);
        res.json(plan);
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });

    this.app.put('/api/plans/:id', (req, res) => {
      this.billing.updatePlan(req.params.id, req.body);
      res.json({ ok: true });
    });

    this.app.delete('/api/plans/:id', (req, res) => {
      this.billing.deletePlan(req.params.id);
      res.json({ ok: true });
    });

    // Vouchers
    this.app.get('/api/vouchers', (_req, res) => {
      res.json(this.billing.getVouchers());
    });

    this.app.post('/api/vouchers/generate', (req, res) => {
      try {
        const codes = this.billing.generateVouchers(req.body.planId, req.body.count);
        res.json({ vouchers: codes, count: codes.length });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });

    this.app.delete('/api/vouchers/:id', (req, res) => {
      this.billing.deactivateVoucher(req.params.id);
      res.json({ ok: true });
    });

    // Clients
    this.app.get('/api/clients', (_req, res) => {
      res.json(this.billing.getConnectedClients());
    });

    this.app.post('/api/clients/:mac/disconnect', (req, res) => {
      res.json({ ok: true }); // Handled by firewall module
    });

    this.app.post('/api/clients/:mac/block', (req, res) => {
      res.json({ ok: true }); // Handled by firewall module
    });

    // Revenue
    this.app.get('/api/revenue', (req, res) => {
      res.json(this.billing.getRevenue(req.query.period as string || '30d'));
    });

    this.app.get('/api/transactions', (_req, res) => {
      res.json([]); // TODO: implement
    });

    // Portal voucher redemption
    this.app.post('/api/portal/redeem', (req, res) => {
      const { code } = req.body;
      const mac = req.headers['x-client-mac'] as string || 'unknown';
      const result = this.billing.redeemCode(code, mac);
      res.json(result);
    });

    this.app.get('/api/portal/status', (req, res) => {
      const mac = req.headers['x-client-mac'] as string || '';
      const clients = this.billing.getConnectedClients();
      const client = clients.find(c => c.mac === mac);
      res.json({
        paid: client?.paid || false,
        expiresAt: client?.expiresAt,
      });
    });

    // Auth is now handled by Supabase directly from the SPA
  }

  start(port: number = 80): Promise<number> {
    return new Promise((resolve) => {
      const tryListen = (p: number) => {
        const srv = this.app.listen(p, '0.0.0.0');
        srv.on('error', (e) => {
          const code = (e as NodeJS.ErrnoException).code;
          if (code === 'EADDRINUSE' || code === 'EACCES') {
            console.error(
              `Port ${p} is busy or restricted` +
                (p === 80 ? ' (another hotshare instance or service?)' : '') +
                ' — binding to a random free port.'
            );
            tryListen(0);
          } else {
            console.error(`Portal server failed to start: ${(e as Error).message}`);
            resolve(0);
          }
        });
        srv.on('listening', () => {
          this.server = srv;
          const actual = p || (srv.address() as { port: number }).port;
          console.log(`Portal server running on port ${actual}`);
          resolve(actual);
        });
      };
      tryListen(port);
    });
  }

  stop() {
    this.server?.close();
    this.server = null;
  }
}
