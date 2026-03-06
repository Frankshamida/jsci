-- ============================================
-- MIGRATION V12: ROLE PERMISSIONS CONTROL
-- SuperAdmin can enable/disable features per role
-- with real-time updates via Supabase Realtime
-- ============================================

-- 1. Create the role_permissions_control table
-- Each row = one feature toggled for one role
CREATE TABLE IF NOT EXISTS role_permissions_control (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  role TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role, feature_key)
);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS update_role_permissions_control_updated_at ON role_permissions_control;
CREATE TRIGGER update_role_permissions_control_updated_at
  BEFORE UPDATE ON role_permissions_control
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE role_permissions_control ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON role_permissions_control;
CREATE POLICY "Allow all" ON role_permissions_control FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rpc_role ON role_permissions_control(role);
CREATE INDEX IF NOT EXISTS idx_rpc_feature ON role_permissions_control(feature_key);
CREATE INDEX IF NOT EXISTS idx_rpc_role_feature ON role_permissions_control(role, feature_key);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE role_permissions_control;
