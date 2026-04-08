import type { PitcherStats, BatterStats } from "@/lib/types";

// ============================================================
// Simple CSV parser
// ============================================================

/**
 * Parse a CSV string into an array of row objects keyed by header names.
 * Handles quoted fields (e.g. "Smith, Jr.").
 */
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCSVRow(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCSVRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return rows;
}

function splitCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ============================================================
// Fetch helpers
// ============================================================

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; StrikeOutsApp/1.0; +https://github.com/strikeoutsapp)"
};

async function fetchCSV(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url, {
    headers: DEFAULT_HEADERS,
    next: { revalidate: 3600 }
  });
  if (!res.ok) {
    throw new Error(`Baseball Savant CSV fetch failed (${res.status}): ${url}`);
  }
  const text = await res.text();
  return parseCSV(text);
}

// ============================================================
// Pitcher season stats
// ============================================================

/**
 * Fetch pitcher season stats from Baseball Savant.
 * Uses the statcast search CSV endpoint filtered to a single pitcher.
 *
 * NOTE: The exact endpoint parameters may need adjustment for the current
 * season. The leaderboard endpoint below is more stable for single-pitcher
 * lookups but Baseball Savant does not have a guaranteed public JSON API —
 * this uses the CSV download which is subject to rate limiting.
 */
export async function getPitcherSeasonStats(
  pitcherId: number
): Promise<Partial<PitcherStats>> {
  // Statcast leaderboard CSV for a specific pitcher
  // TODO: Verify endpoint URL each season; Baseball Savant may update parameters
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv` +
    `?hfGT=R%7C&hfSea=2026%7C&player_type=pitcher` +
    `&group_by=name&min_pitches=0&sort_col=pitches&sort_order=desc` +
    `&chk_stats_k_percent=on&chk_stats_csw_percent=on&chk_stats_swstr_percent=on` +
    `&chk_stats_o_swing_percent=on&chk_stats_avg_speed=on` +
    `&player_id=${pitcherId}&type=summary`;

  try {
    const rows = await fetchCSV(url);
    if (rows.length === 0) return {};

    const row = rows[0];

    const season_k_pct = parseFloatSafe(row["k_percent"]) ?? parseFloatSafe(row["k%"]);
    const csw_pct = parseFloatSafe(row["csw_percent"]) ?? parseFloatSafe(row["csw%"]);
    const swstr_pct = parseFloatSafe(row["swstr_percent"]) ?? parseFloatSafe(row["swstr%"]);
    const o_swing_pct = parseFloatSafe(row["o_swing_percent"]) ?? parseFloatSafe(row["o_swing%"]);
    const avg_speed = parseFloatSafe(row["avg_speed"]) ?? parseFloatSafe(row["velocity"]) ?? parseFloatSafe(row["release_speed"]);

    // K/9 can be derived from k% and estimated PA/IP
    // If season_k_pct is a percentage like 28.5, divide by 100
    const k_pct_normalized =
      season_k_pct !== null && season_k_pct > 1
        ? season_k_pct / 100
        : season_k_pct;

    const season_k9 =
      k_pct_normalized !== null
        ? k_pct_normalized * 27 // approx 27 batters per 9 IP
        : null;

    return {
      season_k_pct: k_pct_normalized ?? undefined,
      season_k9: season_k9 ?? undefined,
      csw_pct:
        csw_pct !== null && csw_pct > 1 ? csw_pct / 100 : csw_pct ?? undefined,
      swstr_pct:
        swstr_pct !== null && swstr_pct > 1
          ? swstr_pct / 100
          : swstr_pct ?? undefined,
      o_swing_pct: o_swing_pct !== null && o_swing_pct > 1 ? o_swing_pct / 100 : o_swing_pct ?? undefined,
      season_avg_velocity: avg_speed ?? undefined,
    } as Partial<PitcherStats>;
  } catch (err) {
    console.error("[baseball-savant] getPitcherSeasonStats error:", err);
    return {};
  }
}

// ============================================================
// Pitcher recent velocity (Baseball Savant)
// ============================================================

/**
 * Fetch average velocity for each of the pitcher's last 3 starts
 * using Baseball Savant's per-game grouped Statcast data.
 * Returns the average of those starts' velocities, or null if unavailable.
 */
export async function getPitcherRecentVelocity(
  pitcherId: number
): Promise<number | null> {
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv` +
    `?hfGT=R%7C&hfSea=2026%7C&player_type=pitcher` +
    `&group_by=name-date&min_pitches=20&sort_col=game_date&sort_order=desc` +
    `&chk_stats_avg_speed=on` +
    `&player_id=${pitcherId}&type=summary`;

  try {
    const rows = await fetchCSV(url);
    if (rows.length === 0) return null;

    // Take most recent 3 starts (rows are sorted desc by date)
    const last3 = rows.slice(0, 3);
    const velocities = last3
      .map((r) => parseFloatSafe(r["avg_speed"]) ?? parseFloatSafe(r["velocity"]) ?? parseFloatSafe(r["release_speed"]))
      .filter((v): v is number => v !== null && v > 60);

    if (velocities.length === 0) return null;
    return velocities.reduce((a, b) => a + b, 0) / velocities.length;
  } catch (err) {
    console.error("[baseball-savant] getPitcherRecentVelocity error:", err);
    return null;
  }
}

