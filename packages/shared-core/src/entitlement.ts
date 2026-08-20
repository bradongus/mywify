export type SubscriptionStatus = 'trial' | 'active' | 'expired';

export interface Device {
  id: string;
  deviceId: string;
  ownerPhone?: string;
  ownerEmail?: string;
  activatedAt: Date;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date;
  subscriptionEndsAt?: Date;
  paystackCustomerId?: string;
  paystackSubscriptionId?: string;
  lastVerifyAt?: Date;
}

export interface Entitlement {
  granted: boolean;
  status: SubscriptionStatus;
  expiresAt: Date | null;
  offlineGraceWindow: number; // ms
  device: Device;
}

const OFFLINE_GRACE_MS = 48 * 60 * 60 * 1000; // 48 hours
const TRIAL_DAYS = 30;

export function createTrialDevice(deviceId: string, ownerPhone?: string, ownerEmail?: string): Device {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    deviceId,
    ownerPhone,
    ownerEmail,
    activatedAt: now,
    subscriptionStatus: 'trial',
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
  };
}

export function checkEntitlement(device: Device, now: Date = new Date()): Entitlement {
  if (device.subscriptionStatus === 'active' && device.subscriptionEndsAt) {
    if (device.subscriptionEndsAt > now) {
      return { granted: true, status: 'active', expiresAt: device.subscriptionEndsAt, offlineGraceWindow: OFFLINE_GRACE_MS, device };
    }
    if (device.subscriptionEndsAt > new Date(now.getTime() - OFFLINE_GRACE_MS)) {
      return { granted: true, status: 'active', expiresAt: device.subscriptionEndsAt, offlineGraceWindow: OFFLINE_GRACE_MS, device };
    }
  }

  if (device.subscriptionStatus === 'trial' && device.trialEndsAt > now) {
    return { granted: true, status: 'trial', expiresAt: device.trialEndsAt, offlineGraceWindow: OFFLINE_GRACE_MS, device };
  }

  return { granted: false, status: 'expired', expiresAt: null, offlineGraceWindow: OFFLINE_GRACE_MS, device };
}

export function activateSubscription(device: Device, durationDays: number = 30): Device {
  const now = new Date();
  const base = device.subscriptionEndsAt && device.subscriptionEndsAt > now
    ? device.subscriptionEndsAt
    : now;
  return {
    ...device,
    subscriptionStatus: 'active',
    subscriptionEndsAt: new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000),
  };
}
