-- hotshare roles migration
-- Adds super_admin/merchant roles and device linking

-- 1. Update role enum: owner/developer → super_admin/merchant
ALTER TABLE admin_users
  DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('super_admin', 'merchant'));

-- Update existing rows
UPDATE admin_users SET role = 'super_admin' WHERE role = 'owner';
UPDATE admin_users SET role = 'merchant' WHERE role = 'developer';

-- 2. Add device_id column for merchants
ALTER TABLE admin_users
  ADD COLUMN device_id TEXT REFERENCES devices(device_id);

-- 3. Helper functions (SECURITY DEFINER bypasses RLS, avoids recursion)
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM admin_users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_device_id()
RETURNS TEXT AS $$
  SELECT device_id FROM admin_users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 4. Drop old policies
DROP POLICY IF EXISTS "Authenticated full access" ON devices;
DROP POLICY IF EXISTS "Authenticated full access" ON plans;
DROP POLICY IF EXISTS "Authenticated full access" ON vouchers;
DROP POLICY IF EXISTS "Authenticated full access" ON transactions;
DROP POLICY IF EXISTS "Authenticated full access" ON connected_clients;
DROP POLICY IF EXISTS "Authenticated full access" ON admin_users;

-- 5. admin_users: simple own-row access (no self-referencing subqueries)
CREATE POLICY "Users read own profile"
  ON admin_users FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users insert own profile"
  ON admin_users FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- 6. Super-admin: full access to data tables (uses SECURITY DEFINER function)
CREATE POLICY "Super admin full access"
  ON devices FOR ALL
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Super admin full access"
  ON plans FOR ALL
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Super admin full access"
  ON vouchers FOR ALL
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Super admin full access"
  ON transactions FOR ALL
  TO authenticated
  USING (get_user_role() = 'super_admin');

CREATE POLICY "Super admin full access"
  ON connected_clients FOR ALL
  TO authenticated
  USING (get_user_role() = 'super_admin');

-- 7. Merchant: scoped to their own device (uses SECURITY DEFINER function)
CREATE POLICY "Merchant sees own device"
  ON devices FOR ALL
  TO authenticated
  USING (get_user_role() = 'merchant' AND device_id = get_user_device_id());

CREATE POLICY "Merchant sees own plans"
  ON plans FOR ALL
  TO authenticated
  USING (get_user_role() = 'merchant' AND device_id = get_user_device_id());

CREATE POLICY "Merchant sees own vouchers"
  ON vouchers FOR ALL
  TO authenticated
  USING (get_user_role() = 'merchant' AND device_id = get_user_device_id());

CREATE POLICY "Merchant sees own transactions"
  ON transactions FOR ALL
  TO authenticated
  USING (get_user_role() = 'merchant' AND device_id = get_user_device_id());

CREATE POLICY "Merchant sees own clients"
  ON connected_clients FOR ALL
  TO authenticated
  USING (get_user_role() = 'merchant' AND device_id = get_user_device_id());
