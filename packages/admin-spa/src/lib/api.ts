import type { Device, Plan, Voucher, ConnectedClient, Transaction, RevenueSummary, DeviceState, AppSettings, TunnelHealth } from './types';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  device: {
    getState: () => fetchJson<DeviceState>('/api/device/state'),
    getInfo: () => fetchJson<Device>('/api/device'),
  },
  hotspot: {
    toggle: (enabled: boolean) =>
      fetchJson<{ ok: boolean; hotspotActive: boolean }>('/api/hotspot/toggle', { method: 'POST', body: JSON.stringify({ enabled }) }),
  },
  clients: {
    list: () => fetchJson<ConnectedClient[]>('/api/clients'),
    disconnect: (mac: string) => fetchJson(`/api/clients/${mac}/disconnect`, { method: 'POST' }),
    block: (mac: string) => fetchJson(`/api/clients/${mac}/block`, { method: 'POST' }),
  },
  plans: {
    list: () => fetchJson<Plan[]>('/api/plans'),
    create: (data: Omit<Plan, 'id' | 'sortOrder'>) => fetchJson<Plan>('/api/plans', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Plan>) => fetchJson(`/api/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: string) => fetchJson(`/api/plans/${id}`, { method: 'DELETE' }),
  },
  vouchers: {
    list: () => fetchJson<Voucher[]>('/api/vouchers'),
    generate: (planId: string, count: number) => fetchJson<Voucher[]>('/api/vouchers/generate', { method: 'POST', body: JSON.stringify({ planId, count }) }),
    deactivate: (id: string) => fetchJson(`/api/vouchers/${id}`, { method: 'DELETE' }),
  },
  revenue: {
    summary: (period: string) => fetchJson<RevenueSummary>(`/api/revenue?period=${period}`),
    transactions: () => fetchJson<Transaction[]>('/api/transactions'),
  },
  portal: {
    redeem: (code: string) => fetchJson<{ success: boolean; expiresAt: string }>('/api/portal/redeem', { method: 'POST', body: JSON.stringify({ code }) }),
    status: () => fetchJson<{ paid: boolean; expiresAt?: string; timeRemaining?: string }>('/api/portal/status'),
  },
settings: {
    get: () => fetchJson<AppSettings>('/api/settings'),
    update: (data: Partial<AppSettings> & { wireguardConfig?: string }) =>
      fetchJson<{ ok: boolean; settings: AppSettings }>('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
    restartHotspot: () => fetchJson<{ ok: boolean }>('/api/settings/restart-hotspot', { method: 'POST' }),
    generateWarp: () => fetchJson<{ ok: boolean; uplinkGuardEnabled: boolean }>('/api/settings/uplink-guard/warp', { method: 'POST' }),
    rotateWarp: () => fetchJson<{ ok: boolean }>('/api/settings/uplink-guard/rotate', { method: 'POST' }),
    toggleProtection: (enabled: boolean) =>
      fetchJson<{ ok: boolean; uplinkGuardEnabled: boolean; tunnelHealth?: TunnelHealth }>('/api/settings/uplink-guard/toggle', { method: 'POST', body: JSON.stringify({ enabled }) }),
  },
};
