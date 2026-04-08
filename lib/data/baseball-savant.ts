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
 *
 * Uses the per-game grouped Statcast endpoint (group_by=name-date), which
 * returns one row per start with aggregated per-game stats. We then average
 * across all starts to get season-level figures.
 *
 * NOTE: The "type=summary" endpoint was found to return raw pitch-level data
 * (one row per pitch) when filtered by player_id — the chk_stats_* parameters
 * only work on the leaderboard view, not player-specific queries. The game log
 * endpoint is the reliable alternative.
 *
 * Available columns from this endpoint:
 *   velocity, effective_speed   → avg pitch velocity per start
 *   swing_miss_percent          → SwStr% per start
 *   k_percent                   → K% per start
 *   whiffs, swings, takes       → raw counts
 *
 * NOT available (O-Swing%, CSW%) — these are null and multipliers default to 1.0.
 */
export async function getPitcherSeasonStats(
  pitcherId: number
): Promise<Partial<PitcherStats>> {
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv` +
    `?hfGT=R%7C&hfSea=2026%7C&player_type=pitcher` +
    `&group_by=name-date&min_pitches=20&sort_col=game_date&sort_order=desc` +
    `&player_id=${pitcherId}`;

  try {
    const rows = await fetchCSV(url);
    if (rows.length === 0) return {};

    const kPcts: number[] = [];
    const velocities: number[] = [];
    // Accumulate raw whiffs + pitches across starts so we can compute a
    // weighted season SwStr% = total_whiffs / total_pitches.
    // NOTE: swing_miss_percent in the game_log = whiffs/swings (not whiffs/pitches),
    // so we must use the raw counts to get true SwStr% (whiffs/total_pitches).
    let totalWhiffs = 0;
    let totalPitches = 0;

    for (const row of rows) {
      const kPct = parseFloatSafe(row["k_percent"]);
      const vel =
        parseFloatSafe(row["velocity"]) ??
        parseFloatSafe(row["effective_speed"]);
      const whiffs = parseFloatSafe(row["whiffs"]);
      const pitches =
        parseFloatSafe(row["total_pitches"]) ??
        parseFloatSafe(row["pitches"]);

      if (kPct !== null && kPct >= 0) kPcts.push(kPct);
      if (vel !== null && vel > 60) velocities.push(vel);
      if (whiffs !== null && pitches !== null && pitches > 0) {
        totalWhiffs += whiffs;
        totalPitches += pitches;
      }
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    const rawKPct = avg(kPcts);
    const season_k_pct =
      rawKPct !== null ? (rawKPct > 1 ? rawKPct / 100 : rawKPct) : null;

    const season_avg_velocity = avg(velocities);

    // True SwStr% = total whiffs / total pitches (weighted across all starts)
    const swstr_pct =
      totalPitches > 0 ? totalWhiffs / totalPitches : null;

    return {
      season_k_pct: season_k_pct ?? undefined,
      season_k9: season_k_pct !== null ? season_k_pct * 27 : undefined,
      swstr_pct: swstr_pct ?? undefined,
      season_avg_velocity: season_avg_velocity ?? undefined,
      // CSW% and O-Swing% not available from this endpoint
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
  // Note: do NOT add type=summary here — it conflicts with group_by=name-date
  // and forces name-only grouping, returning one row for the whole season.
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv` +
    `?hfGT=R%7C&hfSea=2026%7C&player_type=pitcher` +
    `&group_by=name-date&min_pitches=20&sort_col=game_date&sort_order=desc` +
    `&player_id=${pitcherId}`;

  try {
    const rows = await fetchCSV(url);
    if (rows.length === 0) return null;

    // Take most recent 3 starts (rows are sorted desc by date)
    const last3 = rows.slice(0, 3);
    const velocities = last3
      .map((r) =>
        parseFloatSafe(r["velocity"]) ??
        parseFloatSafe(r["effective_speed"])
      )
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
  if (ks == null || bf == null || bf < 30) return null;
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
