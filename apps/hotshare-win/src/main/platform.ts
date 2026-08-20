import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const isLinux = process.platform === 'linux';
export const isWindows = process.platform === 'win32';

// Subnet differs between platforms:
//   Windows hotspot uses 192.168.137.x (Windows default)
//   Linux hotspot uses 192.168.100.x (custom)
export const SUBNET = isLinux ? '192.168.100' : '192.168.137';

export async function findWifiInterface(): Promise<string | null> {
  if (!isLinux) return null;
  try {
    const { stdout } = await execAsync('iw dev', { timeout: 5000 });
    // Parse iw dev output — find Interface blocks with "type managed"
    const blocks = stdout.split(/(?=\s+Interface\s+)/);
    for (const block of blocks) {
      if (block.includes('type managed')) {
        const match = block.match(/Interface\s+(\w+)/);
        if (match) return match[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function createApInterface(uplinkIface: string): Promise<string> {
  const apIface = 'wlanAp';
  // Remove existing virtual interface if any
  try { await execAsync(`iw dev ${apIface} del`, { timeout: 5000 }); } catch { /* ignore */ }
  // Create virtual AP interface
  await execAsync(`iw dev ${uplinkIface} interface add ${apIface} type __ap`, { timeout: 5000 });
  // Assign IP and bring up
  await execAsync(`ip addr add ${SUBNET}.1/24 dev ${apIface}`, { timeout: 5000 });
  await execAsync(`ip link set ${apIface} up`, { timeout: 5000 });
  return apIface;
}

export async function removeApInterface(): Promise<void> {
  try {
    await execAsync('ip link set wlanAp down', { timeout: 5000 });
    await execAsync('iw dev wlanAp del', { timeout: 5000 });
  } catch { /* ignore — may not exist */ }
}

export async function checkPrerequisites(): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const cmd of ['hostapd', 'dnsmasq', 'iptables']) {
    try {
      await execAsync(`command -v ${cmd}`, { timeout: 3000 });
    } catch {
      missing.push(cmd);
    }
  }
  // Check if WiFi adapter supports AP mode
  try {
    const { stdout } = await execAsync('iw list 2>/dev/null | grep -A 10 "Supported interface modes" | grep "AP"', { timeout: 5000 });
    if (!stdout.includes('AP')) missing.push('AP mode not supported by WiFi adapter');
  } catch {
    missing.push('Could not verify AP mode support');
  }
  return { ok: missing.length === 0, missing };
}
