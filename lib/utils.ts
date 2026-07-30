import type { ModelConfig, Prediction } from "@/lib/types";

// ============================================================
// Odds helpers
// ============================================================

/**
 * Convert American odds to implied probability (raw, not deviggged).
 */
export function americanToImplied(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  }
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/**
 * Remove the vig from a two-sided market (over / under American odds).
 * Returns true probabilities that sum to 1.
 */
export function devig(
  overOdds: number,
  underOdds: number
): { over: number; under: number } {
  const rawOver = americanToImplied(overOdds);
  const rawUnder = americanToImplied(underOdds);
  const total = rawOver + rawUnder;
  return {
    over: rawOver / total,
    under: rawUnder / total
  };
}

// ============================================================
// Poisson distribution
// ============================================================

/**
 * Log-factorial helper using Stirling approximation for large k,
 * exact sum for small k.
 */
function logFactorial(k: number): number {
  if (k <= 1) return 0;
  let result = 0;
  for (let i = 2; i <= k; i++) {
    result += Math.log(i);
  }
  return result;
}

/**
 * Poisson PMF: P(X = k) = e^(-λ) * λ^k / k!
 * Computed in log-space for numerical stability.
 */
export function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  const logP = -lambda + k * Math.log(lambda) - logFactorial(k);
  return Math.exp(logP);
}

/**
 * Poisson CDF: P(X <= k) = sum_{i=0}^{floor(k)} P(X = i)
 */
export function poissonCDF(k: number, lambda: number): number {
  const kFloor = Math.floor(k);
  if (kFloor < 0) return 0;
  let cumulative = 0;
  for (let i = 0; i <= kFloor; i++) {
    cumulative += poissonPMF(i, lambda);
  }
  return Math.min(cumulative, 1);
}

/**
 * P(X > line) using Poisson distribution.
 * For a half-point line (e.g. 5.5): P(X > 5.5) = P(X >= 6) = 1 - P(X <= 5)
 * For a whole number (e.g. 6): P(X > 6) = 1 - P(X <= 6)
 */
export function poissonProbOver(line: number, lambda: number): number {
  return 1 - poissonCDF(Math.floor(line), lambda);
}

// ============================================================
// Formatting helpers
// ============================================================

/**
 * Format American odds as string (+150, -110).
 */
export function formatOdds(odds: number): string {
  if (odds >= 0) return `+${odds}`;
  return `${odds}`;
}

/**
 * Format edge percentage as string (+5.2%, -1.3%).
 */
export function formatEdge(edge: number): string {
  const pct = (edge * 100).toFixed(1);
  return edge >= 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * Return Tailwind color/text class based on recommendation.
 */
export function getRecommendationColor(rec: string): string {
  switch (rec) {
    case "BET_OVER":
      return "text-green-400";
    case "BET_UNDER":
      return "text-blue-400";
    case "NO_BET":
    default:
      return "text-slate-400";
  }
}

/**
 * Determine unit size based on edge% and model config thresholds.
 * Returns 0 if below tier 1 minimum (NO_BET zone).
 */
export function getBetUnits(edgePct: number, config: ModelConfig): number {
  if (edgePct >= config.edge_tier3_min) return config.edge_tier3_units;
  if (edgePct >= config.edge_tier2_min) return config.edge_tier2_units;
  if (edgePct >= config.edge_tier1_min) return config.edge_tier1_units;
  return 0;
}

// ============================================================
// Model version helpers
// ============================================================

/**
 * A prediction's live recommendation.
 *
 * v2 (shrunk projection + margin/form gating) is what should be bet, but the v1
 * fields keep being written in parallel so the two models stay comparable. Rows
 * predating the v2 migration have no adjusted_* values and fall back to v1.
 */
export function getActiveRecommendation(
  p: Pick<Prediction, "recommendation" | "adjusted_recommendation">
): "BET_OVER" | "BET_UNDER" | "NO_BET" | null {
  return p.adjusted_recommendation ?? p.recommendation;
}

export function getActiveEdge(
  p: Pick<Prediction, "edge_pct" | "adjusted_edge_pct" | "adjusted_recommendation">
): number | null {
  if (p.adjusted_recommendation !== null) return p.adjusted_edge_pct;
  return p.edge_pct;
}

export function getActiveUnits(
  p: Pick<Prediction, "recommended_units" | "adjusted_units" | "adjusted_recommendation">
): number | null {
  if (p.adjusted_recommendation !== null) return p.adjusted_units;
  return p.recommended_units;
}

/**
 * Gap in Ks between the raw projection and the prop line, measured toward the
 * recommended side. This is v2's primary gate (>= 1.5) and the strongest single
 * filter in the season backtest, so it's also useful as a dashboard sort key.
 *
 * With no live bet there's no side to measure toward, so fall back to the
 * absolute distance. Returns null when either input is missing.
 */
export function getProjectionMargin(
  p: Pick<
    Prediction,
    "projected_ks" | "prop_line" | "recommendation" | "adjusted_recommendation"
  >
): number | null {
  if (p.projected_ks === null || p.prop_line === null) return null;
  const proj = Number(p.projected_ks);
  const line = Number(p.prop_line);
  const rec = getActiveRecommendation(p);

  if (rec === "BET_UNDER") return line - proj;
  if (rec === "BET_OVER") return proj - line;
  return Math.abs(proj - line);
}

/** True when the live recommendation is an actual bet. */
export function isActiveBet(
  p: Pick<Prediction, "recommendation" | "adjusted_recommendation">
): boolean {
  const rec = getActiveRecommendation(p);
  return rec !== null && rec !== "NO_BET";
}

/**
 * Whether a specific v2 gate is among the ones that vetoed a bet.
 * adjusted_gate_reason is comma-separated when a bet fails more than one gate
 * (e.g. "margin,form"), so this can't be a strict equality check.
 */
export function gateFailed(
  gateReason: string | null,
  gate: "edge" | "margin" | "form"
): boolean {
  return gateReason?.split(",").includes(gate) ?? false;
}

// ============================================================
// Date helpers
// ============================================================

/**
 * Format a Date object to YYYY-MM-DD string (UTC).
 */
export function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * The current MLB "slate date" — today in US Eastern time.
 *
 * Vercel crons fire on UTC, so any job running after 8 PM ET sees a UTC date
 * that has already rolled over to tomorrow. That silently pointed the 2 AM UTC
 * refresh (10 PM ET) at an empty slate and made the late-evening fetch-odds runs
 * poll tomorrow's games while tonight's were still live. Baseball's day is
 * Eastern, so schedule-facing code should be too.
 */
export function toEasternDateString(date: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, and timeZone handles DST automatically.
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Format a game time ISO string to Eastern Time, e.g. "7:05 PM ET".
 */
export function formatGameTime(isoString: string | null): string {
  if (!isoString) return "TBD";
  const d = new Date(isoString);
  return (
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York"
    }) + " ET"
  );
}
