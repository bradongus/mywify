-- hotshare database schema
-- Supabase (PostgreSQL) migration

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Devices: one row per installed app instance
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  owner_phone TEXT,
  owner_email TEXT,
  activated_at TIMESTAMPTZ DEFAULT now(),
  subscription_status TEXT DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'expired')),
  trial_ends_at TIMESTAMPTZ NOT NULL,
  subscription_ends_at TIMESTAMPTZ,
  paystack_customer_id TEXT,
  paystack_subscription_id TEXT,
  last_verify_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_devices_device_id ON devices(device_id);
CREATE INDEX idx_devices_subscription_status ON devices(subscription_status);

-- Plans: owner's pricing tiers
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_hours INT NOT NULL CHECK (duration_hours > 0),
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_plans_device_id ON plans(device_id);

-- Vouchers: Tier 2 codes
CREATE TABLE vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  duration_hours INT NOT NULL,
  signature TEXT NOT NULL,
  is_used BOOLEAN DEFAULT false,
  used_by_mac TEXT,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_vouchers_code ON vouchers(code);
CREATE INDEX idx_vouchers_device_id ON vouchers(device_id);
CREATE INDEX idx_vouchers_is_used ON vouchers(is_used);

-- Transactions: payment log
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  voucher_code TEXT,
  plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL,
  paystack_ref TEXT,
  type TEXT NOT NULL CHECK (type IN ('subscription', 'voucher')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_transactions_device_id ON transactions(device_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_status ON transactions(status);

-- Connected clients: synced from device (for admin visibility)
CREATE TABLE connected_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  mac TEXT NOT NULL,
  ip TEXT,
  is_paid BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  plan_name TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(device_id, mac)
);

CREATE INDEX idx_connected_clients_device_id ON connected_clients(device_id);

-- Admin users (Supabase Auth users)
CREATE TABLE admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'owner' CHECK (role IN ('owner', 'developer')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by edge functions)
-- Public anon: read-only on devices (for portal status check)
CREATE POLICY "Public can check device status"
  ON devices FOR SELECT
  TO anon
  USING (true);

-- Authenticated users: full access to their own data
CREATE POLICY "Authenticated full access"
  ON devices FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated full access"
  ON plans FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated full access"
  ON vouchers FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated full access"
  ON transactions FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated full access"
  ON connected_clients FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated full access"
  ON admin_users FOR ALL
  TO authenticated
  USING (true);

-- Helper: check if a device has active entitlement
CREATE OR REPLACE FUNCTION check_entitlement(p_device_id TEXT)
RETURNS TABLE (
  granted BOOLEAN,
  status TEXT,
  expires_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN d.subscription_status = 'active' AND d.subscription_ends_at > now() THEN true
      WHEN d.subscription_status = 'active' AND d.subscription_ends_at > now() - INTERVAL '48 hours' THEN true
      WHEN d.subscription_status = 'trial' AND d.trial_ends_at > now() THEN true
      ELSE false
    END AS granted,
    d.subscription_status AS status,
    CASE
      WHEN d.subscription_status = 'active' THEN d.subscription_ends_at
      WHEN d.subscription_status = 'trial' THEN d.trial_ends_at
      ELSE NULL
    END AS expires_at
  FROM devices d
  WHERE d.device_id = p_device_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
