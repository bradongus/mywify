import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(express.json());

const DEVICE_ID = `dev-${randomUUID().slice(0, 8)}`;

// Device
app.get('/api/device', async (_req, res) => {
  const { data } = await supabase
    .from('devices')
    .select('device_id, subscription_status, trial_ends_at, subscription_ends_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    return res.json({
      deviceId: data.device_id,
      subscriptionStatus: data.subscription_status,
      trialEndsAt: data.trial_ends_at,
      subscriptionEndsAt: data.subscription_ends_at,
    });
  }

  const now = new Date();
  const trialEnds = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { data: created } = await supabase
    .from('devices')
    .insert({
      device_id: DEVICE_ID,
      subscription_status: 'trial',
      trial_ends_at: trialEnds.toISOString(),
    })
    .select('device_id, subscription_status, trial_ends_at')
    .single();

  res.json({
    deviceId: created?.device_id || DEVICE_ID,
    subscriptionStatus: 'trial',
    trialEndsAt: trialEnds.toISOString(),
    subscriptionEndsAt: null,
  });
});

app.get('/api/device/state', (_req, res) => {
  res.json({
    hotspotActive: true,
    internetOk: true,
    uplinkGuardEnabled: false,
    clientCount: 0,
    maxClients: 5,
  });
});

// Plans
app.get('/api/plans', async (_req, res) => {
  const { data } = await supabase
    .from('plans')
    .select('*')
    .order('sort_order');

  res.json((data || []).map(p => ({
    id: p.id,
    name: p.name,
    durationHours: p.duration_hours,
    price: p.price,
    isActive: p.is_active,
    sortOrder: p.sort_order,
  })));
});

app.post('/api/plans', async (req, res) => {
  const { data: device } = await supabase.from('devices').select('device_id').limit(1).maybeSingle();
  const deviceId = device?.device_id || DEVICE_ID;

  const { data, error } = await supabase
    .from('plans')
    .insert({
      device_id: deviceId,
      name: req.body.name,
      duration_hours: req.body.durationHours,
      price: req.body.price,
    })
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ id: data.id, name: data.name, durationHours: data.duration_hours, price: data.price, isActive: data.is_active, sortOrder: data.sort_order });
});

