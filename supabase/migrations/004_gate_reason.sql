-- ============================================================
-- 004_gate_reason.sql
-- Persist WHY v2 landed on NO_BET, not just that it did.
--
-- adjusted_recommendation alone can't distinguish "margin gate blocked a real
-- disagreement", "form guard blocked it", and "there was never a real edge to
-- begin with" (edge threshold) — all three collapse to the same NO_BET. The
-- first two are the informative cases (v1 would have bet; v2 vetoed it for a
-- specific, inspectable reason); the third is just quiet non-signal. The UI
-- needs to tell these apart to answer "why isn't this a bet anymore".
-- ============================================================

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS adjusted_gate_reason TEXT;

COMMENT ON COLUMN predictions.adjusted_gate_reason IS
  '''edge'' = never cleared the edge threshold, ''margin'' = raw projection-line gap < 1.5 Ks, ''form'' = recent-form ratio vetoed the side, NULL = a bet fired (or row predates v2).';

CREATE INDEX IF NOT EXISTS idx_predictions_gate_reason
  ON predictions (adjusted_gate_reason)
  WHERE adjusted_gate_reason IS NOT NULL;

-- Backfill: reproduces computeV2() in lib/projection/index.ts exactly, just
-- capturing which branch returned instead of only the final recommendation.
WITH base AS (
  SELECT id, prop_line::float AS line, projected_ks::float AS proj,
         prop_odds_over AS oo, prop_odds_under AS ou,
         lineup_confirmation_status AS lcs,
         (last3_k_rate / NULLIF(season_k_pct, 0))::float AS fr
  FROM predictions
  WHERE prop_line IS NOT NULL AND projected_ks IS NOT NULL
    AND prop_odds_over IS NOT NULL AND prop_odds_under IS NOT NULL
), s AS (
  SELECT *, GREATEST(line + 0.25 * (proj - line), 0.05) AS lam,
    (CASE WHEN oo > 0 THEN 100.0 / (oo + 100) ELSE ABS(oo) / (ABS(oo) + 100.0) END) AS io,
    (CASE WHEN ou > 0 THEN 100.0 / (ou + 100) ELSE ABS(ou) / (ABS(ou) + 100.0) END) AS iu,
    CASE WHEN lcs = 'unconfirmed' THEN 0.005 ELSE 0.0 END AS pen
  FROM base
), p AS (
  SELECT s.*, (SELECT SUM(EXP(-lam) * POWER(lam, i) / FACTORIAL(i)::float)
               FROM generate_series(0, FLOOR(line)::int) i) AS p_under
  FROM s
), e AS (
  SELECT *, ((1 - p_under) - io / (io + iu)) - pen AS eo, (p_under - iu / (io + iu)) - pen AS eu
  FROM p
), pick AS (
  SELECT *,
    CASE WHEN eo > eu + 0.02 AND eo > 0.005 THEN 'BET_OVER'
         WHEN eu > eo AND eu > 0.005 THEN 'BET_UNDER'
         ELSE 'NO_BET' END AS side
  FROM e
), gated AS (
  SELECT *,
    CASE WHEN side = 'BET_UNDER' THEN line - proj WHEN side = 'BET_OVER' THEN proj - line ELSE NULL END AS margin
  FROM pick
), reasoned AS (
  SELECT id,
    CASE
      WHEN side = 'NO_BET' THEN 'edge'
      WHEN margin < 1.5 THEN 'margin'
      WHEN side = 'BET_UNDER' AND fr IS NOT NULL AND fr > 1.62 THEN 'form'
      WHEN side = 'BET_OVER'  AND fr IS NOT NULL AND fr < 1.18 THEN 'form'
      ELSE NULL
    END AS reason
  FROM gated
)
UPDATE predictions t
SET adjusted_gate_reason = r.reason
FROM reasoned r
WHERE t.id = r.id;
