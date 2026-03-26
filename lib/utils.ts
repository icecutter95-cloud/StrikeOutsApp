import type { ModelConfig } from "@/lib/types";

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
// Date helpers
// ============================================================

/**
 * Format a Date object to YYYY-MM-DD string.
 */
export function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Format a game time ISO string to a readable local time like "7:05 PM".
 */
export function formatGameTime(isoString: string | null): string {
  if (!isoString) return "TBD";
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}
