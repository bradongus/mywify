import { describe, it, expect } from '@jest/globals';
import { createTrialDevice, checkEntitlement, activateSubscription } from '../entitlement.js';

describe('entitlement', () => {
  it('creates a trial device with 30-day trial', () => {
    const now = new Date();
    const device = createTrialDevice('dev-001', '0712345678', 'test@example.com');
    expect(device.deviceId).toBe('dev-001');
    expect(device.subscriptionStatus).toBe('trial');
    expect(device.trialEndsAt.getTime() - now.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
  });

  it('grants entitlement during trial', () => {
    const device = createTrialDevice('dev-001');
    const result = checkEntitlement(device);
    expect(result.granted).toBe(true);
    expect(result.status).toBe('trial');
  });

  it('denies entitlement after trial expires', () => {
    const device = createTrialDevice('dev-001');
    device.trialEndsAt = new Date(Date.now() - 1000);
    const result = checkEntitlement(device);
    expect(result.granted).toBe(false);
    expect(result.status).toBe('expired');
  });

  it('grants entitlement during active subscription', () => {
    let device = createTrialDevice('dev-001');
    device = activateSubscription(device, 30);
    const result = checkEntitlement(device);
    expect(result.granted).toBe(true);
    expect(result.status).toBe('active');
  });

  it('denies entitlement after subscription + grace window expires', () => {
    let device = createTrialDevice('dev-001');
    device = activateSubscription(device, 30);
    device.subscriptionEndsAt = new Date(Date.now() - 49 * 60 * 60 * 1000); // 49h ago (past 48h grace)
    const result = checkEntitlement(device);
    expect(result.granted).toBe(false);
  });

  it('extends existing subscription (not replaces)', () => {
    let device = createTrialDevice('dev-001');
    device = activateSubscription(device, 30);
    const firstEnds = device.subscriptionEndsAt!.getTime();
    device = activateSubscription(device, 30);
    expect(device.subscriptionEndsAt!.getTime()).toBeGreaterThan(firstEnds);
  });

  it('applies 48h offline grace window', () => {
    let device = createTrialDevice('dev-001');
    device = activateSubscription(device, 30);
    device.subscriptionEndsAt = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12h ago
    const result = checkEntitlement(device);
    expect(result.granted).toBe(true);
    expect(result.status).toBe('active');
  });

  it('denies after grace window expires', () => {
    let device = createTrialDevice('dev-001');
    device = activateSubscription(device, 30);
    device.subscriptionEndsAt = new Date(Date.now() - 49 * 60 * 60 * 1000); // 49h ago
    const result = checkEntitlement(device);
    expect(result.granted).toBe(false);
  });
});
