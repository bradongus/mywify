import { getSupabase, json, error, env } from '../_shared/utils.ts';

const OFFLINE_GRACE_MS = 48 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

  try {
    const url = new URL(req.url);
    const deviceId = url.searchParams.get('device_id');
    if (!deviceId) return error('device_id required');

    const supabase = getSupabase(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

    const { data: device, error: dbError } = await supabase
      .from('devices')
      .select('*')
      .eq('device_id', deviceId)
      .single();

    if (dbError || !device) return error('Device not found', 404);

    // Update last_verify_at
    await supabase
      .from('devices')
      .update({ last_verify_at: new Date().toISOString() })
      .eq('device_id', deviceId);

    const now = Date.now();

    // Check active subscription
    if (device.subscription_status === 'active' && device.subscription_ends_at) {
      const endsAt = new Date(device.subscription_ends_at).getTime();
      if (endsAt > now) {
        return json({ granted: true, status: 'active', expires_at: device.subscription_ends_at });
      }
      // Offline grace window
      if (endsAt > now - OFFLINE_GRACE_MS) {
        return json({ granted: true, status: 'active', expires_at: device.subscription_ends_at, grace: true });
      }
    }

    // Check trial
    if (device.subscription_status === 'trial') {
      const trialEnds = new Date(device.trial_ends_at).getTime();
      if (trialEnds > now) {
        return json({ granted: true, status: 'trial', expires_at: device.trial_ends_at });
      }
    }

    return json({ granted: false, status: 'expired', expires_at: null });
  } catch (e) {
    return error(e.message || 'Internal error', 500);
  }
});
