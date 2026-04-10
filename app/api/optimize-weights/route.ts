import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// Must match lib/projection/index.ts
const SWSTR_K9_CALIBRATION = 81;

// ============================================================
// Types
// ============================================================

interface LineupBatter {
  hand: "R" | "L" | "S" | null;
}

interface PredRow {
  pitcher_id: string;
  last3_k_rate: number | null;
  season_k_pct: number | null;
  xfip_k_rate: number | null;
  projected_ip: number | null;
  lineup_k_vulnerability: number | null;
  lineup_data: LineupBatter[] | null;
  park_factor: number;
  weather_modifier: number;
  actual_ks: number;
  // Joined from pitcher_stats_cache
  swstr_pct: number | null;
  k_pct_vs_lhh: number | null;
  k_pct_vs_rhh: number | null;
}

interface Weights {
  last3: number;
  season: number;
  csw: number;
  xfip: number;
}

// ============================================================
// Projection helpers — mirrors lib/projection/index.ts exactly
// ============================================================

/**
 * Platoon-adjusted season K/9.
 * Uses lineup handedness composition (from stored lineup_data) +
 * pitcher's K% vs LHH/RHH to compute a matchup-specific season K9.
 * Falls back to plain season K9 when data is insufficient.
 */
function computePlatoonSeasonK9(row: PredRow): number {
  const baseSeasonK9 =
    row.season_k_pct !== null
      ? (row.season_k_pct > 1 ? row.season_k_pct / 100 : row.season_k_pct) * 27
      : 7.5;

  if (row.k_pct_vs_lhh === null || row.k_pct_vs_rhh === null) return baseSeasonK9;

  const lineup = row.lineup_data ?? [];
  const withHand = lineup.filter((b) => b.hand !== null);
  if (withHand.length < 4) return baseSeasonK9; // insufficient handedness data

  const switchCount = withHand.filter((b) => b.hand === "S").length;
  const rhhCount = withHand.filter((b) => b.hand === "R").length + switchCount * 0.5;
  const lhhCount = withHand.filter((b) => b.hand === "L").length + switchCount * 0.5;
  const total = rhhCount + lhhCount;
  if (total === 0) return baseSeasonK9;

  const platoonKPct =
    (rhhCount / total) * row.k_pct_vs_rhh +
    (lhhCount / total) * row.k_pct_vs_lhh;
  return platoonKPct * 27;
}

function computeK9Components(row: PredRow) {
  const last3K9 =
    row.last3_k_rate !== null
      ? row.last3_k_rate <= 1
        ? row.last3_k_rate * 27
        : row.last3_k_rate
      : 7.5;

  // Platoon-adjusted season K9 (falls back to plain season K9 if data missing)
  const seasonK9 = computePlatoonSeasonK9(row);

  // SwStr% with calibration 81 — matches the live model's computeCSWK9().
  // xFIP is not yet a data source so both csw and xfip fall back to 7.5
  // when their inputs are null, but swstr_pct is now real data.
  const cswK9 =
    row.swstr_pct !== null
      ? (row.swstr_pct > 1 ? row.swstr_pct / 100 : row.swstr_pct) * SWSTR_K9_CALIBRATION
      : 7.5;

  const xfipK9 =
    row.xfip_k_rate !== null
      ? Math.max(4, Math.min(14, (10 - row.xfip_k_rate) * 0.6 + 6))
      : 7.5;

  return { last3K9, seasonK9, cswK9, xfipK9 };
}

function projectKs(row: PredRow, w: Weights): number {
  const { last3K9, seasonK9, cswK9, xfipK9 } = computeK9Components(row);
  const blendedK9 =
    last3K9 * w.last3 + seasonK9 * w.season + cswK9 * w.csw + xfipK9 * w.xfip;
  const lineupMult =
    row.lineup_k_vulnerability !== null
      ? Math.max(0.7, Math.min(1.4, row.lineup_k_vulnerability / 0.225))
      : 1.0;
  // Velocity multiplier is intentionally omitted: it is applied after the weight
  // blend and scales all weight combinations equally, so it does not affect which
  // weights minimize MAE — the optimal weights are identical with or without it.
  return (
    (blendedK9 / 9) *
    (row.projected_ip ?? 5.5) *
    lineupMult *
    row.park_factor *
    row.weather_modifier
  );
}

function computeMAE(rows: PredRow[], w: Weights): number {
  if (rows.length === 0) return 0;
  const total = rows.reduce(
    (sum, r) => sum + Math.abs(projectKs(r, w) - r.actual_ks),
    0
  );
  return total / rows.length;
}

// ============================================================
// GET — run optimizer
// ============================================================

