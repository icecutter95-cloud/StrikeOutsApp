-- ============================================================
-- 007_first_recommended.sql
-- Track the first time a prediction ever became a live v2 bet today, so a
-- later price move that flips it back to NO_BET doesn't erase all trace that
-- a real recommendation window existed.
--
-- This is deliberately NOT a full history log — grading still runs off
-- adjusted_recommendation at whatever it resolves to once the game starts
-- (predictions freeze at first pitch, see 8562a24). This only adds a
-- breadcrumb for the pregame case: odds moving over the course of the day is
-- expected, legitimate behavior, and right now checking the board later than
-- some other run silently loses any evidence that a bet was live earlier.
-- ============================================================

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS adjusted_first_recommended_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS adjusted_first_recommended_side      TEXT,
  ADD COLUMN IF NOT EXISTS adjusted_first_recommended_odds      INTEGER,
  ADD COLUMN IF NOT EXISTS adjusted_first_recommended_edge_pct  NUMERIC;

COMMENT ON COLUMN predictions.adjusted_first_recommended_at IS
  'When adjusted_recommendation first became a real bet today. Set once, never overwritten -- NULL means it was never recommended today. "Was ever a bet" = this column IS NOT NULL.';
