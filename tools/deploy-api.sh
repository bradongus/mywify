#!/bin/bash
# hotshare — Deploy license API to Supabase

set -e

echo "=== Deploying hotshare License API ==="

# Check prerequisites
command -v supabase >/dev/null 2>&1 || { echo "Supabase CLI required: npm i -g supabase"; exit 1; }

# Link to project
echo "[1/3] Linking to Supabase project..."
supabase link --project-ref "${SUPABASE_PROJECT_REF}"

# Run migrations
echo "[2/3] Running database migrations..."
supabase db push

# Deploy edge functions
echo "[3/3] Deploying edge functions..."
for fn in activate verify subscribe paystack-webhook admin heartbeat; do
  echo "  Deploying $fn..."
  supabase functions deploy "$fn" --no-verify-jwt
done

echo ""
echo "=== Deploy Complete ==="
echo "API URL: https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1"
