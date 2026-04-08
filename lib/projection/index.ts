import type {
  PitcherStats,
  LineupPlayer,
  ModelConfig,
  ProjectionResult
} from "@/lib/types";
import { getParkFactor } from "@/lib/data/fangraphs";
import { getWeatherModifier } from "@/lib/data/weather";
import {
  devig,
  poissonProbOver,
  poissonCDF,
  getBetUnits
} from "@/lib/utils";

// League average K% (2024 MLB: ~22.5%)
const LEAGUE_AVG_K_PCT = 0.225;

// League average O-Swing% (2024 MLB: ~30%)
const LEAGUE_AVG_OSWING = 0.30;

// Default pitcher workload constants
const PITCHES_PER_INNING = 15.5;
const MAX_IP = 7.0;
const MIN_IP = 3.0;

// CSW calibration: CSW% of ~28% ≈ 7 K/9 historically
// Linear: K/9 ≈ CSW% * 25 (empirical)
const CSW_CALIBRATION = 25;

// SwStr% calibration: league avg SwStr% ~10.5% ≈ 8.5 K/9 historically
// Linear: K/9 ≈ SwStr% * 81 (empirical — used when CSW% is unavailable)
const SWSTR_K9_CALIBRATION = 81;

// Confidence interval half-width (Poisson 80% CI approximation)
const CI_HALF_WIDTH = 1.5;

/**
 * Early season weight adjustment.
 * Reduces reliance on last3 K rate when sample is thin (first 6 weeks of season).
 * Redistributes the reduced weight proportionally to season, csw, xfip.
 */
function getSeasonalWeights(
  config: ModelConfig,
  gameTime: Date
): { last3: number; season: number; csw: number; xfip: number } {
  const month = gameTime.getMonth() + 1;
  const day = gameTime.getDate();

  // How much to scale down the last3 weight (1.0 = no change)
  let last3Mult = 1.0;
  if (month === 3) {
    last3Mult = 0.30; // Opening week — almost no sample
  } else if (month === 4 && day <= 14) {
    last3Mult = 0.50; // Weeks 2–3
  } else if (month === 4 && day <= 28) {
    last3Mult = 0.70; // Weeks 4–5
  } else if (month === 5 && day <= 12) {
    last3Mult = 0.85; // Weeks 6–7
  }

  const effectiveLast3 = config.weight_last3 * last3Mult;
  const freed = config.weight_last3 * (1 - last3Mult);
  const otherTotal = config.weight_season + config.weight_csw + config.weight_xfip;

  return {
    last3: effectiveLast3,
    season: config.weight_season + freed * (config.weight_season / otherTotal),
    csw: config.weight_csw + freed * (config.weight_csw / otherTotal),
    xfip: config.weight_xfip + freed * (config.weight_xfip / otherTotal)
  };
}

// ============================================================
// Stuff quality & velocity helpers
// ============================================================

function computeOSwingMultiplier(stats: PitcherStats): number {
  if (stats.o_swing_pct === null) return 1.0;
  // High chase rate helps Ks; dampened effect
  const ratio = stats.o_swing_pct / LEAGUE_AVG_OSWING;
  return Math.max(0.90, Math.min(1.10, Math.pow(ratio, 0.3)));
}

function computeVelocityMultiplier(stats: PitcherStats): number {
  if (stats.last3_avg_velocity === null || stats.season_avg_velocity === null) return 1.0;
  const trend = stats.last3_avg_velocity - stats.season_avg_velocity;
  // Only apply a penalty for significant velocity drops (> 1 mph below season avg)
  // No bonus for being up — velo spikes don't reliably predict more Ks
  if (trend >= -1.0) return 1.0;
  // Scale: -2 mph → ~0.97x, -3 mph → ~0.94x, max penalty 10% at -4+ mph
  const penalty = Math.min(0.10, (-trend - 1.0) * 0.033);
  return 1.0 - penalty;
}