// ============================================================
// Pitcher platoon splits (MLB Stats API)
// ============================================================

/**
 * Fetch pitcher K% vs LHH and vs RHH using MLB Stats API statSplits.
 * Uses current season first, falls back to prior season, then career.
 * Minimum 50 batters faced per split.
 */
export async function getPitcherPlatoonSplits(
  pitcherId: number
): Promise<{ k_pct_vs_lhh: number | null; k_pct_vs_rhh: number | null }> {
  const currentYear = new Date().getFullYear();
  const empty = { k_pct_vs_lhh: null, k_pct_vs_rhh: null };

  const tryFetch = async (url: string) => {
    try {
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) return null;

      const data = await res.json() as { stats?: Array<{ splits?: Array<{ split?: { code?: string }; stat?: { strikeOuts?: number; battersFaced?: number } }> }> };
      const splits = data.stats?.[0]?.splits ?? [];
      if (splits.length === 0) return null;

      const vsL = splits.find((s) => s.split?.code === "vl");
      const vsR = splits.find((s) => s.split?.code === "vr");

      const kVsL = safePitcherKPct(vsL?.stat?.strikeOuts, vsL?.stat?.battersFaced);
      const kVsR = safePitcherKPct(vsR?.stat?.strikeOuts, vsR?.stat?.battersFaced);

      if (kVsL === null && kVsR === null) return null;
      return { k_pct_vs_lhh: kVsL, k_pct_vs_rhh: kVsR };
    } catch {
      return null;
    }
  };

  return (
    (await tryFetch(`https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=statSplits&group=pitching&season=${currentYear}&sitCodes=vl,vr`)) ??
    (await tryFetch(`https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=statSplits&group=pitching&season=${currentYear - 1}&sitCodes=vl,vr`)) ??
    (await tryFetch(`https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=careerStatSplits&group=pitching&sitCodes=vl,vr`)) ??
    empty
  );
}

function safePitcherKPct(ks?: number, bf?: number): number | null {
  if (ks == null || bf == null || bf < 50) return null;
  return ks / bf;
}

// ============================================================
// Batter strikeout platoon splits (MLB Stats API)
// ============================================================

interface MLBSplit {
  split?: { code?: string };
  stat?: { plateAppearances?: number; strikeOuts?: number };
}

/**
 * Fetch batter K% vs RHP and LHP using the MLB Stats API statSplits endpoint.
 * Tries current season first (statSplits), then falls back to career (careerStatSplits).
 * Minimum 30 PA per split required before trusting the number.
 */
export async function getBatterStrikeoutStats(
  batterId: number
): Promise<Partial<BatterStats>> {
  const currentYear = new Date().getFullYear();

  // Attempt 1: current season statSplits
  const seasonResult = await fetchStatSplits(
    `https://statsapi.mlb.com/api/v1/people/${batterId}/stats` +
    `?stats=statSplits&group=hitting&season=${currentYear}&sitCodes=vl,vr`
  );
  if (seasonResult) return seasonResult;

  // Attempt 2: prior season statSplits (early in season, sample too small)
  const priorResult = await fetchStatSplits(
    `https://statsapi.mlb.com/api/v1/people/${batterId}/stats` +
    `?stats=statSplits&group=hitting&season=${currentYear - 1}&sitCodes=vl,vr`
  );
  if (priorResult) return priorResult;

  // Attempt 3: career splits as last resort
  const careerResult = await fetchStatSplits(
    `https://statsapi.mlb.com/api/v1/people/${batterId}/stats` +
    `?stats=careerStatSplits&group=hitting&sitCodes=vl,vr`
  );
  if (careerResult) return careerResult;

  console.warn(`[batter-stats] No split data found for batter ${batterId}`);
  return {};
}

async function fetchStatSplits(url: string): Promise<Partial<BatterStats> | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;

    const data = await res.json() as { stats?: Array<{ splits?: MLBSplit[] }> };
    const splits: MLBSplit[] = data.stats?.[0]?.splits ?? [];
    if (splits.length === 0) return null;

    const vsR = splits.find((s) => s.split?.code === "vr");
    const vsL = splits.find((s) => s.split?.code === "vl");

    const kVsR = safeKPct(vsR?.stat?.strikeOuts, vsR?.stat?.plateAppearances);
    const kVsL = safeKPct(vsL?.stat?.strikeOuts, vsL?.stat?.plateAppearances);

    if (kVsR === null && kVsL === null) return null;

    return {
      k_pct_vs_rhp: kVsR ?? undefined,
      k_pct_vs_lhp: kVsL ?? undefined
    };
  } catch {
    return null;
  }
}

function safeKPct(ks?: number, pa?: number): number | null {
  if (ks == null || pa == null || pa < 30) return null;
  return ks / pa;
}

// ============================================================
// Helpers
// ============================================================

function parseFloatSafe(value: string | undefined): number | null {
  if (value === undefined || value === "" || value === "null" || value === "N/A") {
    return null;
  }
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}
