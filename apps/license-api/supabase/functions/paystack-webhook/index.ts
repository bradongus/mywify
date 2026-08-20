import { getSupabase, json, error, env } from '../_shared/utils.ts';
import { PaystackClient } from '../_shared/paystack.ts';

const SUBSCRIPTION_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

  try {
    const body = await req.text();
    const signature = req.headers.get('x-paystack-signature') || '';

    // Verify webhook signature
    const secret = env('PAYSTACK_SECRET_KEY');
    if (!PaystackClient.verifyWebhook(body, signature, secret)) {
      return error('Invalid signature', 401);
    }

    const event = JSON.parse(body);
    const supabase = getSupabase(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

    if (event.event === 'charge.success') {
      const { reference, metadata, amount, customer } = event.data;

      if (metadata?.type === 'subscription' && metadata?.device_id) {
        const deviceId = metadata.device_id;
        const now = new Date();
        const endsAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

        // Update device subscription
        await supabase
          .from('devices')
          .update({
            subscription_status: 'active',
            subscription_ends_at: endsAt.toISOString(),
            paystack_customer_id: customer?.customer_code || null,
          })
          .eq('device_id', deviceId);

        // Update transaction
        await supabase
          .from('transactions')
          .update({ status: 'success' })
          .eq('paystack_ref', reference);

        return json({ received: true, device_id: deviceId, expires_at: endsAt.toISOString() });
      }
    }

    if (event.event === 'subscription.create') {
      const { subscription_code, customer, plan, metadata } = event.data;
      if (metadata?.device_id) {
        await supabase
          .from('devices')
          .update({
            paystack_subscription_id: subscription_code,
            paystack_customer_id: customer?.customer_code || null,
          })
          .eq('device_id', metadata.device_id);
      }
    }

    if (event.event === 'invoice.payment_failed') {
      // Subscription payment failed — don't revoke immediately (grace window handles it)
      console.log('Payment failed for subscription:', event.data.subscription?.subscription_code);
    }

    return json({ received: true });
  } catch (e) {
    return error(e.message || 'Internal error', 500);
  }
});
