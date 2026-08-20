import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Database } from './database.types.ts';

export function getSupabase(url: string, key: string) {
  return createClient<Database>(url, key);
}

export function getCorsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };
}

export function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
  });
}

export function error(message: string, status = 400, origin: string | null = null) {
  return json({ error: message }, status, origin);
}

export function env(name: string): string {
  const val = Deno.env.get(name);
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
}
