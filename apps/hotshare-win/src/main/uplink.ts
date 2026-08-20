import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { runHelper, runElevated } from './helper';

const execAsync = promisify(exec);

export interface TunnelHealth {
  connected: boolean;
  degraded: boolean;
  failedBack: boolean;
  interface?: string;
  handshakeAgeSec?: number;
  bytesReceived?: number;
  bytesSent?: number;
  resetsToday: number;
  rotationsToday: number;
  failbacksToday: number;
  lastEvent?: { type: string; ts: string };
}

export interface UplinkMonitorOptions {
  // How often the tunnel is probed through wg0 (seconds). Default 30.
  probeIntervalSec?: number;
  // Consecutive failed probes before recovery starts. Default 3 (~90s).
  resetAfterFailures?: number;
  // Minimum time between device rotations (minutes). Default 60.
  rotateCooldownMin?: number;
  // Move guests to the direct uplink when the tunnel is unrecoverable.
  failbackAllowed?: boolean;
  // Minimum time between failbacks (minutes). Default 30.
  failbackCooldownMin?: number;
  // Rotate to a fresh WARP device daily at this local hour (0-23); -1 disables.
  dailyRotateHour?: number;
  // Called for every monitor event (reset/rotate/failback/restored).
  onEvent?: (event: { type: string; message: string; ts: string }) => void;
  // Called when the guest egress must move to/from the tunnel.
  onFailback?: (failedBack: boolean) => void;
}

const DEFAULT_MONITOR_OPTS: Required<Omit<UplinkMonitorOptions, 'onEvent' | 'onFailback'>> = {
  probeIntervalSec: 30,
  resetAfterFailures: 3,
  rotateCooldownMin: 60,
  failbackAllowed: true,
  failbackCooldownMin: 30,
  dailyRotateHour: 3,
};

export class UplinkGuard {
  private active = false;
  private configPath: string;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private tickBusy = false;
  private probeFailures = 0;
  private degraded = false;
  private failedBack = false;
  private lastResetAt = 0;
  private lastRotateAt = 0;
  private lastFailbackAt = 0;
  private lastDailyRotate = 0;
  private startedAt = 0;
  private resetsToday = 0;
  private rotationsToday = 0;
  private failbacksToday = 0;
  private lastEvent: { type: string; ts: string } | undefined;
  private dayMarker = '';
  private opts: Required<Omit<UplinkMonitorOptions, 'onEvent' | 'onFailback'>> = DEFAULT_MONITOR_OPTS;
  private onEvent?: (event: { type: string; message: string; ts: string }) => void;
  private onFailback?: (failedBack: boolean) => void;

  constructor() {
    const home = process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME;
    this.configPath = path.join(home || '', '.hotshare', 'wg0.conf');
  }

  isActive(): boolean {
    return this.active;
  }

  getInterface(): string {
    return 'wg0';
  }

  // WireGuard's CLI needs admin to read tunnel state on Windows, so status
  // reads are routed through the elevated wrapper there. Linux/macOS read
  // directly (the app runs as root / wg is on PATH).
  private async wgStatus(args: string[]): Promise<string> {
    if (process.platform === 'win32') {
      return runElevated(`"${this.wgCli('wg')}"`, args, 10000);
    }
    const { stdout } = await execAsync(`${this.wgCli('wg')} ${args.join(' ')}`, { timeout: 10000 });
    return stdout;
  }

  isConfigPresent(): boolean {
    return fs.existsSync(this.configPath);
  }

  // Merge monitor options (numbers merge, callbacks are set once by the app boot).
  configureMonitor(opts: UplinkMonitorOptions): void {
    this.opts = { ...DEFAULT_MONITOR_OPTS, ...this.opts, ...opts };
    if (opts.onEvent) this.onEvent = opts.onEvent;
    if (opts.onFailback) this.onFailback = opts.onFailback;
    this.rollCounters();
  }