function computePlatoonAdjustedSeasonK9(
  stats: PitcherStats,
  lineup: LineupPlayer[]
): number {
  const baseSeasonK9 = computeSeasonK9(stats);

  // Need both platoon splits to do lineup-specific adjustment
  if (stats.k_pct_vs_lhh === null || stats.k_pct_vs_rhh === null) return baseSeasonK9;

  // Compute lineup handedness composition from known batter hands
  const battersWithHand = lineup.filter((b) => b.hand !== null);
  if (battersWithHand.length < 4) return baseSeasonK9; // insufficient data

  const switchCount = battersWithHand.filter((b) => b.hand === "S").length;
  const rhhCount = battersWithHand.filter((b) => b.hand === "R").length + switchCount * 0.5;
  const lhhCount = battersWithHand.filter((b) => b.hand === "L").length + switchCount * 0.5;
  const total = rhhCount + lhhCount;
  if (total === 0) return baseSeasonK9;

  const pctRhh = rhhCount / total;
  const pctLhh = lhhCount / total;

  const platoonKPct = pctRhh * stats.k_pct_vs_rhh + pctLhh * stats.k_pct_vs_lhh;
  return platoonKPct * 27; // convert K% to K/9 (approx 27 batters per 9 IP)
}

// ============================================================
// Main projection function
// ============================================================

/**
 * Generates a complete projection for a pitcher against a given lineup.
 *
 * @param pitcherStats - Cached pitcher stats from pitcher_stats_cache
 * @param lineup       - Batter list with K% vs pitcher hand (may be empty if unconfirmed)
 * @param pitcherHand  - 'R' or 'L'
 * @param venue        - Venue name (for park factor)
 * @param gameTime     - Game start time (for weather)
 * @param propLine     - Current prop line (null if not yet available)
 * @param propOddsOver  - American odds for Over (null if not available)
 * @param propOddsUnder - American odds for Under (null if not available)
 * @param config       - Model configuration weights and thresholds
 * @param weatherModifier - Pre-fetched weather modifier (optional; fetched here if omitted)
 */
