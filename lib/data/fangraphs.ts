// ============================================================
// FanGraphs pitcher xFIP leaderboard
// ============================================================

/**
 * Normalise a pitcher name for fuzzy matching:
 *   "José Abreu" → "jose abreu", "Félix Hernández" → "felix hernandez"
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();
}

interface FanGraphsRow {
  PlayerName: string;
  xFIP: number | string | null;
  [key: string]: unknown;
}

interface FanGraphsResponse {
  data?: FanGraphsRow[];
}

/**
 * Fetch the current-season pitcher xFIP leaderboard from FanGraphs.
 * Returns a Map of normalised pitcher name → xFIP value.
 *
 * Uses the major-league leaderboard API (type=1 = dashboard, includes xFIP).
 * qual=0 returns all pitchers regardless of innings minimum.
 * Cached for 1 hour via Next.js fetch cache.
 */
async function fetchFanGraphsXFIPMap(): Promise<Map<string, number>> {
  const season = new Date().getFullYear();
  const url =
    `https://www.fangraphs.com/api/leaders/major-league/data` +
    `?pos=all&stats=pit&lg=all&qual=10&pageitems=2000000000&pagenum=1` +
    `&ind=0&season=${season}&team=0&startdt=&enddt=&month=0` +
    `&hand=&type=1&postseason=&sortdir=desc&sortstat=xFIP`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; StrikeOutsApp/1.0; +https://github.com/strikeoutsapp)",
        Accept: "application/json"
      },
      next: { revalidate: 3600 }
    });

    if (!res.ok) {
      console.warn(`[fangraphs] xFIP fetch failed (${res.status})`);
      return new Map();
    }

    const json = await res.json() as FanGraphsResponse;
    const rows = json?.data ?? [];

    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.PlayerName) continue;
      const xfip = typeof row.xFIP === "number"
        ? row.xFIP
        : typeof row.xFIP === "string"
          ? parseFloat(row.xFIP)
          : NaN;
      // Sanity-clamp: realistic xFIP range for MLB pitchers is ~1.5–8.5.
      // Values outside this are tiny-sample noise (1-IP relievers etc).
      if (!isNaN(xfip) && xfip >= 1.5 && xfip <= 8.5) {
        map.set(normalizeName(row.PlayerName), xfip);
      }
    }

    return map;
  } catch (err) {
    console.error("[fangraphs] fetchFanGraphsXFIPMap error:", err);
    return new Map();
  }
}

/**
 * Look up a pitcher's xFIP by name from the FanGraphs leaderboard.
 *
 * Matching strategy (same as odds-api.ts matchPropToPitcher):
 *   1. Exact normalised name match
 *   2. Last name + first initial  (handles minor name differences)
 *   3. Last name only             (only when last name length > 4)
 *
 * Returns null if no match found or xFIP data unavailable.
 */
export async function getPitcherXFIP(pitcherName: string): Promise<number | null> {
  const map = await fetchFanGraphsXFIPMap();
  if (map.size === 0) return null;

  const norm = normalizeName(pitcherName);
  const parts = norm.split(" ");
  const lastName = parts[parts.length - 1] ?? "";
  const firstInitial = parts[0]?.[0] ?? "";

  // 1. Exact match
  if (map.has(norm)) return map.get(norm)!;

  // 2. Last name + first initial
  if (lastName.length > 3) {
    for (const [key, xfip] of map) {
      const kParts = key.split(" ");
      const kLast = kParts[kParts.length - 1] ?? "";
      const kFirst = kParts[0]?.[0] ?? "";
      if (kLast === lastName && kFirst === firstInitial) return xfip;
    }
  }

  // 3. Last name only (unambiguous long last names)
  if (lastName.length > 4) {
    for (const [key, xfip] of map) {
      const kLast = key.split(" ").pop() ?? "";
      if (kLast === lastName) return xfip;
    }
  }

  return null;
}

// ============================================================
// Hardcoded FanGraphs 3-year park factors for strikeouts
// Source: FanGraphs Park Factors (Strikeouts, 3-year rolling)
// Values > 1.0 = pitcher-friendly for Ks (more Ks), < 1.0 = hitter-friendly
// Last updated: 2025 season
// ============================================================

const PARK_FACTORS: Record<string, number> = {
  // AL East
  "Yankee Stadium":           0.99,
  "Fenway Park":               1.01,
  "Camden Yards":              0.98,
  "Tropicana Field":           1.03,
  "Rogers Centre":             0.97,

  // AL Central
  "Guaranteed Rate Field":     1.00,
  "Progressive Field":         0.99,
  "Comerica Park":             1.02,
  "Kauffman Stadium":          0.96,
  "Target Field":              1.01,

  // AL West
  "Minute Maid Park":          1.02,
  "Angel Stadium":             1.01,
  "Oakland Coliseum":          0.98,
  "T-Mobile Park":             1.04,
  "Globe Life Field":          1.00,

  // NL East
  "Citi Field":                1.03,
  "Citizens Bank Park":        0.99,
  "Nationals Park":            1.00,
  "Truist Park":               1.01,
  "loanDepot park":            1.02,

  // NL Central
  "Wrigley Field":             0.97,
  "American Family Field":     1.01,
  "Great American Ball Park":  0.98,
  "PNC Park":                  1.02,
  "Busch Stadium":             1.00,

  // NL West
  "Dodger Stadium":            1.01,
  "Oracle Park":               1.02,
  "Petco Park":                1.03,
  "Chase Field":               1.00,
  "Coors Field":               0.95
};

/**
 * Returns the strikeout park factor for a given venue.
 * Returns 1.0 (neutral) for unrecognized venues.
 */
export function getParkFactor(venue: string): number {
  return PARK_FACTORS[venue] ?? 1.0;
}

/**
 * Returns all park factors as an object for display.
 */
export function getAllParkFactors(): Record<string, number> {
  return { ...PARK_FACTORS };
}