  private rollCounters(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dayMarker) {
      this.dayMarker = today;
      this.resetsToday = 0;
      this.rotationsToday = 0;
      this.failbacksToday = 0;
    }
  }

  private emit(type: string, message: string): void {
    const event = { type, message, ts: new Date().toISOString() };
    this.lastEvent = { type, ts: event.ts };
    console.log(`[uplink] ${message}`);
    this.onEvent?.(event);
  }

  // Locate the bundled wgcf binary (dev: apps/hotshare-win/bin; packaged:
  // resources/bin). Platform-specific: wgcf-linux-x64 / wgcf-windows-x64.exe.
  private wgcfBinary(): string {
    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : '';
    const arch = process.arch === 'x64' ? 'x64' : '';
    if (!osName || !arch) {
      throw new Error('Automatic WARP setup is unavailable on this platform — import a WireGuard config instead.');
    }
    const fileName = `wgcf-${osName}-${arch}${osName === 'windows' ? '.exe' : ''}`;
    const candidates = [
      path.join(__dirname, '../../bin', fileName),
      path.join(process.resourcesPath || '', 'bin', fileName),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`wgcf binary not found (${fileName}) — free WARP setup is unavailable on this build`);
  }

  // Resolve the WireGuard CLI on Windows (installed to %ProgramFiles%\WireGuard
  // by the MSI). On Linux/macOS plain 'wg'/'wireguard' is on PATH.
  private wgCli(program: 'wg' | 'wireguard'): string {
    if (process.platform !== 'win32') return program;
    const exe = program === 'wg' ? 'wg.exe' : 'wireguard.exe';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const candidates = [path.join(programFiles, 'WireGuard', exe), exe];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return exe; // fall back to PATH lookup (WireGuard MSI adds it)
  }

  // One-click free WARP setup: register an anonymous Cloudflare account (once,
  // the account file is kept for regeneration), generate a full-tunnel WireGuard
  // profile, write it to the app's config path. `DNS =` is stripped on Linux
  // (wg-quick 1.0.20260223 hard-fails when DNS is set and the box has no
  // resolvconf/resolvectl); Windows keeps it — the WireGuard client owns DNS.
  async generateWarpConfig(): Promise<void> {
    const binary = this.wgcfBinary();
    const workdir = path.dirname(this.configPath);
    fs.mkdirSync(workdir, { recursive: true });

    try {
      const accountFile = path.join(workdir, 'wgcf-account.toml');
      if (!fs.existsSync(accountFile)) {
        const { stderr } = await execAsync(
          `"${binary}" register --accept-tos`,
          { timeout: 90000, cwd: workdir, windowsHide: true }
        );
        if (!fs.existsSync(accountFile)) {
          throw new Error(`wgcf register failed: ${stderr || 'no account file produced'}`);
        }
        console.log('WARP: registered anonymous Cloudflare account');
      }

      const { stderr } = await execAsync(
        `"${binary}" generate`,
        { timeout: 60000, cwd: workdir, windowsHide: true }
      );
      const profilePath = path.join(workdir, 'wgcf-profile.conf');
      if (!fs.existsSync(profilePath)) {
        throw new Error(`wgcf generate failed: ${stderr || 'no profile produced'}`);
      }

      // Strip DNS lines on Linux — wg-quick 1.0.20260223 hard-fails when DNS is
      // set and this box has no resolvconf/resolvectl. Guest DNS is unaffected:
      // dnsmasq at 192.168.100.1 forwards to the system resolvers through the
      // tunnel. On Windows the WireGuard client handles DNS natively.
      const raw = fs.readFileSync(profilePath, 'utf-8');
      const stripped = process.platform === 'win32'
        ? raw
        : raw.split('\n').filter((line) => !/^\s*DNS\s*=/.test(line)).join('\n');

      fs.writeFileSync(this.configPath, stripped, { mode: 0o600 });
      fs.unlinkSync(profilePath);
      console.log(`WARP: WireGuard config written to ${this.configPath}`);
    } catch (e) {
      throw new Error(`WARP setup failed: ${(e as Error).message}`);
    }
  }

  async start(): Promise<void> {
    const conf = this.configPath;
    if (!fs.existsSync(conf)) throw new Error('No WireGuard config found. Import a .conf file first.');

    try {
      if (process.platform === 'win32') {
        await this.ensureWindowsDriver();
        await this.windowsService('start');
      } else {
        await execAsync(`wg-quick up "${conf}"`, { timeout: 30000 });
      }
      this.active = true;
      this.startedAt = Date.now();
      this.ensureMonitor();
    } catch (e) {
      throw new Error(`Failed to start WireGuard: ${(e as Error).message}`);
    }
  }

  // First run on Windows: silently install the bundled WireGuard driver
  // (elevated via the C# helper / MSI) before the tunnel service exists.
  private async ensureWindowsDriver(): Promise<void> {
    if (process.platform !== 'win32') return;
    const progFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    if (fs.existsSync(path.join(progFiles, 'WireGuard', 'wireguard.exe'))) return;

    let msi: string | undefined;
    for (const dir of [path.join(__dirname, '../../bin'), path.join(process.resourcesPath || '', 'bin')]) {
      try {
        const found = fs.readdirSync(dir).find((f) => /^wireguard-.*\.msi$/i.test(f));
        if (found) { msi = path.join(dir, found); break; }
      } catch { /* not present */ }
    }

    if (!msi) {
      throw new Error('WireGuard is not installed and the bundled driver was not found — install WireGuard from https://www.wireguard.com/install/');
    }
    const stdout = await runHelper(['wireguard-install', '--msi', msi], 300000);
    console.log(`[uplink] WireGuard driver: ${stdout.trim()}`);
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    try {
      if (process.platform === 'win32') {
        await this.windowsService('stop');
      } else {
        await execAsync(`wg-quick down "${this.configPath}"`, { timeout: 15000 });
      }
    } catch {
      // Best effort
    }
    this.active = false;
    this.probeFailures = 0;
    this.degraded = false;
  }

  // Windows: the tunnel runs as a Windows service managed by WireGuard's CLI.
  // The tunnel name is derived from the config file basename (wg0.conf → wg0),
  // and the service is "WireGuardTunnel$<name>". Install takes the config path
  // only; start/uninstall take the tunnel name. Linux uses wg-quick instead.
  private windowsTunnelName(): string {
    return path.basename(this.configPath).replace(/\.conf$/i, '');
  }

  private async windowsService(action: 'start' | 'stop'): Promise<void> {
    const wg = this.wgCli('wireguard');
    const name = this.windowsTunnelName();
    // WireGuard's CLI needs admin to install/start/stop the tunnel service
    // (it writes under Program Files / creates a Windows service), so route it
    // through the elevated wrapper. Output is captured to temp files.
    const elevated = (args: string[]) => runElevated(`"${wg}"`, args, 60000);
    if (action === 'start') {
      const { stdout } = await execAsync(`sc query "WireGuardTunnel$${name}"`, { timeout: 10000 }).catch(() => ({ stdout: '' }));
      // Already running — nothing to do (the tunnel is up). Avoids an
      // unnecessary elevated call that would pop UAC on every boot.
      if (/STATE\s*:\s*4\s+RUNNING/.test(stdout)) return;
      if (/STATE\s*:\s*1\s+STOPPED/.test(stdout)) {
        await elevated([`/starttunnelservice`, name]);
      } else {
        await elevated([`/installtunnelservice`, this.configPath]);
      }
    } else {
      await elevated([`/uninstalltunnelservice`, name]);
    }
  }

  async restart(): Promise<void> {
    const wasActive = this.active;
    try {
      await this.stop();
      if (wasActive) await this.start();
    } catch (e) {
      throw new Error(`Tunnel restart failed: ${(e as Error).message}`);
    }
  }

  // Rotate to a brand-new WARP device: tear down, forget the old account
  // (fresh wgcf registration = fresh identity), generate a new config, bring
  // the tunnel back up. The old account file is restored if generation fails
  // so a later rotation still has a valid identity to work from.
  async regenerateDevice(): Promise<void> {
    const workdir = path.dirname(this.configPath);
    const accountFile = path.join(workdir, 'wgcf-account.toml');
    fs.mkdirSync(workdir, { recursive: true });

    await this.stop();
    if (fs.existsSync(accountFile)) {
      fs.renameSync(accountFile, path.join(workdir, 'wgcf-account.toml.old'));
    }
    try {
      await this.generateWarpConfig();
      await this.start();
    } catch (e) {
      try {
        if (!fs.existsSync(accountFile) && fs.existsSync(path.join(workdir, 'wgcf-account.toml.old'))) {
          fs.renameSync(path.join(workdir, 'wgcf-account.toml.old'), accountFile);
        }
      } catch { /* best effort */ }
      throw new Error(`Device rotation failed: ${(e as Error).message}`);
    }
  }

  importConfig(sourcePath: string): void {
    const dir = path.dirname(this.configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(sourcePath, this.configPath);
  }

  importConfigContent(content: string): void {
    const dir = path.dirname(this.configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.configPath, content, { mode: 0o600 });
  }

  async getStatus(): Promise<{ connected: boolean; interface?: string; bytesReceived?: number; bytesSent?: number }> {
    if (!this.active) return { connected: false };
    try {
      const stdout = await this.wgStatus(['show', this.getInterface(), 'transfer']);
      const lines = stdout.trim().split('\n');
      if (lines.length > 0) {
        const parts = lines[0].split('\t');
        return {
          connected: true,
          interface: this.getInterface(),
          bytesReceived: parseInt(parts[0]) || 0,
          bytesSent: parseInt(parts[1]) || 0,
        };
      }
    } catch {}
    return { connected: this.active };
  }

  getHealth(): TunnelHealth {
    const health: TunnelHealth = {
      connected: this.active,
      degraded: this.degraded,
      failedBack: this.failedBack,
      resetsToday: this.resetsToday,
      rotationsToday: this.rotationsToday,
      failbacksToday: this.failbacksToday,
      lastEvent: this.lastEvent,
    };
    if (this.active) health.interface = this.getInterface();
    return health;
  }

  // ──────────────────────── health monitor ────────────────────────

  private ensureMonitor(): void {
    if (this.monitorTimer) return;
    const intervalMs = Math.max(1000, this.opts.probeIntervalSec * 1000);
    this.monitorTimer = setInterval(() => void this.monitorTick(), intervalMs);
    void this.monitorTick();
  }

  async getHandshakeAgeSec(): Promise<number | undefined> {
    if (process.platform === 'win32') {
      // `wg show` needs admin on Windows; the tunnel service state is the
      // reliable liveness signal and is readable without elevation.
      try {
        const { stdout } = await execAsync(`sc query "WireGuardTunnel$${this.windowsTunnelName()}"`, { timeout: 5000 }).catch(() => ({ stdout: '' }));
        return /STATE\s*:\s*4\s+RUNNING/.test(stdout) ? 0 : undefined;
      } catch {
        return undefined;
      }
    }
    try {
      const stdout = await this.wgStatus(['show', this.getInterface(), 'latest-handshakes']);
      const line = stdout.trim().split('\n').find(Boolean);
      if (!line) return undefined;
      const parts = line.split('\t');
      if (parts.length < 2) return undefined;
      const ts = parseInt(parts[1], 10);
      if (!ts) return undefined;
      return Math.max(0, Math.round(Date.now() / 1000) - ts);
    } catch {
      return undefined;
    }
  }

  async getTransferBytes(): Promise<{ bytesReceived?: number; bytesSent?: number }> {
    try {
      const stdout = await this.wgStatus(['show', this.getInterface(), 'transfer']);
      const parts = (stdout.trim().split('\n').find(Boolean) || '').split('\t');
      return {
        bytesReceived: parts[0] ? parseInt(parts[0], 10) : undefined,
        bytesSent: parts[1] ? parseInt(parts[1], 10) : undefined,
      };
    } catch {
      return {};
    }
  }

  // Does the tunnel actually carry traffic? Handshake fresh AND connectivity
  // through the interface. Everything through wg0 — the host's own path is
  // immune to the ISP's forwarded-traffic policy.
  private async probeTunnel(): Promise<boolean> {
    try {
      const age = await this.getHandshakeAgeSec();
      if (age === undefined || age > 180) return false;
      try {
        if (process.platform === 'win32') {
          // Windows: bind to the tunnel's local address so the probe rides wg0
          // (curl --interface accepts an IP). NUL is the null device there.
          const ip = this.windowsTunnelIp();
          await execAsync(
            `curl --interface ${ip} --max-time 8 -sS -o NUL https://1.1.1.1`,
            { timeout: 15000 }
          );
        } else {
          await execAsync(
            `curl --interface ${this.getInterface()} --max-time 8 -sS -o /dev/null https://1.1.1.1`,
            { timeout: 15000 }
          );
        }
      } catch {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // Parse the tunnel's IPv4 from the config (Address = 172.16.0.2/32, ...).
  private windowsTunnelIp(): string {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const m = raw.match(/^\s*Address\s*=\s*([^,\s/]+)/m);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  private async monitorTick(): Promise<void> {
    if (this.tickBusy) return;
    this.tickBusy = true;
    try {
      this.rollCounters();
      if (!this.active) return;
      this.dailyRotateIfDue();

      const ok = await this.probeTunnel();
      if (ok) {
        this.probeFailures = 0;
        if (this.degraded || this.failedBack) {
          this.failedBack = false;
          this.degraded = false;
          this.emit('restored', 'Tunnel healthy — guests moved back to the tunnel');
          this.onFailback?.(false);
        }
        return;
      }

      // Grace period: on Windows the tunnel service takes a few seconds to
      // establish its handshake after start; don't treat those early probes as
      // failures (they'd trigger a needless reset that pops UAC).
      if (Date.now() - this.startedAt < 30_000) return;

      this.probeFailures++;
      if (this.failedBack) {
        await this.attemptRestore();
        return;
      }
      if (this.probeFailures < this.opts.resetAfterFailures) return;
      this.probeFailures = 0;
      await this.recover();
    } catch (e) {
      console.error('[uplink] monitor tick failed:', (e as Error).message);
    } finally {
      this.tickBusy = false;
    }
  }

  // Recovery ladder: reset tunnel → rotate device → failback to direct uplink.
  private async recover(): Promise<void> {
    this.degraded = true;

    // Step 1: a plain restart clears transient blocks.
    if (Date.now() - this.lastResetAt > 60_000) {
      this.lastResetAt = Date.now();
      this.resetsToday++;
      this.emit('reset', 'Tunnel degraded — restarting tunnel');
      try {
        await this.restart();
      } catch (e) {
        this.emit('reset-failed', `Tunnel restart failed: ${(e as Error).message}`);
      }
      return;
    }

    // Step 2: rotate to a fresh WARP device (respect cooldown).
    const rotateCd = this.opts.rotateCooldownMin * 60_000;
    if (Date.now() - this.lastRotateAt > rotateCd) {
      this.lastRotateAt = Date.now();
      this.rotationsToday++;
      this.emit('rotate', 'Tunnel still failing — rotating to a fresh WARP device');
      try {
        await this.regenerateDevice();
      } catch (e) {
        this.emit('rotate-failed', (e as Error).message);
      }
      return;
    }

    // Step 3: failback — guests move to the direct uplink (works on normal
    // ISPs; on AIRMAX-like networks it stays broken, so the owner sees the
    // alert in the dashboard).
    const failbackCd = this.opts.failbackCooldownMin * 60_000;
    if (this.opts.failbackAllowed && Date.now() - this.lastFailbackAt > failbackCd) {
      this.lastFailbackAt = Date.now();
      this.failbacksToday++;
      this.failedBack = true;
      this.emit('failback', 'Tunnel unrecoverable — guests moved to the direct uplink. Internet may be limited.');
      this.onFailback?.(true);
    }
  }

  // While failed back, keep retrying: bring the interface up, and try a fresh
  // device once the rotation cooldown allows. Restores egress on success.
  private async attemptRestore(): Promise<void> {
    const ok = await this.probeTunnel();
    if (!ok) {
      try {
        const ifaces = await this.wgStatus(['show', 'interfaces']).catch(() => '');
        if (!ifaces.includes(this.getInterface())) await this.start();
      } catch { /* best effort */ }
      const rotateCd = this.opts.rotateCooldownMin * 60_000;
      if (Date.now() - this.lastRotateAt > rotateCd) {
        this.lastRotateAt = Date.now();
        this.rotationsToday++;
        this.emit('rotate', 'Retrying with a fresh WARP device after failback');
        try {
          await this.regenerateDevice();
        } catch (e) {
          this.emit('rotate-failed', (e as Error).message);
        }
      }
      return;
    }
    this.failedBack = false;
    this.degraded = false;
    this.probeFailures = 0;
    this.emit('restored', 'Tunnel healthy — guests moved back to the tunnel');
    this.onFailback?.(false);
  }

  // Proactive daily rotation at warpRotateHour (default 3 AM, shop closed):
  // a fresh device every day dodges per-device usage caps entirely.
  private dailyRotateIfDue(): void {
    const hour = this.opts.dailyRotateHour;
    if (hour < 0 || hour > 23 || !this.active || this.failedBack) return;
    const now = new Date();
    if (now.getHours() !== hour) return;
    // Rotate at most once per day, and not within an hour of a manual/health
    // rotation (avoids double-rotating right after a recovery).
    if (now.getTime() - this.lastDailyRotate < 3600_000) return;
    const today = now.toISOString().slice(0, 10);
    if (new Date(this.lastDailyRotate).toISOString().slice(0, 10) === today) return;
    this.lastDailyRotate = now.getTime();
    this.rotationsToday++;
    this.emit('rotate', `Daily rotation ${today} — fresh WARP device`);
    void this.regenerateDevice().catch((e) => this.emit('rotate-failed', `Daily rotation failed: ${(e as Error).message}`));
  }
}