export async function generateProjection(
  pitcherStats: PitcherStats,
  lineup: LineupPlayer[],
  pitcherHand: "R" | "L",
  venue: string,
  gameTime: Date,
  propLine: number | null,
  propOddsOver: number | null,
  propOddsUnder: number | null,
  config: ModelConfig,
  weatherModifier?: number
): Promise<ProjectionResult> {

  // ----------------------------------------------------------
  // Step 1: Compute baseline K/9 for each component
  // ----------------------------------------------------------

  const last3K9 = computeLast3K9(pitcherStats);
  const seasonK9 = computePlatoonAdjustedSeasonK9(pitcherStats, lineup);
  const cswK9 = computeCSWK9(pitcherStats);
  const xfipK9 = computeXFIPK9(pitcherStats);

  // Weighted blend
  const seasonalWeights = getSeasonalWeights(config, gameTime);
  const blendedK9 =
    last3K9 * seasonalWeights.last3 +
    seasonK9 * seasonalWeights.season +
    cswK9 * seasonalWeights.csw +
    xfipK9 * seasonalWeights.xfip;

  // ----------------------------------------------------------
  // Step 2: Projected IP
  // ----------------------------------------------------------
  const projectedIp = computeProjectedIP(pitcherStats);

  // ----------------------------------------------------------
  // Step 3: Lineup vulnerability
  // ----------------------------------------------------------
  const { lineupMultiplier, lineupKVulnerability, lineupStatus } =
    computeLineupFactor(lineup, pitcherHand);

  // ----------------------------------------------------------
  // Step 4: Park factor
  // ----------------------------------------------------------
  const parkFactor = getParkFactor(venue);

  // ----------------------------------------------------------
  // Step 5: Weather modifier
  // ----------------------------------------------------------
  const finalWeatherModifier =
    weatherModifier ?? (await getWeatherModifier(venue, gameTime));

  // ----------------------------------------------------------
  // Step 6: Final projected Ks
  // ----------------------------------------------------------
  // projected_ks = (K/9 / 9) * IP * lineup_multiplier * park * weather
  const projectedKs =
    (blendedK9 / 9) *
    projectedIp *
    lineupMultiplier *
    parkFactor *
    finalWeatherModifier;

  // ----------------------------------------------------------
  // Step 6b: Stuff quality & velocity multipliers
  // ----------------------------------------------------------
  // SwStr% is already incorporated into the weight blend via computeCSWK9 — not double-counted here.
  const oSwingMultiplier = computeOSwingMultiplier(pitcherStats);
  const velocityMultiplier = computeVelocityMultiplier(pitcherStats);

  const adjustedProjectedKs = projectedKs * oSwingMultiplier * velocityMultiplier;

  // ----------------------------------------------------------
  // Step 7: Confidence interval (±CI or Poisson 80% CI)
  // ----------------------------------------------------------
  const [confidenceLow, confidenceHigh] = computeConfidenceInterval(adjustedProjectedKs);

  // ----------------------------------------------------------
  // Step 8: EV / edge calculation (only if prop line available)
  // ----------------------------------------------------------
  let modelProbOver = 0;
  let modelProbUnder = 0;
  let bookImpliedOver: number | null = null;
  let bookImpliedUnder: number | null = null;
  let edgePct = 0;
  let recommendation: "BET_OVER" | "BET_UNDER" | "NO_BET" = "NO_BET";
  let recommendedUnits = 0;

  if (propLine !== null) {
    modelProbOver = poissonProbOver(propLine, adjustedProjectedKs);
    modelProbUnder = 1 - modelProbOver;

    if (propOddsOver !== null && propOddsUnder !== null) {
      const deviggedOdds = devig(propOddsOver, propOddsUnder);
      bookImpliedOver = deviggedOdds.over;
      bookImpliedUnder = deviggedOdds.under;

      const edgeOver = modelProbOver - bookImpliedOver;
      const edgeUnder = modelProbUnder - bookImpliedUnder;

      // Apply lineup confirmation penalty to edge
      const lineupPenalty =
        lineupStatus === "unconfirmed" ? config.unconfirmed_lineup_penalty : 0;

      const adjustedEdgeOver = edgeOver - lineupPenalty;
      const adjustedEdgeUnder = edgeUnder - lineupPenalty;

      if (adjustedEdgeOver > adjustedEdgeUnder && adjustedEdgeOver > 0) {
        edgePct = adjustedEdgeOver;
        recommendation = "BET_OVER";
      } else if (adjustedEdgeUnder > adjustedEdgeOver && adjustedEdgeUnder > 0) {
        edgePct = adjustedEdgeUnder;
        recommendation = "BET_UNDER";
      } else {
        edgePct = Math.max(adjustedEdgeOver, adjustedEdgeUnder);
        recommendation = "NO_BET";
      }

      recommendedUnits =
        recommendation !== "NO_BET" ? getBetUnits(edgePct, config) : 0;

      // If getBetUnits returned 0 despite positive edge (below tier 1 min), keep NO_BET
      if (recommendedUnits === 0) recommendation = "NO_BET";
    }
  }

  return {
    projected_ks: Math.max(0, adjustedProjectedKs),
    confidence_low: Math.max(0, confidenceLow),
    confidence_high: confidenceHigh,
    model_prob_over: modelProbOver,
    model_prob_under: modelProbUnder,
    edge_pct: edgePct,
    recommendation,
    recommended_units: recommendedUnits,
    projected_ip: projectedIp,
    steam_flag: false, // Set by cron job after monitoring
    lineup_confirmation_status: lineupStatus,
    lineup_k_vulnerability: lineupKVulnerability,
    park_factor: parkFactor,
    weather_modifier: finalWeatherModifier,
    book_implied_over: bookImpliedOver,
    book_implied_under: bookImpliedUnder
  };
}

