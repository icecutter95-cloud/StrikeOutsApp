// ============================================================
// Weather modifier for pitcher K projections
// ============================================================

interface Coordinates {
  lat: number;
  lon: number;
}

interface OpenWeatherResponse {
  main: { temp: number };
  wind: { speed: number };
  weather: Array<{ description: string }>;
}

// Indoor / retractable roof stadiums — always return 1.0
const INDOOR_VENUES = new Set([
  "Tropicana Field",
  "Minute Maid Park",
  "Globe Life Field",
  "American Family Field",
  "Rogers Centre",
  "Chase Field",
  "T-Mobile Park",
  "loanDepot park",
  "Oracle Park" // not indoor but retractable — leave out if you want weather effects
]);

// Hardcoded venue → approximate city coordinates
const VENUE_COORDINATES: Record<string, Coordinates> = {
  // AL East
  "Yankee Stadium":         { lat: 40.8296, lon: -73.9262 },
  "Fenway Park":            { lat: 42.3467, lon: -71.0972 },
  "Camden Yards":           { lat: 39.2838, lon: -76.6218 },
  "Tropicana Field":        { lat: 27.7682, lon: -82.6534 },
  "Rogers Centre":          { lat: 43.6414, lon: -79.3894 },

  // AL Central
  "Guaranteed Rate Field":  { lat: 41.8300, lon: -87.6338 },
  "Progressive Field":      { lat: 41.4962, lon: -81.6852 },
  "Comerica Park":          { lat: 42.3390, lon: -83.0485 },
  "Kauffman Stadium":       { lat: 39.0517, lon: -94.4803 },
  "Target Field":           { lat: 44.9817, lon: -93.2781 },

  // AL West
  "Minute Maid Park":       { lat: 29.7573, lon: -95.3555 },
  "Angel Stadium":          { lat: 33.8003, lon: -117.8827 },
  "Oakland Coliseum":       { lat: 37.7516, lon: -122.2005 },
  "T-Mobile Park":          { lat: 47.5914, lon: -122.3325 },
  "Globe Life Field":       { lat: 32.7473, lon: -97.0837 },

  // NL East
  "Citi Field":             { lat: 40.7571, lon: -73.8458 },
  "Citizens Bank Park":     { lat: 39.9061, lon: -75.1665 },
  "Nationals Park":         { lat: 38.8730, lon: -77.0074 },
  "Truist Park":            { lat: 33.8908, lon: -84.4678 },
  "loanDepot park":         { lat: 25.7781, lon: -80.2197 },

  // NL Central
  "Wrigley Field":          { lat: 41.9484, lon: -87.6553 },
  "American Family Field":  { lat: 43.0280, lon: -87.9712 },
  "Great American Ball Park": { lat: 39.0979, lon: -84.5082 },
  "PNC Park":               { lat: 40.4469, lon: -80.0057 },
  "Busch Stadium":          { lat: 38.6226, lon: -90.1928 },

  // NL West
  "Dodger Stadium":         { lat: 34.0739, lon: -118.2400 },
  "Oracle Park":            { lat: 37.7786, lon: -122.3893 },
  "Petco Park":             { lat: 32.7076, lon: -117.1570 },
  "Chase Field":            { lat: 33.4453, lon: -112.0667 },
  "Coors Field":            { lat: 39.7559, lon: -104.9942 }
};

/**
 * Returns a weather modifier (multiplier) for the given venue and game time.
 * 1.0 = no effect, 0.95 = 5% downward modifier on projected Ks.
 *
 * Indoor stadiums always return 1.0.
 * If WEATHER_API_KEY is not set, returns 1.0.
 */
export async function getWeatherModifier(
  venue: string,
  gameTime: Date
): Promise<number> {
  // Indoor stadiums unaffected
  if (INDOOR_VENUES.has(venue)) return 1.0;

  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    console.warn("[weather] WEATHER_API_KEY not set — using modifier 1.0");
    return 1.0;
  }

  const coords = VENUE_COORDINATES[venue];
  if (!coords) {
    console.warn(`[weather] No coordinates for venue: ${venue} — using modifier 1.0`);
    return 1.0;
  }

  try {
    // Use forecast endpoint if game is in the future (within 5 days),
    // otherwise use current weather as a proxy
    const url =
      `https://api.openweathermap.org/data/2.5/weather` +
      `?lat=${coords.lat}&lon=${coords.lon}&appid=${apiKey}&units=imperial`;

    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) {
      throw new Error(`OpenWeatherMap fetch failed: ${res.status}`);
    }
    const data: OpenWeatherResponse = await res.json();

    const tempF = data.main.temp;
    const windMph = data.wind.speed;

    // Temperature modifier
    let tempModifier = 1.0;
    if (tempF < 40) {
      tempModifier = 0.90;
    } else if (tempF < 50) {
      tempModifier = 0.95;
    }

    // Wind modifier (high wind suppresses Ks slightly — harder to grip)
    let windModifier = 1.0;
    if (windMph > 20) {
      windModifier = 0.97;
    }

    return tempModifier * windModifier;
  } catch (err) {
    console.error("[weather] getWeatherModifier error:", err);
    return 1.0;
  }
}

/**
 * Returns the venue coordinates for display purposes.
 */
export function getVenueCoordinates(venue: string): Coordinates | null {
  return VENUE_COORDINATES[venue] ?? null;
}

/**
 * Returns whether a venue is an indoor/covered stadium.
 */
export function isIndoorVenue(venue: string): boolean {
  return INDOOR_VENUES.has(venue);
}
