-- ============================================================
-- 006_candidate_side.sql
-- Persist which side v2's own (shrunk-probability) pricing favored, even
-- when a gate vetoed it.
--
-- The Margin badge/column previously fell back to an unsigned |proj - line|
-- whenever the live recommendation was NO_BET, with no way to tell which
-- side v2 was actually leaning toward. That's misleading whenever v2's
-- internal lean differs from v1's raw-projection-implied side — e.g. a
-- heavily-favored price (-160) can price out an over the raw projection
-- screams for once it's shrunk 75% toward the line, leaving v2 leaning
-- under on a pitcher v1 wanted to bet over. Persisting the actual candidate
-- side removes the ambiguity instead of leaving it to be inferred.
-- ============================================================

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS adjusted_candidate_side TEXT;

COMMENT ON COLUMN predictions.adjusted_candidate_side IS
  'Which side v2''s shrunk-probability pricing favored, even when a gate vetoed it. NULL when neither side ever cleared the initial edge threshold (gate_reason=edge), or a bet fired (redundant with adjusted_recommendation in that case).';

-- Backfill: mirrors computeV2()'s side-selection step exactly.
WITH base AS (
  SELECT id, prop_line::float AS line, projected_ks::float AS proj,
         prop_odds_over AS oo, prop_odds_under AS ou,
         lineup_confirmation_status AS lcs
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
  SELECT id,
    CASE WHEN eo > eu + 0.02 AND eo > 0.005 THEN 'BET_OVER'
         WHEN eu > eo AND eu > 0.005 THEN 'BET_UNDER'
         ELSE NULL END AS side
  FROM e
)
UPDATE predictions t
SET adjusted_candidate_side = pick.side
FROM pick
WHERE t.id = pick.id;
