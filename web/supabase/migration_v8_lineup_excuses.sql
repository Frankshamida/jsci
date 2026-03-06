-- Migration V8: Lineup Excuses
-- Song Leaders can excuse themselves from dates in advance.
-- Admin approves/rejects excuses. Excused leaders are grayed out in the assignment dropdown.

CREATE TABLE IF NOT EXISTS lineup_excuses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  user_name TEXT NOT NULL,
  excuse_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  admin_note TEXT,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, excuse_date)
);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_lineup_excuses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_lineup_excuses_updated_at ON lineup_excuses;
CREATE TRIGGER update_lineup_excuses_updated_at
  BEFORE UPDATE ON lineup_excuses
  FOR EACH ROW
  EXECUTE FUNCTION update_lineup_excuses_updated_at();

-- RLS
ALTER TABLE lineup_excuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on lineup_excuses" ON lineup_excuses;
CREATE POLICY "Allow all on lineup_excuses" ON lineup_excuses FOR ALL USING (true) WITH CHECK (true);
