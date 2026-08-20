export interface Plan {
  id: string;
  deviceId: string;
  name: string;
  durationHours: number;
  price: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
}

export interface Voucher {
  id: string;
  code: string;
  deviceId: string;
  planId: string;
  durationHours: number;
  signature: string;
  isUsed: boolean;
  usedByMac?: string;
  usedAt?: Date;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  deviceId: string;
  voucherCode?: string;
  planId?: string;
  amount: number;
  paystackRef?: string;
  type: 'subscription' | 'voucher';
  status: 'success' | 'failed' | 'pending';
  createdAt: Date;
}

export interface ConnectedClient {
  mac: string;
  ip: string;
  isConnected: boolean;
  paid: boolean;
  expiresAt?: Date;
  planName?: string;
}

export interface DeviceState {
  deviceId: string;
  hotspotActive: boolean;
  internetOk: boolean;
  uplinkGuardEnabled: boolean;
  uplinkGuardType?: 'wireguard' | 'warp';
  clientCount: number;
  maxClients: number;
}
