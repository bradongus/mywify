import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { isLinux, isWindows, SUBNET } from './platform';

const execAsync = promisify(exec);

export class FirewallEnforcer {
  private rules: Map<string, string> = new Map(); // mac → rule name (windows) or mac (linux)
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  private paidMacs: Set<string> = new Set();

  async start() {
    if (isWindows) {
      await this.startWindows();
    } else if (isLinux) {
      await this.startLinux();
    }
  }

  async stop() {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    if (isWindows) {
      await this.stopWindows();
    } else if (isLinux) {
      await this.stopLinux();
    }
    this.rules.clear();
  }

  async updatePaidMacs(macs: Set<string>) {
    for (const mac of this.paidMacs) {
      if (!macs.has(mac)) {
        if (isWindows) {
          const ruleName = this.rules.get(mac);
          if (ruleName) {
            await this.execWin(`netsh advfirewall firewall delete rule name="${ruleName}"`).catch(() => {});
            this.rules.delete(mac);
          }
        } else if (isLinux) {
          await this.unblockClientLinux(mac);
          this.rules.delete(mac);
        }
      }
    }
    this.paidMacs = macs;
  }

  async disconnectClient(mac: string) {
    if (isWindows) {
      await this.disconnectClientWindows(mac);
    } else if (isLinux) {
      await this.disconnectClientLinux(mac);
    }
  }

  async blockClient(mac: string) {
    if (isWindows) {
      await this.blockClientWindows(mac);
    } else if (isLinux) {
      await this.blockClientLinux(mac);
    }
  }

  // ──────────────────────── Windows ────────────────────────

  private async startWindows() {
    await this.execWin(`netsh advfirewall firewall add rule name="hotshare-portal" dir=in action=allow protocol=TCP localport=80 remoteip=${SUBNET}.0/24`);
    await this.execWin(`netsh advfirewall firewall add rule name="hotshare-admin" dir=in action=allow protocol=TCP localport=8080 remoteip=127.0.0.1`);
  }

  private async stopWindows() {
    for (const [, ruleName] of this.rules) {
      await this.execWin(`netsh advfirewall firewall delete rule name="${ruleName}"`).catch(() => {});
    }
    await this.execWin(`netsh advfirewall firewall delete rule name="hotshare-portal"`).catch(() => {});
    await this.execWin(`netsh advfirewall firewall delete rule name="hotshare-admin"`).catch(() => {});
  }

  private async disconnectClientWindows(mac: string) {
    const ruleName = `hotshare-block-${mac.replace(/:/g, '-')}`;
    await this.execWin(`netsh advfirewall firewall add rule name="${ruleName}" dir=in action=block remoteip=${SUBNET}.0/24`).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    await this.execWin(`netsh advfirewall firewall delete rule name="${ruleName}"`).catch(() => {});
  }

  private async blockClientWindows(mac: string) {
    const ruleName = `hotshare-block-${mac.replace(/:/g, '-')}`;
    if (!this.rules.has(mac)) {
      await this.execWin(`netsh advfirewall firewall add rule name="${ruleName}" dir=in action=block remoteip=${SUBNET}.0/24`);
      this.rules.set(mac, ruleName);
    }
  }

  private async execWin(cmd: string): Promise<string> {
    const { stdout } = await execAsync(cmd, { timeout: 10000 });
    return stdout;
  }

  // ──────────────────────── Linux ────────────────────────

  private async startLinux() {
    // Portal port 80 — allow from AP subnet
    await this.execLinux(`iptables -A INPUT -i wlanAp -p tcp --dport 80 -j ACCEPT`);
    // Admin port 8080 — allow from localhost only
    await this.execLinux(`iptables -A INPUT -i lo -p tcp --dport 8080 -j ACCEPT`);
  }

  private async stopLinux() {
    // Remove the rules we added (best effort)
    await this.execLinux(`iptables -D INPUT -i wlanAp -p tcp --dport 80 -j ACCEPT`).catch(() => {});
    await this.execLinux(`iptables -D INPUT -i lo -p tcp --dport 8080 -j ACCEPT`).catch(() => {});

    // Remove all hotshare-block rules
    for (const [mac] of this.rules) {
      await this.unblockClientLinux(mac);
    }
  }

  private async disconnectClientLinux(mac: string) {
    // Block for 2 seconds then unblock (force reconnect)
    await this.blockClientLinux(mac);
    await new Promise(r => setTimeout(r, 2000));
    await this.unblockClientLinux(mac);
  }

  private async blockClientLinux(mac: string) {
    if (!this.rules.has(mac)) {
      // Drop all packets from this MAC on the AP interface
      await this.execLinux(`iptables -I INPUT -i wlanAp -m mac --mac-source ${mac} -j DROP`);
      await this.execLinux(`iptables -I FORWARD -i wlanAp -m mac --mac-source ${mac} -j DROP`);
      this.rules.set(mac, mac);
    }
  }

  private async unblockClientLinux(mac: string) {
    // Remove all DROP rules for this MAC
    // Use a loop because iptables -D only removes one rule at a time
    for (let i = 0; i < 10; i++) {
      await this.execLinux(`iptables -D INPUT -i wlanAp -m mac --mac-source ${mac} -j DROP`).catch(() => {});
      await this.execLinux(`iptables -D FORWARD -i wlanAp -m mac --mac-source ${mac} -j DROP`).catch(() => {});
    }
  }

  private async execLinux(cmd: string): Promise<string> {
    const { stdout } = await execAsync(cmd, { timeout: 10000 });
    return stdout;
  }
}