// ============================================================
// Component helpers
// ============================================================

function computeLast3K9(stats: PitcherStats): number {
  // last3_k_rate stored as K per PA (rate), convert to K/9
  if (stats.last3_k_rate !== null) {
    // If stored as rate (0-1 range), convert to K/9
    if (stats.last3_k_rate <= 1) {
      return stats.last3_k_rate * 27; // ~27 batters per 9 IP
    }
    return stats.last3_k_rate; // assume already K/9
  }
  // Fallback to season K9
  return stats.season_k9 ?? 7.5;
}

function computeSeasonK9(stats: PitcherStats): number {
  if (stats.season_k9 !== null) return stats.season_k9;
  if (stats.season_k_pct !== null) {
    const pct = stats.season_k_pct > 1 ? stats.season_k_pct / 100 : stats.season_k_pct;
    return pct * 27;
  }
  return 7.5; // league average fallback
}

function computeCSWK9(stats: PitcherStats): number {
  // Prefer SwStr% (reliably fetched from Savant game log) over CSW%
  // (CSW% requires a different endpoint and is currently unavailable).
  // Both measure bat-missing ability — SwStr% is whiffs only, CSW% adds called strikes.
  // SwStr% calibration: 10.5% avg ≈ 8.5 K/9 → K/9 = swstr_pct * 81
  if (stats.swstr_pct !== null) {
    const pct = stats.swstr_pct > 1 ? stats.swstr_pct / 100 : stats.swstr_pct;
    return pct * SWSTR_K9_CALIBRATION;
  }
  // Fallback to CSW% if ever available
  if (stats.csw_pct !== null) {
    const pct = stats.csw_pct > 1 ? stats.csw_pct / 100 : stats.csw_pct;
    return pct * CSW_CALIBRATION;
  }
  return 7.5; // league average fallback
}

function computeXFIPK9(stats: PitcherStats): number {
  // If we have a stored xfip_k_rate, use it
  // Otherwise approximate from xFIP: lower xFIP → more Ks
  // Rough linear: K/9 ≈ (10 - xFIP) * 0.6 + 6, clamped to [4, 14]
  if (stats.xfip !== null) {
    const k9 = (10 - stats.xfip) * 0.6 + 6;
    return Math.max(4, Math.min(14, k9));
  }
  return 7.5; // neutral fallback
}

function computeProjectedIP(stats: PitcherStats): number {
  const avgPitches = stats.avg_pitches_per_start;
  if (avgPitches !== null && avgPitches > 0) {
    const projectedInnings = avgPitches / PITCHES_PER_INNING;
    return Math.max(MIN_IP, Math.min(MAX_IP, projectedInnings));
  }

  // Fallback: use last start as a proxy
  if (stats.last_start_ip !== null) {
    return Math.max(MIN_IP, Math.min(MAX_IP, stats.last_start_ip));
  }

  return 5.5; // neutral fallback
}

interface LineupFactorResult {
  lineupMultiplier: number;
  lineupKVulnerability: number;
  lineupStatus: "confirmed" | "partial" | "unconfirmed";
}

