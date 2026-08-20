import type { Entitlement } from '@hotshare/shared-core';

const API_URL = process.env.HOTSHARE_API_URL || 'https://your-project.supabase.co/functions/v1';

export class EntitlementClient {
  private deviceId: string;
  private cached: Entitlement | null = null;
  private lastCheck = 0;

  constructor() {
    this.deviceId = this.getOrCreateDeviceId();
  }

  private getOrCreateDeviceId(): string {
    // In production: read from electron-store or OS-specific identifier
    // For now: generate and persist in app data
    const fs = require('node:fs');
    const path = require('node:path');
    const { app } = require('electron');
    const idFile = path.join(app.getPath('userData'), 'device.id');

    if (fs.existsSync(idFile)) return fs.readFileSync(idFile, 'utf-8').trim();

    const prefix = process.platform === 'win32' ? 'win' : 'linux';
    const id = `${prefix}-${crypto.randomUUID()}`;
    fs.mkdirSync(path.dirname(idFile), { recursive: true });
    fs.writeFileSync(idFile, id);
    return id;
  }

  async check(): Promise<Entitlement> {
    // Cache for 6 hours
    if (this.cached && Date.now() - this.lastCheck < 6 * 60 * 60 * 1000) {
      return this.cached;
    }

    try {
      const res = await fetch(`${API_URL}/verify?device_id=${this.deviceId}`);
      const data = await res.json();
      this.cached = { granted: data.granted, status: data.status, expiresAt: data.expires_at, offlineGraceWindow: 48 * 60 * 60 * 1000, device: {} as any };
      this.lastCheck = Date.now();
      return this.cached;
    } catch (e) {
      // Offline: use cached result if within grace window
      if (this.cached) {
        const elapsed = Date.now() - this.lastCheck;
        if (elapsed < 48 * 60 * 60 * 1000) {
          return { ...this.cached, offlineGraceWindow: 48 * 60 * 60 * 1000 };
        }
      }
      // Dev mode: the license server may simply not exist yet. The skip flag
      // already bypasses enforcement — don't scare the owner with "expired".
      if (process.env.HOTSHARE_SKIP_ENTITLEMENT === '1') {
        return { granted: true, status: 'trial', expiresAt: null, offlineGraceWindow: 48 * 60 * 60 * 1000, device: {} as any };
      }
      return { granted: false, status: 'expired', expiresAt: null, offlineGraceWindow: 48 * 60 * 60 * 1000, device: {} as any };
    }
  }

  async subscribe(): Promise<string> {
    const res = await fetch(`${API_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: this.deviceId }),
    });
    const data = await res.json();
    return data.checkout_url;
  }

  async login(email: string): Promise<void> {
    await fetch(`${API_URL}/admin?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, device_id: this.deviceId }),
    });
  }

  getDeviceId(): string {
    return this.deviceId;
  }
}
