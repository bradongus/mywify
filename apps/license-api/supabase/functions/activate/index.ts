import { getSupabase, json, error, env } from '../_shared/utils.ts';

const TRIAL_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

  try {
    const { device_id, owner_phone, owner_email } = await req.json();
    if (!device_id) return error('device_id required');

    const supabase = getSupabase(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

    // Check if device already exists
    const { data: existing } = await supabase
      .from('devices')
      .select('*')
      .eq('device_id', device_id)
      .single();

    if (existing) {
      return json({ device: existing, message: 'Device already activated' });
    }

    const now = new Date();
    const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const { data: device, error: insertError } = await supabase
      .from('devices')
      .insert({
        device_id,
        owner_phone: owner_phone || null,
        owner_email: owner_email || null,
        activated_at: now.toISOString(),
        subscription_status: 'trial',
        trial_ends_at: trialEnds.toISOString(),
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return json({ device, message: 'Trial activated', trial_ends_at: trialEnds.toISOString() });
  } catch (e) {
    return error(e.message || 'Internal error', 500);
  }
});
