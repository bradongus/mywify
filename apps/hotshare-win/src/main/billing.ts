import Database from 'better-sqlite3';
import { generateCode, signCode, validateCodeFormat, verifyCodeIntegrity } from '@hotshare/shared-core';
import type { Plan, Voucher, Transaction, ConnectedClient } from '@hotshare/shared-core';

export class BillingEngine {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        duration_hours INTEGER NOT NULL,
        price REAL NOT NULL,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS vouchers (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        plan_id TEXT REFERENCES plans(id),
        duration_hours INTEGER NOT NULL,
        signature TEXT NOT NULL,
        is_used INTEGER DEFAULT 0,
        used_by_mac TEXT,
        used_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        voucher_code TEXT,
        plan_id TEXT,
        amount REAL NOT NULL,
        paystack_ref TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS clients (
        mac TEXT PRIMARY KEY,
        ip TEXT,
        plan_id TEXT,
        expires_at TEXT,
        is_paid INTEGER DEFAULT 0,
        last_seen_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  getPlans(): Plan[] {
    return this.db.prepare('SELECT * FROM plans ORDER BY sort_order').all() as Plan[];
  }

  createPlan(data: { name: string; durationHours: number; price: number }): Plan {
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO plans (id, name, duration_hours, price) VALUES (?, ?, ?, ?)').run(id, data.name, data.durationHours, data.price);
    return this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Plan;
  }

  updatePlan(id: string, data: Partial<Plan>): void {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
    if (data.durationHours !== undefined) { updates.push('duration_hours = ?'); values.push(data.durationHours); }
    if (data.price !== undefined) { updates.push('price = ?'); values.push(data.price); }
    if (data.isActive !== undefined) { updates.push('is_active = ?'); values.push(data.isActive ? 1 : 0); }
    if (updates.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE plans SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  deletePlan(id: string): void {
    this.db.prepare('DELETE FROM plans WHERE id = ?').run(id);
  }

  getVouchers(): Voucher[] {
    return this.db.prepare(`
      SELECT v.*, p.name as plan_name
      FROM vouchers v LEFT JOIN plans p ON v.plan_id = p.id
      ORDER BY v.created_at DESC
    `).all() as Voucher[];
  }

  generateVouchers(planId: string, count: number): string[] {
    const plan = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(planId) as Plan | undefined;
    if (!plan) throw new Error('Plan not found');

    const codes: string[] = [];
    const insert = this.db.prepare('INSERT INTO vouchers (id, code, plan_id, duration_hours, signature) VALUES (?, ?, ?, ?, ?)');

    for (let i = 0; i < count; i++) {
      const code = generateCode();
      const sig = signCode(code);
      insert.run(crypto.randomUUID(), code, planId, plan.durationHours, sig);
      codes.push(code);
    }
    return codes;
  }

  deactivateVoucher(id: string): void {
    this.db.prepare('DELETE FROM vouchers WHERE id = ?').run(id);
  }

  redeemCode(code: string, mac: string): { success: boolean; expiresAt?: string } {
    if (!validateCodeFormat(code)) return { success: false };

    const voucher = this.db.prepare('SELECT * FROM vouchers WHERE code = ? AND is_used = 0').get(code) as Voucher | undefined;
    if (!voucher) return { success: false };

    if (!verifyCodeIntegrity(code, voucher.signature)) return { success: false };

    const now = new Date();
    const expiresAt = new Date(now.getTime() + voucher.durationHours * 60 * 60 * 1000);

    this.db.prepare('UPDATE vouchers SET is_used = 1, used_by_mac = ?, used_at = ? WHERE id = ?').run(mac, now.toISOString(), voucher.id);
    this.db.prepare('INSERT OR REPLACE INTO clients (mac, plan_id, expires_at, is_paid, last_seen_at) VALUES (?, ?, ?, 1, ?)').run(mac, voucher.planId, expiresAt.toISOString(), now.toISOString());
    this.db.prepare('INSERT INTO transactions (id, voucher_code, plan_id, amount, type, status) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), code, voucher.planId, 0, 'voucher', 'success');

    return { success: true, expiresAt: expiresAt.toISOString() };
  }

  getConnectedClients(): ConnectedClient[] {
    return this.db.prepare(`
      SELECT c.mac, c.ip,
        CASE WHEN c.is_paid = 1 AND c.expires_at > datetime('now') THEN 1 ELSE 0 END as paid,
        c.expires_at, p.name as plan_name
      FROM clients c LEFT JOIN plans p ON c.plan_id = p.id
      ORDER BY c.last_seen_at DESC
    `).all() as ConnectedClient[];
  }

  getRevenue(period: string) {
    let where = '';
    if (period === '7d') where = "WHERE created_at > datetime('now', '-7 days')";
    else if (period === '30d') where = "WHERE created_at > datetime('now', '-30 days')";

    const total = this.db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions ${where}`).get() as { total: number };
    const byPlan = this.db.prepare(`
      SELECT p.name, COALESCE(SUM(t.amount), 0) as revenue
      FROM transactions t JOIN plans p ON t.plan_id = p.id
      ${where.replace('WHERE', 'AND')}
      GROUP BY p.name
    `).all() as Array<{ name: string; revenue: number }>;

    return { totalRevenue: total.total, byPlan };
  }
}
