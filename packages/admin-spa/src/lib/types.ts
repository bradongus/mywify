export type SubscriptionStatus = 'trial' | 'active' | 'expired';

export interface Device {
  id: string;
  deviceId: string;
  ownerPhone?: string;
  ownerEmail?: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string;
  subscriptionEndsAt?: string;
}

export interface Plan {
  id: string;
  name: string;
  durationHours: number;
  price: number;
  isActive: boolean;
  sortOrder: number;
}

export interface Voucher {
  id: string;
  code: string;
  planName: string;
  durationHours: number;
  isUsed: boolean;
  usedByMac?: string;
  usedAt?: string;
  createdAt: string;
}

export interface ConnectedClient {
  mac: string;
  ip: string;
  isConnected: boolean;
  paid: boolean;
  expiresAt?: string;
  planName?: string;
}

export interface Transaction {
  id: string;
  voucherCode?: string;
  planName?: string;
  amount: number;
  type: 'subscription' | 'voucher';
  status: 'success' | 'failed' | 'pending';
  createdAt: string;
}

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

export interface DeviceState {
  platform?: string;
  hotspotActive: boolean;
  internetOk: boolean;
  uplinkGuardEnabled: boolean;
  tunnelHealth?: TunnelHealth;
  clientCount: number;
  maxClients: number;
}

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

export interface RevenueSummary {
  totalRevenue: number;
  totalClients: number;
  avgPerClient: number;
  byPlan: { name: string; revenue: number; percentage: number }[];
}
