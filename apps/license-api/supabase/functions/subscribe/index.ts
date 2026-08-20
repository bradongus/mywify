import { getSupabase, json, error, env } from '../_shared/utils.ts';
import { PaystackClient, generateReference } from '../_shared/paystack.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

  try {
    const { device_id, email } = await req.json();
    if (!device_id) return error('device_id required');

    const supabase = getSupabase(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const paystack = new PaystackClient(env('PAYSTACK_SECRET_KEY'));

    // Get or create device
    const { data: device } = await supabase
      .from('devices')
      .select('*')
      .eq('device_id', device_id)
      .single();

    if (!device) return error('Device not found', 404);

    // Initialize Paystack transaction
    const reference = generateReference();
    const amount = parseInt(env('SUBSCRIPTION_AMOUNT_KES')) * 100; // convert to kobo/pesewas

    const result = await paystack.initializeTransaction({
      email: email || `${device_id}@hotshare.local`,
      amount,
      currency: 'KES',
      reference,
      metadata: {
        device_id,
        type: 'subscription',
      },
    });

    if (!result.status) {
      return error('Paystack initialization failed: ' + (result.message || 'unknown'), 502);
    }

    // Store pending transaction
    await supabase.from('transactions').insert({
      device_id,
      amount: amount / 100,
      paystack_ref: reference,
      type: 'subscription',
      status: 'pending',
    });

    return json({
      checkout_url: result.data.authorization_url,
      reference,
      access_code: result.data.access_code,
    });
  } catch (e) {
    return error(e.message || 'Internal error', 500);
  }
});