function computeLineupFactor(
  lineup: LineupPlayer[],
  pitcherHand: "R" | "L"
): LineupFactorResult {
  if (!lineup || lineup.length === 0) {
    return {
      lineupMultiplier: 1.0,
      lineupKVulnerability: LEAGUE_AVG_K_PCT,
      lineupStatus: "unconfirmed"
    };
  }

  const confirmedBatters = lineup.filter(
    (b) =>
      (pitcherHand === "R" ? b.k_pct_vs_rhp : b.k_pct_vs_lhp) !== null
  );

  let lineupStatus: "confirmed" | "partial" | "unconfirmed";
  if (lineup.length >= 8 && confirmedBatters.length >= 6) {
    lineupStatus = "confirmed";
  } else if (lineup.length >= 5 || confirmedBatters.length >= 4) {
    lineupStatus = "partial";
  } else {
    lineupStatus = "unconfirmed";
  }

  // If fewer than 6 batter K-rates known, use neutral multiplier
  if (confirmedBatters.length < 6) {
    return {
      lineupMultiplier: 1.0,
      lineupKVulnerability: LEAGUE_AVG_K_PCT,
      lineupStatus
    };
  }

  // Batting order weights: top of order sees more PAs
  const orderWeights: Record<number, number> = {
    1: 1.10, 2: 1.10, 3: 1.10, 4: 1.10,
    5: 1.00, 6: 1.00, 7: 1.00,
    8: 0.85, 9: 0.85
  };

  let weightedKPct = 0;
  let totalWeight = 0;

  for (const batter of lineup) {
    const kPct =
      pitcherHand === "R" ? batter.k_pct_vs_rhp : batter.k_pct_vs_lhp;
    if (kPct === null) continue;

    const weight = orderWeights[batter.batting_order] ?? 1.0;
    weightedKPct += kPct * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return {
      lineupMultiplier: 1.0,
      lineupKVulnerability: LEAGUE_AVG_K_PCT,
      lineupStatus
    };
  }

  const avgLineupKPct = weightedKPct / totalWeight;
  const lineupMultiplier = avgLineupKPct / LEAGUE_AVG_K_PCT;

  return {
    lineupMultiplier: Math.max(0.7, Math.min(1.4, lineupMultiplier)),
    lineupKVulnerability: avgLineupKPct,
    lineupStatus
  };
}

function computeConfidenceInterval(
  projectedKs: number
): [number, number] {
  // Simple ±1.5 K interval
  // Could use Poisson 80% CI: lower = floor(lambda - 1.28*sqrt(lambda)), etc.
  const low = Math.max(0, projectedKs - CI_HALF_WIDTH);
  const high = projectedKs + CI_HALF_WIDTH;
  return [Math.round(low * 10) / 10, Math.round(high * 10) / 10];
}

// ============================================================
// Utility: compute CLV (closing line value)
// ============================================================

/**
 * Compute closing line value for a completed prediction.
 * Positive CLV = bet was on good side of the closing line.
 */
export function computeCLV(
  betSide: string,
  openingLine: number | null,
  closingLine: number | null
): number | null {
  if (!openingLine || !closingLine || !betSide) return null;

  if (betSide === "over") {
    // Positive if line moved up (fewer Ks expected → over becomes harder)
    // CLV = closing_line - opening_line (negative = line moved away from you)
    return closingLine - openingLine;
  } else if (betSide === "under") {
    return openingLine - closingLine;
  }
  return null;
}

// ============================================================
// Utility: determine model_correct
// ============================================================

export function determineModelCorrect(
  recommendation: string | null,
  propLine: number | null,
  actualKs: number | null
): boolean | null {
  if (!recommendation || propLine === null || actualKs === null) return null;
  if (recommendation === "NO_BET") return null;

  if (recommendation === "BET_OVER") {
    return actualKs > propLine;
  } else if (recommendation === "BET_UNDER") {
    return actualKs < propLine;
  }
  return null;
}

// ============================================================
// Utility: determine bet_result
// ============================================================

export function determineBetResult(
  userBetSide: string | null,
  propLine: number | null,
  actualKs: number | null
): "win" | "loss" | "push" | null {
  if (!userBetSide || propLine === null || actualKs === null) return null;

  // Check for push (exactly on the line — only possible for whole numbers)
  if (actualKs === propLine) return "push";

  if (userBetSide === "over") {
    return actualKs > propLine ? "win" : "loss";
  } else if (userBetSide === "under") {
    return actualKs < propLine ? "win" : "loss";
  }
  return null;
}