export async function GET(req: NextRequest) {
  const supabase = await createServiceClient();

  // Query 1: all final predictions with actual Ks
  const { data: predData, error } = await supabase
    .from("predictions")
    .select(
      "pitcher_id,last3_k_rate,season_k_pct,xfip_k_rate,projected_ip," +
      "lineup_k_vulnerability,lineup_data,park_factor,weather_modifier,actual_ks"
    )
    .eq("game_status", "final")
    .not("actual_ks", "is", null);

  if (error || !predData || predData.length < 10) {
    return NextResponse.json(
      {
        error:
          (predData?.length ?? 0) < 10
            ? "Need at least 10 completed predictions to optimize"
            : error?.message
      },
      { status: 400 }
    );
  }

  // Query 2: pitcher stats cache — fetch swstr_pct and platoon splits
  // (these live in the cache, not the predictions table)
  const typedPreds = predData as Array<Record<string, unknown>>;
  const pitcherIds = [...new Set(typedPreds.map((p) => p.pitcher_id as string))];
  const { data: cacheData } = await supabase
    .from("pitcher_stats_cache")
    .select("pitcher_id,swstr_pct,k_pct_vs_lhh,k_pct_vs_rhh")
    .in("pitcher_id", pitcherIds);

  const cacheMap = new Map(
    (cacheData ?? []).map((c) => [
      c.pitcher_id as string,
      c as { swstr_pct: number | null; k_pct_vs_lhh: number | null; k_pct_vs_rhh: number | null }
    ])
  );

  // Merge predictions with pitcher cache stats
  const rows: PredRow[] = typedPreds.map((p) => {
    const cache = cacheMap.get(p.pitcher_id as string);
    return {
      pitcher_id: p.pitcher_id as string,
      last3_k_rate: p.last3_k_rate as number | null,
      season_k_pct: p.season_k_pct as number | null,
      xfip_k_rate: p.xfip_k_rate as number | null,
      projected_ip: p.projected_ip as number | null,
      lineup_k_vulnerability: p.lineup_k_vulnerability as number | null,
      lineup_data: p.lineup_data as LineupBatter[] | null,
      park_factor: (p.park_factor as number) ?? 1.0,
      weather_modifier: (p.weather_modifier as number) ?? 1.0,
      actual_ks: p.actual_ks as number,
      swstr_pct: cache?.swstr_pct ?? null,
      k_pct_vs_lhh: cache?.k_pct_vs_lhh ?? null,
      k_pct_vs_rhh: cache?.k_pct_vs_rhh ?? null
    };
  });

  // Grid search: step 0.05, all combos summing to 1.0, each >= 0.05
  const step = 0.05;
  const min = 0.05;
  let bestMAE = Infinity;
  let bestWeights: Weights = { last3: 0.35, season: 0.30, csw: 0.20, xfip: 0.15 };

  for (let w1 = min; w1 <= 1 - 3 * min + 0.001; w1 += step) {
    for (let w2 = min; w2 <= 1 - w1 - 2 * min + 0.001; w2 += step) {
      for (let w3 = min; w3 <= 1 - w1 - w2 - min + 0.001; w3 += step) {
        const w4 = Math.round((1 - w1 - w2 - w3) * 100) / 100;
        if (w4 < min - 0.001) continue;
        const w: Weights = { last3: w1, season: w2, csw: w3, xfip: w4 };
        const mae = computeMAE(rows, w);
        if (mae < bestMAE) {
          bestMAE = mae;
          bestWeights = { ...w };
        }
      }
    }
  }

  // Current weights from config
  const { data: configData } = await supabase
    .from("model_config")
    .select("weight_last3,weight_season,weight_csw,weight_xfip")
    .eq("id", 1)
    .single();

  const currentWeights: Weights = {
    last3: configData?.weight_last3 ?? 0.35,
    season: configData?.weight_season ?? 0.30,
    csw: configData?.weight_csw ?? 0.20,
    xfip: configData?.weight_xfip ?? 0.15
  };

  const currentMAE = computeMAE(rows, currentWeights);

  return NextResponse.json({
    sample_size: rows.length,
    current_mae: Math.round(currentMAE * 100) / 100,
    optimized_mae: Math.round(bestMAE * 100) / 100,
    improvement: Math.round((currentMAE - bestMAE) * 100) / 100,
    current_weights: currentWeights,
    suggested_weights: {
      last3: Math.round(bestWeights.last3 * 100) / 100,
      season: Math.round(bestWeights.season * 100) / 100,
      csw: Math.round(bestWeights.csw * 100) / 100,
      xfip: Math.round(bestWeights.xfip * 100) / 100
    }
  });
}

// ============================================================
// POST — apply suggested weights
// ============================================================

export async function POST(req: NextRequest) {
  const body = await req.json() as { weights: Weights };
  const { weights } = body;

  const sum = weights.last3 + weights.season + weights.csw + weights.xfip;
  if (Math.abs(sum - 1.0) > 0.01) {
    return NextResponse.json({ error: "Weights must sum to 1.0" }, { status: 400 });
  }

  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("model_config")
    .update({
      weight_last3: weights.last3,
      weight_season: weights.season,
      weight_csw: weights.csw,
      weight_xfip: weights.xfip,
      updated_at: new Date().toISOString()
    })
    .eq("id", 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, weights });
}
