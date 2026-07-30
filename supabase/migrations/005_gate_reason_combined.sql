-- ============================================================
-- 005_gate_reason_combined.sql
-- Recompute adjusted_gate_reason so a bet that fails BOTH the margin and
-- form gates reports both, instead of only whichever check ran first.
--
-- computeV2() in lib/projection/index.ts previously returned as soon as the
-- margin gate failed, so the form guard was never even evaluated for that
-- row — a bet failing both gates only ever showed "margin" in the UI. Live
-- code now evaluates both before deciding, and this backfill brings history
-- in line with that so old and new rows use the same semantics.
-- ============================================================

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
      ELSE NULLIF(
        array_to_string(
          array_remove(ARRAY[
            CASE WHEN margin < 1.5 THEN 'margin' END,
            CASE WHEN (side = 'BET_UNDER' AND fr IS NOT NULL AND fr > 1.62)
                   OR  (side = 'BET_OVER'  AND fr IS NOT NULL AND fr < 1.18)
                 THEN 'form' END
          ], NULL),
          ','
        ),
        ''
      )
    END AS reason
  FROM gated
)
UPDATE predictions t
SET adjusted_gate_reason = r.reason
FROM reasoned r
WHERE t.id = r.id;
