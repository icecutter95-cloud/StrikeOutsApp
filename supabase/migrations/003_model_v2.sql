-- ============================================================
-- 003_model_v2.sql
-- Model v2: shrunk projections + margin/form gating
--
-- Background (full-season analysis, 1,999 decided bets, 2026-07-28):
--   regr_slope(actual - line, projected - line) = 0.246
--   The model's deviation from the prop line carries only ~25% real signal.
--   MAE(projected_ks) = 1.923 vs MAE(prop_line) = 1.817 — the line alone
--   predicted better than the model. Every BET_OVER slice had actual < projected;
--   every BET_UNDER slice had actual > projected. The model fired precisely
--   where its own projection was wrong.
--
-- v2 keeps projected_ks untouched (still shown to the user) and writes the
-- recalibrated values to new adjusted_* columns, so v1 history stays intact
-- and interpretable. model_version distinguishes the two.
-- ============================================================

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS model_version           TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS adjusted_ks             NUMERIC,
  ADD COLUMN IF NOT EXISTS adjusted_edge_pct       NUMERIC,
  ADD COLUMN IF NOT EXISTS adjusted_recommendation TEXT,
  ADD COLUMN IF NOT EXISTS adjusted_units          NUMERIC,
  -- Stuff metric actually used by computeCSWK9(); predictions.csw_pct was
  -- always NULL because the projections route wrote pitcherStats.csw_pct,
  -- which Baseball Savant never populates. swstr_pct is the real input.
  ADD COLUMN IF NOT EXISTS swstr_pct               NUMERIC;

-- Existing rows are all v1 (the DEFAULT already covers this, but be explicit
-- so re-running the migration on a partially-migrated table is safe).
UPDATE predictions SET model_version = 'v1' WHERE model_version IS NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_model_version
  ON predictions (model_version);

CREATE INDEX IF NOT EXISTS idx_predictions_adjusted_rec
  ON predictions (adjusted_recommendation)
  WHERE adjusted_recommendation IS NOT NULL;

COMMENT ON COLUMN predictions.model_version IS
  'v1 = raw projection drives the recommendation. v2 = projection shrunk 75% toward the prop line, gated on margin + recent form.';
COMMENT ON COLUMN predictions.adjusted_ks IS
  'prop_line + 0.25 * (projected_ks - prop_line). Recalibrated lambda used for edge math. projected_ks stays raw for display.';
COMMENT ON COLUMN predictions.adjusted_recommendation IS
  'What v2 logic recommends. Backfilled on historical rows so v2 has a full-season track record from day one.';
