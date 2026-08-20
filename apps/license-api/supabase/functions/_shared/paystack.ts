import { hmac } from 'https://deno.land/std@0.224.0/crypto/hmac.ts';
import { encodeHex } from 'https://deno.land/std@0.224.0/encoding/hex.ts';

export class PaystackClient {
  private secret: string;
  private baseUrl = 'https://api.paystack.co';

  constructor(secret: string) {
    this.secret = secret;
  }

  private async request(path: string, options: RequestInit = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.secret}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return res.json();
  }

  async createCustomer(email: string, metadata?: Record<string, string>) {
    return this.request('/customer', {
      method: 'POST',
      body: JSON.stringify({ email, metadata }),
    });
  }

  async initializeTransaction(params: {
    email: string;
    amount: number; // in kobo (multiply KES by 100)
    currency: string;
    reference: string;
    callback_url?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.request('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async verifyTransaction(reference: string) {
    return this.request(`/transaction/verify/${reference}`);
  }

  async createPlan(params: {
    name: string;
    amount: number;
    interval: 'monthly' | 'weekly' | 'daily' | 'annually';
    currency: string;
  }) {
    return this.request('/plan', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async createSubscription(params: {
    customer: string;
    plan: string;
    start_date?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.request('/subscription', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  static verifyWebhook(body: string, signature: string, secret: string): boolean {
    const expected = encodeHex(
      await hmac('sha256', new TextEncoder().encode(secret), new TextEncoder().encode(body))
    );
    return expected === signature;
  }
}

export function generateReference(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let ref = 'HS_';
  for (let i = 0; i < 16; i++) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }
  return ref;
}