app.put('/api/plans/:id', async (req, res) => {
  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.durationHours !== undefined) updates.duration_hours = req.body.durationHours;
  if (req.body.price !== undefined) updates.price = req.body.price;
  if (req.body.isActive !== undefined) updates.is_active = req.body.isActive;

  const { error } = await supabase.from('plans').update(updates).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.delete('/api/plans/:id', async (req, res) => {
  await supabase.from('plans').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// Vouchers
app.get('/api/vouchers', async (_req, res) => {
  const { data } = await supabase
    .from('vouchers')
    .select('*, plans(name)')
    .order('created_at', { ascending: false });

  res.json((data || []).map(v => ({
    id: v.id,
    code: v.code,
    planName: (v.plans as any)?.name || '',
    durationHours: v.duration_hours,
    isUsed: v.is_used,
    usedByMac: v.used_by_mac,
    usedAt: v.used_at,
    createdAt: v.created_at,
  })));
});

app.post('/api/vouchers/generate', async (req, res) => {
  const { planId, count } = req.body;
  const { data: plan } = await supabase.from('plans').select('*').eq('id', planId).single();
  if (!plan) return res.status(400).json({ error: 'Plan not found' });

  const { data: device } = await supabase.from('devices').select('device_id').limit(1).maybeSingle();
  const deviceId = device?.device_id || DEVICE_ID;

  const vouchers = [];
  for (let i = 0; i < (count || 1); i++) {
    const code = `HS-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const { data: v } = await supabase
      .from('vouchers')
      .insert({
        code,
        device_id: deviceId,
        plan_id: planId,
        duration_hours: plan.duration_hours,
        signature: 'dev',
      })
      .select('*')
      .single();
    if (v) vouchers.push({ id: v.id, code: v.code, planName: plan.name, durationHours: v.duration_hours, isUsed: false, createdAt: v.created_at });
  }

  res.json(vouchers);
});

app.delete('/api/vouchers/:id', async (req, res) => {
  await supabase.from('vouchers').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// Clients
app.get('/api/clients', async (_req, res) => {
  const { data } = await supabase
    .from('connected_clients')
    .select('*')
    .order('last_seen_at', { ascending: false });

  res.json((data || []).map(c => ({
    mac: c.mac,
    ip: c.ip,
    isConnected: true,
    paid: c.is_paid,
    expiresAt: c.expires_at,
    planName: c.plan_name,
  })));
});

app.post('/api/clients/:mac/disconnect', (_req, res) => res.json({ ok: true }));
app.post('/api/clients/:mac/block', (_req, res) => res.json({ ok: true }));

// Revenue
app.get('/api/revenue', async (req, res) => {
  const period = (req.query.period as string) || '30d';
  let interval = '30 days';
  if (period === '7d') interval = '7 days';

  const { data: transactions } = await supabase
    .from('transactions')
    .select('*, plans(name)')
    .gte('created_at', new Date(Date.now() - parseInterval(interval)).toISOString());

  const totalRevenue = (transactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalClients = (transactions || []).length;

  const byPlanMap = new Map<string, number>();
  (transactions || []).forEach(t => {
    const name = (t.plans as any)?.name || 'Unknown';
    byPlanMap.set(name, (byPlanMap.get(name) || 0) + (t.amount || 0));
  });

  const byPlan = Array.from(byPlanMap.entries()).map(([name, revenue]) => ({
    name,
    revenue,
    percentage: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 100) : 0,
  }));

  res.json({ totalRevenue, totalClients, avgPerClient: totalClients > 0 ? totalRevenue / totalClients : 0, byPlan });
});

app.get('/api/transactions', async (_req, res) => {
  const { data } = await supabase
    .from('transactions')
    .select('*, plans(name)')
    .order('created_at', { ascending: false });

  res.json((data || []).map(t => ({
    id: t.id,
    voucherCode: t.voucher_code,
    planName: (t.plans as any)?.name,
    amount: t.amount,
    type: t.type,
    status: t.status,
    createdAt: t.created_at,
  })));
});

// Portal
app.post('/api/portal/redeem', async (req, res) => {
  const { code } = req.body;
  const mac = req.headers['x-client-mac'] as string || 'unknown';

  const { data: voucher } = await supabase
    .from('vouchers')
    .select('*')
    .eq('code', code)
    .eq('is_used', false)
    .maybeSingle();

  if (!voucher) return res.json({ success: false });

  const expiresAt = new Date(Date.now() + voucher.duration_hours * 60 * 60 * 1000);

  await supabase.from('vouchers').update({ is_used: true, used_by_mac: mac, used_at: new Date().toISOString() }).eq('id', voucher.id);

  const { data: device } = await supabase.from('devices').select('device_id').limit(1).maybeSingle();

  await supabase.from('connected_clients').upsert({
    device_id: device?.device_id || DEVICE_ID,
    mac,
    is_paid: true,
    expires_at: expiresAt.toISOString(),
    plan_name: (await supabase.from('plans').select('name').eq('id', voucher.plan_id).maybeSingle()).data?.name,
  }, { onConflict: 'device_id,mac' });

  await supabase.from('transactions').insert({
    device_id: device?.device_id || DEVICE_ID,
    voucher_code: code,
    plan_id: voucher.plan_id,
    amount: 0,
    type: 'voucher',
    status: 'success',
  });

  res.json({ success: true, expiresAt: expiresAt.toISOString() });
});

app.get('/api/portal/status', async (req, res) => {
  const mac = req.headers['x-client-mac'] as string || '';
  const { data } = await supabase
    .from('connected_clients')
    .select('*')
    .eq('mac', mac)
    .maybeSingle();

  res.json({
    paid: data?.is_paid || false,
    expiresAt: data?.expires_at,
  });
});

function parseInterval(s: string): number {
  const n = parseInt(s);
  if (s.includes('day')) return n * 86400000;
  if (s.includes('hour')) return n * 3600000;
  return n * 86400000;
}

const PORT = parseInt(process.env.DEV_API_PORT || '8080');
app.listen(PORT, () => {
  console.log(`Dev API server running on http://localhost:${PORT}`);
});
