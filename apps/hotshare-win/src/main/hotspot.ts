import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isLinux, isWindows, createApInterface, removeApInterface, SUBNET } from './platform';
import { runHelper } from './helper';
import type { UplinkGuard } from './uplink';

const execAsync = promisify(exec);

export interface HotspotConfig {
  ssid: string;
  password: string;
  interface?: string;
  tunnelRequired?: boolean;
}

export class HotspotController {
  private running = false;
  private config: HotspotConfig;
  private hostapdProcess: ReturnType<typeof exec> | null = null;
  private dnsmasqProcess: ReturnType<typeof exec> | null = null;
  private apInterface = '';
  private uplinkInterface = '';
  private savedProfile = '';
  private uplink: UplinkGuard | null;
  private currentEgress = '';

  constructor(config: HotspotConfig, uplink: UplinkGuard | null = null) {
    this.config = config;
    this.uplink = uplink;
  }

  async start(): Promise<void> {
    if (isWindows) {
      await this.startWindows();
    } else if (isLinux) {
      await this.startLinux();
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    if (isWindows) {
      await this.stopWindows();
    } else if (isLinux) {
      await this.stopLinux();
    }
    this.running = false;
  }

  async getClients(): Promise<Array<{ mac: string; ip: string; hostname: string }>> {
    if (isWindows) {
      return this.getClientsWindows();
    } else if (isLinux) {
      return this.getClientsLinux();
    }
    return [];
  }

  isRunning(): boolean {
    return this.running;
  }

  updateConfig(cfg: Partial<HotspotConfig>): void {
    this.config = { ...this.config, ...cfg };
  }

  async restart(): Promise<void> {
    // Works even when the hotspot failed to start (e.g. leftovers from a
    // killed instance blocked it) — restart = ensure it's running with the
    // current config.
    if (this.running) await this.stop();
    await this.start();
  }

  // The interface guest traffic exits through: the WireGuard tunnel when
  // Uplink Guard is active, otherwise the Wi-Fi uplink.
  private egressInterface(): string {
    return this.uplink?.isActive() ? this.uplink.getInterface() : this.uplinkInterface;
  }

  // Re-apply the NAT/FORWARD/routing rules for a guest egress interface
  // without touching hostapd/dnsmasq — used by start() and refreshEgress().
  // Linux only: Windows Mobile Hotspot NATs via the OS default route, which
  // the WireGuard full tunnel already owns.
  private async applyEgressRules(egress: string): Promise<void> {
    if (!isLinux) return;
    await execAsync(`iptables -t nat -A POSTROUTING -s ${SUBNET}.0/24 -o ${egress} -j MASQUERADE`, { timeout: 5000 });
    await execAsync(`iptables -A FORWARD -i ${this.apInterface} -o ${egress} -j ACCEPT`, { timeout: 5000 });
    await execAsync(`iptables -A FORWARD -i ${egress} -o ${this.apInterface} -m state --state RELATED,ESTABLISHED -j ACCEPT`, { timeout: 5000 });

    const isTunnelEgress = this.uplink !== null && egress === this.uplink.getInterface();
    if (isTunnelEgress) {
      // Belt-and-braces: route the guest subnet through the tunnel's routing
      // table (wg-quick's full-tunnel rule normally covers it). Table 51820 is
      // wg-quick's default for configs without an explicit `Table =` line.
      try {
        await execAsync(`ip rule add from ${SUBNET}.0/24 lookup 51820 priority 1001`, { timeout: 5000 });
      } catch { /* already present */ }
    } else {
      try {
        await execAsync(`ip rule del from ${SUBNET}.0/24 lookup 51820 priority 1001`, { timeout: 5000 });
      } catch { /* not present */ }
      // Normalize TTL for guest traffic leaving the uplink. Many ISP routers
      // (especially mobile/carrier APs) drop packets whose TTL has been
      // decremented by an extra hop, i.e. detect Wi-Fi sharing — guests then
      // connect but get no internet while the host itself works.
      try {
        await execAsync(`iptables -t mangle -A POSTROUTING -o ${egress} -j TTL --ttl-set 64`, { timeout: 5000 });
      } catch {
        console.log('TTL normalization unavailable (xt_ttl missing) — guests may fail on networks that police sharing');
      }
    }
  }

  // Live-swap the guest egress rules when the Uplink Guard tunnel state
  // changes while the hotspot is running — guests keep their connection.
  async refreshEgress(): Promise<void> {
    if (!isLinux) return;
    if (!this.running) {
      this.currentEgress = '';
      return;
    }
    const next = this.egressInterface();
    if (next === this.currentEgress) return;
    const previous = this.currentEgress;
    this.currentEgress = next;
    console.log(`Guest egress: ${previous || 'none'} -> ${next}`);

    for (const iface of [previous, next]) {
      if (!iface) continue;
      try { await execAsync(`iptables -t nat -D POSTROUTING -s ${SUBNET}.0/24 -o ${iface} -j MASQUERADE`, { timeout: 5000 }); } catch { /* not present */ }
      try { await execAsync(`iptables -D FORWARD -i ${this.apInterface} -o ${iface} -j ACCEPT`, { timeout: 5000 }); } catch { /* not present */ }
      try { await execAsync(`iptables -D FORWARD -i ${iface} -o ${this.apInterface} -m state --state RELATED,ESTABLISHED -j ACCEPT`, { timeout: 5000 }); } catch { /* not present */ }
      try { await execAsync(`iptables -t mangle -D POSTROUTING -o ${iface} -j TTL --ttl-set 64`, { timeout: 5000 }); } catch { /* not present */ }
    }
    await this.applyEgressRules(next);
  }

  // ──────────────────────── Windows ────────────────────────

  private async startWindows(): Promise<void> {
    try {
      const stdout = await runHelper(['start'], 30000);
      console.log('Hotspot started:', stdout);
    } catch (e) {
      throw new Error(`Failed to start hotspot: ${(e as Error).message}`);
    }
  }

  private async stopWindows(): Promise<void> {
    try {
      await runHelper(['stop'], 15000);
    } catch { /* best effort */ }
  }

  private async getClientsWindows(): Promise<Array<{ mac: string; ip: string; hostname: string }>> {
    try {
      const stdout = await runHelper(['clients'], 10000);
      return JSON.parse(stdout.trim());
    } catch {
      return [];
    }
  }

  // ──────────────────────── Linux ────────────────────────

  private async startLinux(): Promise<void> {
    // A previously killed instance (SIGKILL) leaves hostapd/dnsmasq/wlanAp
    // running with the OLD config — guests then see a stale SSID and this
    // instance's own start fails (wlanAp is busy). Clean leftovers first,
    // mirroring the "cleanup before start" behavior of wifi-hotspot.
    await this.cleanupLeftovers();

    // Find uplink interface (wlan0)
    const { findWifiInterface } = await import('./platform');
    this.uplinkInterface = (await findWifiInterface()) || 'wlan0';
    console.log(`Uplink interface: ${this.uplinkInterface}`);

    // Fail fast when the owner enabled Uplink Guard but the tunnel is down —
    // silently falling back to the plain uplink would leave guests connected
    // with no internet (e.g. on AIRMAX networks that kill forwarded replies).
    if (this.config.tunnelRequired && !this.uplink?.isActive()) {
      throw new Error(
        'Uplink Guard is enabled but the WireGuard tunnel is not up — import a config and enable it in Settings first.'
      );
    }
    this.currentEgress = this.egressInterface();

    // The WiFi radio cannot run a 5 GHz managed link AND a 2.4 GHz AP at the
    // same time, so pin the client to the 2.4 GHz radio first and reuse its
    // channel for the AP. This mirrors the proven wifi-hotspot script.
    const channel = await this.pinClientTo24Ghz(this.uplinkInterface);
    console.log(`Client pinned to 2.4 GHz channel ${channel}`);

    // Create virtual AP interface
    this.apInterface = await createApInterface(this.uplinkInterface);
    console.log(`AP interface: ${this.apInterface}`);

    // Disable TX/RX offload on the AP interface (iwlwifi concurrent AP fix)
    try {
      await execAsync(
        `ethtool -K ${this.apInterface} tx off rx off tso off gso off gro off sg off`,
        { timeout: 5000 }
      );
    } catch { /* best effort */ }

    // Generate hostapd config (using the detected 2.4 GHz channel)
    const hostapdConf = this.generateHostapdConf(channel);
    const hostapdPath = path.join(os.tmpdir(), 'hotshare-hostapd.conf');
    fs.writeFileSync(hostapdPath, hostapdConf);
    console.log('hostapd config:', hostapdConf);

    // Generate dnsmasq config
    const dnsmasqConf = this.generateDnsmasqConf();
    const dnsmasqPath = path.join(os.tmpdir(), 'hotshare-dnsmasq.conf');
    fs.writeFileSync(dnsmasqPath, dnsmasqConf);
    console.log('dnsmasq config:', dnsmasqConf);

    // Start hostapd
    await execAsync(`hostapd -B -P /run/hotshare-hostapd.pid ${hostapdPath}`, { timeout: 10000 });
    console.log('hostapd started');

    // Verify hostapd actually came up (only if hostapd_cli is available)
    try {
      await execAsync('command -v hostapd_cli', { timeout: 3000 });
      const { stdout } = await execAsync(
        `hostapd_cli -i ${this.apInterface} status 2>/dev/null | grep '^state='`,
        { timeout: 5000 }
      );
      if (!stdout.includes('ENABLED')) throw new Error('hostapd not in ENABLED state');
    } catch (e) {
      // If hostapd_cli is missing we can't verify; assume hostapd started.
      // Otherwise surface the real failure.
      const msg = (e as Error).message;
      if (msg.includes('ENABLED')) {
        throw new Error(`Failed to start hostapd (${msg}) — adapter may not support concurrent AP mode`);
      }
    }

    // Start dnsmasq
    await execAsync(
      `dnsmasq --conf-file=${dnsmasqPath} --pid-file=/run/hotshare-dnsmasq.pid --dhcp-leasefile=/run/hotshare-dnsmasq-lease.conf --interface=${this.apInterface}`,
      { timeout: 10000 }
    );
    console.log('dnsmasq started');

    // Enable IP forwarding
    await execAsync('sysctl -w net.ipv4.ip_forward=1', { timeout: 5000 });

    // Route the AP subnet via the main table so guest replies use the AP gateway
    try {
      await execAsync(`ip rule add to ${SUBNET}.0/24 lookup main priority 1000`, { timeout: 5000 });
    } catch { /* may already exist */ }

    // Set up NAT for the guest subnet via the active egress: the WireGuard
    // tunnel when Uplink Guard is on (needed on networks like AIRMAX that
    // rewrite downlink replies to TTL=1 — only tunneled replies survive),
    // otherwise the Wi-Fi uplink.
    await this.applyEgressRules(this.currentEgress);
    console.log(`Guest egress: ${this.currentEgress}`);

    console.log('Linux hotspot started successfully');
  }

  // Pin the managed client to its 2.4 GHz radio so the same physical adapter
  // can also host the AP. Returns the channel the client landed on.
  private async pinClientTo24Ghz(iface: string): Promise<number> {
    const info = await execAsync(`iw dev ${iface} info`, { timeout: 5000 });
    const ssidMatch = info.stdout.match(/ssid\s+(.+)/);
    if (!ssidMatch) {
      throw new Error('Could not read current SSID — connect to Wi-Fi first');
    }
    const ssid = ssidMatch[1].trim();

    // Find the 2.4 GHz BSSID for the connected SSID via nmcli
    let bssid = '';
    try {
      const { stdout } = await execAsync(
        `nmcli -t --escape yes -f SSID,BSSID,FREQ dev wifi list 2>/dev/null`,
        { timeout: 8000 }
      );
      for (const line of stdout.split('\n')) {
        const parts = line.split(':');
        if (parts.length < 3) continue;
        const s = parts[0].replace(/\\:/g, ':');
        const freq = parts[parts.length - 1];
        if (s === ssid && /^2[0-9]{3} MHz$/.test(freq)) {
          bssid = parts.slice(1, -1).join(':');
          break;
        }
      }
    } catch { /* fall through */ }

    if (!bssid) {
      throw new Error(`No 2.4 GHz radio found for '${ssid}' — cannot start hotspot`);
    }

    // Save the original connection so we can restore it on stop
    try {
      const { stdout } = await execAsync(`nmcli -g GENERAL.CONNECTION dev show ${iface}`, { timeout: 5000 });
      this.savedProfile = stdout.trim();
      fs.writeFileSync('/run/hotshare-state', this.savedProfile);
    } catch { /* best effort */ }

    // Create a temporary connection pinned to the 2.4 GHz BSSID
    try {
      await execAsync(`nmcli con delete hotshare-ap-24`, { timeout: 5000 });
    } catch { /* may not exist */ }
    await execAsync(
      `nmcli con add type wifi con-name hotshare-ap-24 ifname ${iface} ssid "${ssid}" wifi.bssid ${bssid} connection.autoconnect no`,
      { timeout: 8000 }
    );
    await execAsync(`nmcli con up hotshare-ap-24`, { timeout: 15000 });

    // Wait for the client to land on a 2.4 GHz channel (1-14)
    let channel = 0;
    for (let i = 0; i < 20; i++) {
      const { stdout } = await execAsync(`iw dev ${iface} info 2>/dev/null`, { timeout: 5000 });
      const m = stdout.match(/channel\s+(\d+)/);
      if (m && parseInt(m[1], 10) <= 14) { channel = parseInt(m[1], 10); break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!channel) {
      throw new Error('Client did not land on 2.4 GHz — aborting hotspot start');
    }
    return channel;
  }

  // Kill hostapd/dnsmasq and undo network state left behind by a killed
  // instance. All steps are best-effort — a clean system has nothing to do.
  private async cleanupLeftovers(): Promise<void> {
    // Kill leftover daemons (pid files only exist if this app started them)
    try { await execAsync('pkill -F /run/hotshare-hostapd.pid', { timeout: 5000 }); } catch { /* none */ }
    try { await execAsync('pkill -F /run/hotshare-dnsmasq.pid', { timeout: 5000 }); } catch { /* none */ }
    await new Promise((r) => setTimeout(r, 500));

    // Remove stale iptables rules (egress may have been wlan0, wlanAp, or the
    // WireGuard tunnel from a previous instance)
    const staleEgresses = ['wlan0', 'wlanAp'];
    if (this.uplink) staleEgresses.push(this.uplink.getInterface());
    for (const egress of staleEgresses) {
      try { await execAsync(`iptables -t nat -D POSTROUTING -s ${SUBNET}.0/24 -o ${egress} -j MASQUERADE`, { timeout: 5000 }); } catch { /* not present */ }
      try { await execAsync(`iptables -D FORWARD -i wlanAp -o ${egress} -j ACCEPT`, { timeout: 5000 }); } catch { /* not present */ }
      try { await execAsync(`iptables -D FORWARD -i ${egress} -o wlanAp -m state --state RELATED,ESTABLISHED -j ACCEPT`, { timeout: 5000 }); } catch { /* not present */ }
      try { await execAsync(`iptables -t mangle -D POSTROUTING -o ${egress} -j TTL --ttl-set 64`, { timeout: 5000 }); } catch { /* not present */ }
    }
    try { await execAsync(`ip rule del to ${SUBNET}.0/24 lookup main priority 1000`, { timeout: 5000 }); } catch { /* not present */ }
    try { await execAsync(`ip rule del from ${SUBNET}.0/24 lookup 51820 priority 1001`, { timeout: 5000 }); } catch { /* not present */ }

    // Delete the stale virtual AP interface (fails with EBUSY while hostapd
    // still owns it — hence the daemon kill above comes first)
    try {
      await execAsync('ip link show wlanAp', { timeout: 5000 });
      await execAsync('ip link set wlanAp down', { timeout: 5000 });
      await execAsync('iw dev wlanAp del', { timeout: 5000 });
      console.log('Removed stale wlanAp from a previous instance');
    } catch { /* none */ }

    // Undo the 2.4 GHz pin and restore the original Wi-Fi connection
    try { await execAsync('nmcli con down hotshare-ap-24', { timeout: 5000 }); } catch { /* none */ }
    try { await execAsync('nmcli con delete hotshare-ap-24', { timeout: 5000 }); } catch { /* none */ }
    let saved = '';
    try { saved = fs.readFileSync('/run/hotshare-state', 'utf-8').trim(); } catch { /* none */ }
    try {
      if (saved) {
        await execAsync(`nmcli con up "${saved}"`, { timeout: 15000 }).catch(() => {});
        console.log(`Restored Wi-Fi connection: ${saved}`);
      }
    } catch { /* best effort */ }
    try { fs.unlinkSync('/run/hotshare-state'); } catch { /* ok */ }

    // Clean temp configs from a previous instance
    try { fs.unlinkSync(path.join(os.tmpdir(), 'hotshare-hostapd.conf')); } catch { /* ok */ }
    try { fs.unlinkSync(path.join(os.tmpdir(), 'hotshare-dnsmasq.conf')); } catch { /* ok */ }
  }

  private async stopLinux(): Promise<void> {
    // Kill dnsmasq
    try {
      await execAsync('pkill -F /run/hotshare-dnsmasq.pid', { timeout: 5000 });
    } catch { /* may not exist */ }

    // Kill hostapd
    try {
      await execAsync('pkill -F /run/hotshare-hostapd.pid', { timeout: 5000 });
    } catch { /* may not exist */ }

    // Remove iptables rules (egress may have been the tunnel or the uplink)
    const egressCandidates = [this.uplinkInterface, this.uplink?.getInterface() || '', this.currentEgress];
    for (const egress of new Set(egressCandidates)) {
      if (!egress) continue;
      try { await execAsync(`iptables -t nat -D POSTROUTING -s ${SUBNET}.0/24 -o ${egress} -j MASQUERADE`, { timeout: 5000 }); } catch { /* not present */ }
      try { await execAsync(`iptables -D FORWARD -i ${this.apInterface} -o ${egress} -j ACCEPT`, { timeout: 5000 }); } catch { /* not present */ }
      try { await execAsync(`iptables -D FORWARD -i ${egress} -o ${this.apInterface} -m state --state RELATED,ESTABLISHED -j ACCEPT`, { timeout: 5000 }); } catch { /* not present */ }
      try { await execAsync(`iptables -t mangle -D POSTROUTING -o ${egress} -j TTL --ttl-set 64`, { timeout: 5000 }); } catch { /* not present */ }
    }
    try { await execAsync(`ip rule del from ${SUBNET}.0/24 lookup 51820 priority 1001`, { timeout: 5000 }); } catch { /* not present */ }

    // Remove the AP subnet routing rule
    try {
      await execAsync(`ip rule del to ${SUBNET}.0/24 lookup main priority 1000`, { timeout: 5000 });
    } catch { /* best effort */ }

    // Disable IP forwarding
    try {
      await execAsync('sysctl -w net.ipv4.ip_forward=0', { timeout: 5000 });
    } catch { /* best effort */ }

    // Remove virtual AP interface
    await removeApInterface();

    // Restore the original Wi-Fi connection (undo the 2.4 GHz pin)
    try {
      await execAsync('nmcli con down hotshare-ap-24', { timeout: 5000 });
    } catch { /* may not exist */ }
    try {
      await execAsync('nmcli con delete hotshare-ap-24', { timeout: 5000 });
    } catch { /* may not exist */ }
    const saved = this.savedProfile || (() => { try { return fs.readFileSync('/run/hotshare-state', 'utf-8').trim(); } catch { return ''; } })();
    if (saved) {
      try {
        await execAsync(`nmcli con up "${saved}"`, { timeout: 15000 });
        console.log(`Restored Wi-Fi connection: ${saved}`);
      } catch { /* best effort */ }
    }
    try { fs.unlinkSync('/run/hotshare-state'); } catch { /* ok */ }

    // Clean up temp files
    try { fs.unlinkSync(path.join(os.tmpdir(), 'hotshare-hostapd.conf')); } catch { /* ok */ }
    try { fs.unlinkSync(path.join(os.tmpdir(), 'hotshare-dnsmasq.conf')); } catch { /* ok */ }

    console.log('Linux hotspot stopped');
  }

  private async getClientsLinux(): Promise<Array<{ mac: string; ip: string; hostname: string }>> {
    const clients: Array<{ mac: string; ip: string; hostname: string }> = [];
    try {
      // Read dnsmasq lease file
      const leaseFile = '/run/hotshare-dnsmasq-lease.conf';
      if (!fs.existsSync(leaseFile)) return [];

      const leases = fs.readFileSync(leaseFile, 'utf-8');
      for (const line of leases.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split(/\s+/);
        // Format: expiry mac ip hostname client-id
        if (parts.length >= 3) {
          clients.push({
            mac: parts[1],
            ip: parts[2],
            hostname: parts[3] || '*',
          });
        }
      }
    } catch { /* ignore */ }
    return clients;
  }

  private generateHostapdConf(channel: number = 1): string {
    return `interface=${this.apInterface}
driver=nl80211
ctrl_interface=/run/hotshare-hostapd
ssid=${this.config.ssid}
channel=${channel}
hw_mode=g
ieee80211n=1
wpa=2
wpa_passphrase=${this.config.password}
wpa_key_mgmt=WPA-PSK
wpa_pairwise=CCMP
rsn_pairwise=CCMP
ignore_broadcast_ssid=0
`;
  }

  private generateDnsmasqConf(): string {
    return `interface=${this.apInterface}
bind-interfaces
port=53
dhcp-range=${SUBNET}.100,${SUBNET}.200,255.255.255.0,12h
dhcp-option=option:router,${SUBNET}.1
dhcp-option=option:dns-server,${SUBNET}.1
`;
  }
}
