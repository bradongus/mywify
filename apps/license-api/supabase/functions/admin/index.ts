import { getSupabase, json, error, env } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const supabase = getSupabase(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

    switch (action) {
      case 'list-devices': {
        const { data, error: dbErr } = await supabase
          .from('devices')
          .select('*')
          .order('created_at', { ascending: false });
        if (dbErr) throw dbErr;
        return json({ devices: data });
      }

      case 'device-stats': {
        const now = new Date().toISOString();
        const { data: all } = await supabase.from('devices').select('device_id, subscription_status, trial_ends_at, subscription_ends_at');
        const devices = all || [];
        const active = devices.filter(d => d.subscription_status === 'active' && d.subscription_ends_at && d.subscription_ends_at > now).length;
        const trialing = devices.filter(d => d.subscription_status === 'trial' && d.trial_ends_at > now).length;
        const expired = devices.length - active - trialing;
        return json({ total: devices.length, active, trialing, expired });
      }

      case 'revenue': {
        const { data: txns } = await supabase
          .from('transactions')
          .select('amount, status, type, created_at')
          .eq('status', 'success')
          .eq('type', 'subscription');
        const total = (txns || []).reduce((sum, t) => sum + (t.amount || 0), 0);
        return json({ total_revenue: total, transactions: txns?.length || 0 });
      }

      case 'extend': {
        const deviceId = url.searchParams.get('device_id');
        const days = parseInt(url.searchParams.get('days') || '30');
        if (!deviceId) return error('device_id required');
        const { data: device } = await supabase.from('devices').select('*').eq('device_id', deviceId).single();
        if (!device) return error('Device not found', 404);
        const base = device.subscription_ends_at && new Date(device.subscription_ends_at) > new Date()
          ? new Date(device.subscription_ends_at)
          : new Date();
        const endsAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
        await supabase
          .from('devices')
          .update({ subscription_status: 'active', subscription_ends_at: endsAt.toISOString() })
          .eq('device_id', deviceId);
        return json({ device_id: deviceId, new_expiry: endsAt.toISOString() });
      }

      case 'revoke': {
        const deviceId = url.searchParams.get('device_id');
        if (!deviceId) return error('device_id required');
        await supabase
          .from('devices')
          .update({ subscription_status: 'expired', subscription_ends_at: new Date().toISOString() })
          .eq('device_id', deviceId);
        return json({ device_id: deviceId, revoked: true });
      }

      case 'generate-voucher': {
        const body = await req.json();
        const { device_id, plan_id, count = 1 } = body;
        if (!device_id || !plan_id) return error('device_id and plan_id required');

        const { data: plan } = await supabase.from('plans').select('*').eq('id', plan_id).single();
        if (!plan) return error('Plan not found', 404);

        const codes: Array<{ code: string; signature: string }> = [];
        for (let i = 0; i < count; i++) {
          const code = `HS-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
          const signature = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code + env('VOUCHER_SECRET')));
          const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
          codes.push({ code, signature: sigHex });
        }

        const insertions = codes.map(c => ({
          code: c.code,
          device_id,
          plan_id,
          duration_hours: plan.duration_hours,
          signature: c.signature,
          is_used: false,
        }));

        await supabase.from('vouchers').insert(insertions);
        return json({ vouchers: codes.map(c => c.code), count: codes.length });
      }

      default:
        return error('Unknown action');
    }
  } catch (e) {
    return error(e.message || 'Internal error', 500);
  }
});
