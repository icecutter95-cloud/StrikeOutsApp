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
