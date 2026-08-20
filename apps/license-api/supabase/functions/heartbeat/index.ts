import { json } from '../_shared/utils.ts';

// Prevents Supabase free-tier project pause (1 week inactivity)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  return json({ alive: true, timestamp: new Date().toISOString() });
});
