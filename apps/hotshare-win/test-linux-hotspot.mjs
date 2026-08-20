#!/usr/bin/env node
/**
 * Manual test script for Linux hotspot functionality.
 * Run with: node test-linux-hotspot.mjs
 *
 * Tests:
 * 1. Platform detection
 * 2. Prerequisites check
 * 3. WiFi interface discovery
 * 4. AP interface creation
 * 5. hostapd config generation
 * 6. dnsmasq config generation
 * 7. Full start/stop cycle (if run as root)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';

const execAsync = promisify(exec);

const SUBNET = '192.168.100';

async function test(name, fn) {
  try {
    const result = await fn();
    console.log(`✅ ${name}`);
    return result;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    return null;
  }
}

console.log('=== Linux Hotspot Test ===\n');

// Test 1: Platform detection
await test('Platform is Linux', async () => {
  if (process.platform !== 'linux') throw new Error(`Expected linux, got ${process.platform}`);
});

// Test 2: Prerequisites
await test('hostapd installed', async () => {
  const { stdout } = await execAsync('command -v hostapd', { timeout: 3000 });
  if (!stdout.trim()) throw new Error('not found');
});

await test('dnsmasq installed', async () => {
  const { stdout } = await execAsync('command -v dnsmasq', { timeout: 3000 });
  if (!stdout.trim()) throw new Error('not found');
});

await test('iptables installed', async () => {
  const { stdout } = await execAsync('command -v iptables', { timeout: 3000 });
  if (!stdout.trim()) throw new Error('not found');
});

// Test 3: WiFi interface discovery
await test('WiFi interface found', async () => {
  const { stdout } = await execAsync('iw dev', { timeout: 5000 });
  const blocks = stdout.split(/(?=\s+Interface\s+)/);
  for (const block of blocks) {
    if (block.includes('type managed')) {
      const match = block.match(/Interface\s+(\w+)/);
      if (match) {
        console.log(`    → Uplink: ${match[1]}`);
        return match[1];
      }
    }
  }
  throw new Error('No managed WiFi interface found');
});

// Test 4: Generate hostapd config
await test('hostapd config generation', async () => {
  const conf = `interface=wlanAp
driver=nl80211
ctrl_interface=/run/hotshare-hostapd
ssid=hotshare-test
channel=1
hw_mode=g
ieee80211n=1
wpa=2
wpa_passphrase=hotshare123
wpa_key_mgmt=WPA-PSK
wpa_pairwise=CCMP
rsn_pairwise=CCMP
ignore_broadcast_ssid=0
`;
  const confPath = '/tmp/hotshare-test-hostapd.conf';
  fs.writeFileSync(confPath, conf);
  console.log(`    → Written to ${confPath}`);
  return confPath;
});

// Test 5: Generate dnsmasq config
await test('dnsmasq config generation', async () => {
  const conf = `interface=wlanAp
bind-interfaces
port=0
dhcp-range=${SUBNET}.100,${SUBNET}.200,255.255.255.0,12h
dhcp-option=option:router,${SUBNET}.1
dhcp-option=option:dns-server,1.1.1.1,8.8.8.8
`;
  const confPath = '/tmp/hotshare-test-dnsmasq.conf';
  fs.writeFileSync(confPath, conf);
  console.log(`    → Written to ${confPath}`);
  return confPath;
});

// Test 6: Check if wlanAp already exists
await test('AP interface status', async () => {
  try {
    const { stdout } = await execAsync('iw dev wlanAp info', { timeout: 5000 });
    if (stdout.includes('wlanAp')) {
      console.log('    → wlanAp already exists');
      return true;
    }
  } catch {
    console.log('    → wlanAp does not exist (OK)');
    return false;
  }
});

// Test 7: Full start/stop cycle (requires root)
const isRoot = process.getuid?.() === 0;
if (!isRoot) {
  console.log('\n⚠️  Not running as root — skipping live hotspot test');
  console.log('   Run with sudo to test full start/stop cycle');
} else {
  console.log('\n--- Live Hotspot Test (root) ---');

  // Stop existing hotspot if running
  await test('Stop existing hostapd', async () => {
    try { await execAsync('pkill -F /run/hostapd-wifi-hotspot.pid', { timeout: 5000 }); } catch { /* ok */ }
    try { await execAsync('pkill -F /run/dnsmasq-wifi-hotspot.pid', { timeout: 5000 }); } catch { /* ok */ }
  });

  // Create AP interface
  await test('Create AP interface', async () => {
    try { await execAsync('iw dev wlanAp del', { timeout: 5000 }); } catch { /* ok */ }
    await execAsync('iw dev wlan0 interface add wlanAp type __ap', { timeout: 5000 });
    await execAsync(`ip addr add ${SUBNET}.1/24 dev wlanAp`, { timeout: 5000 });
    await execAsync('ip link set wlanAp up', { timeout: 5000 });
  });

  // Start hostapd
  await test('Start hostapd', async () => {
    await execAsync('hostapd -B -P /run/hotshare-test-hostapd.pid /tmp/hotshare-test-hostapd.conf', { timeout: 10000 });
    console.log('    → Waiting 2s for association...');
    await new Promise(r => setTimeout(r, 2000));
    const { stdout } = await execAsync('iw dev wlanAp station dump | grep Station', { timeout: 5000 }).catch(() => ({ stdout: 'no stations yet' }));
    console.log(`    → ${stdout.trim() || 'no stations yet'}`);
  });

  // Start dnsmasq
  await test('Start dnsmasq', async () => {
    await execAsync(`dnsmasq --conf-file=/tmp/hotshare-test-dnsmasq.conf --pid-file=/run/hotshare-test-dnsmasq.pid --dhcp-leasefile=/run/hotshare-test-dnsmasq-lease.conf --interface=wlanAp`, { timeout: 10000 });
  });

  // Enable NAT
  await test('Enable IP forwarding + NAT', async () => {
    await execAsync('sysctl -w net.ipv4.ip_forward=1', { timeout: 5000 });
    await execAsync(`iptables -t nat -A POSTROUTING -o wlan0 -j MASQUERADE`, { timeout: 5000 });
    await execAsync(`iptables -A FORWARD -i wlanAp -o wlan0 -j ACCEPT`, { timeout: 5000 });
    await execAsync(`iptables -A FORWARD -i wlan0 -o wlanAp -m state --state RELATED,ESTABLISHED -j ACCEPT`, { timeout: 5000 });
  });

  // Verify
  await test('Verify hotspot is running', async () => {
    const { stdout: hostapd } = await execAsync('ps aux | grep hostapd | grep -v grep', { timeout: 5000 });
    const { stdout: dnsmasq } = await execAsync('ps aux | grep dnsmasq | grep -v grep', { timeout: 5000 });
    if (!hostapd.includes('hostapd')) throw new Error('hostapd not running');
    if (!dnsmasq.includes('dnsmasq')) throw new Error('dnsmasq not running');
    console.log('    → hostapd: running');
    console.log('    → dnsmasq: running');
  });

  console.log('\n🔌 Connect to "hotshare-test" WiFi (password: hotshare123) to test client connectivity');
  console.log('   Press Ctrl+C to stop...');

  // Wait for Ctrl+C
  await new Promise(() => {}); // hang forever until killed

  // Cleanup (runs on Ctrl+C)
  console.log('\nCleaning up...');
  try { await execAsync('pkill -F /run/hotshare-test-hostapd.pid', { timeout: 5000 }); } catch { /* ok */ }
  try { await execAsync('pkill -F /run/hotshare-test-dnsmasq.pid', { timeout: 5000 }); } catch { /* ok */ }
  try { await execAsync(`iptables -t nat -D POSTROUTING -o wlan0 -j MASQUERADE`, { timeout: 5000 }); } catch { /* ok */ }
  try { await execAsync(`iptables -D FORWARD -i wlanAp -o wlan0 -j ACCEPT`, { timeout: 5000 }); } catch { /* ok */ }
  try { await execAsync(`iptables -D FORWARD -i wlan0 -o wlanAp -m state --state RELATED,ESTABLISHED -j ACCEPT`, { timeout: 5000 }); } catch { /* ok */ }
  try { await execAsync('ip link set wlanAp down', { timeout: 5000 }); } catch { /* ok */ }
  try { await execAsync('iw dev wlanAp del', { timeout: 5000 }); } catch { /* ok */ }
  try { await execAsync('sysctl -w net.ipv4.ip_forward=0', { timeout: 5000 }); } catch { /* ok */ }
  console.log('Done.');
}
