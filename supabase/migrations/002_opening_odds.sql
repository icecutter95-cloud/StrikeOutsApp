-- Add opening odds columns to predictions
-- Mirrors opening_line: set once on the first hourly snapshot, never overwritten.
-- Needed so the dashboard card can show an odds-shift indicator without
-- loading line_snapshots for every pitcher on every page load.

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS opening_odds_over  INTEGER,
  ADD COLUMN IF NOT EXISTS opening_odds_under INTEGER;
