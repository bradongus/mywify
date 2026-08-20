import Database from 'better-sqlite3';

export interface AppSettings {
  ssid: string;
  password: string;
  maxClients: number;
  uplinkGuardEnabled: boolean;
  mpesaNumber: string;
  warpRotateHour: number;
  warpFailback: boolean;
  warpProbeIntervalSec: number;
  warpCooldownMin: number;
}

const DEFAULTS: AppSettings = {
  ssid: 'hotshare',
  password: 'hotshare123',
  maxClients: 5,
  uplinkGuardEnabled: false,
  mpesaNumber: '',
  warpRotateHour: 3,
  warpFailback: true,
  warpProbeIntervalSec: 30,
  warpCooldownMin: 60,
};

export class SettingsStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  get(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return {
      ssid: out.ssid ?? DEFAULTS.ssid,
      password: out.password ?? DEFAULTS.password,
      maxClients: out.maxClients !== undefined ? parseInt(out.maxClients, 10) : DEFAULTS.maxClients,
      uplinkGuardEnabled: out.uplinkGuardEnabled === 'true',
      mpesaNumber: out.mpesaNumber ?? DEFAULTS.mpesaNumber,
      warpRotateHour: out.warpRotateHour !== undefined ? parseInt(out.warpRotateHour, 10) : DEFAULTS.warpRotateHour,
      warpFailback: out.warpFailback === undefined ? DEFAULTS.warpFailback : out.warpFailback === 'true',
      warpProbeIntervalSec: out.warpProbeIntervalSec !== undefined ? parseInt(out.warpProbeIntervalSec, 10) : DEFAULTS.warpProbeIntervalSec,
      warpCooldownMin: out.warpCooldownMin !== undefined ? parseInt(out.warpCooldownMin, 10) : DEFAULTS.warpCooldownMin,
    };
  }

  update(partial: Partial<AppSettings>): AppSettings {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const tx = this.db.transaction(() => {
      if (partial.ssid !== undefined) stmt.run('ssid', partial.ssid);
      if (partial.password !== undefined) stmt.run('password', partial.password);
      if (partial.maxClients !== undefined) stmt.run('maxClients', String(partial.maxClients));
      if (partial.uplinkGuardEnabled !== undefined) stmt.run('uplinkGuardEnabled', String(partial.uplinkGuardEnabled));
      if (partial.mpesaNumber !== undefined) stmt.run('mpesaNumber', partial.mpesaNumber);
      if (partial.warpRotateHour !== undefined) stmt.run('warpRotateHour', String(partial.warpRotateHour));
      if (partial.warpFailback !== undefined) stmt.run('warpFailback', String(partial.warpFailback));
      if (partial.warpProbeIntervalSec !== undefined) stmt.run('warpProbeIntervalSec', String(partial.warpProbeIntervalSec));
      if (partial.warpCooldownMin !== undefined) stmt.run('warpCooldownMin', String(partial.warpCooldownMin));
    });
    tx();
    return this.get();
  }
}
