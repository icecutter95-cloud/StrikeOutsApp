import type { OddsProp } from "@/lib/types";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// Single book source — DraftKings only for consistency
const BOOK_PRIORITY = ["draftkings"];

// ============================================================
// Raw API response types
// ============================================================

interface OddsAPIEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

interface OddsAPIOutcome {
  name: string;
  description?: string;
  price: number;
  point?: number;
}

interface OddsAPIMarket {
  key: string;
  last_update: string;
  outcomes: OddsAPIOutcome[];
}

interface OddsAPIBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsAPIMarket[];
}

interface OddsAPIEventOdds {
  id: string;
  bookmakers: OddsAPIBookmaker[];
}

// ============================================================
// Pitcher K props
// ============================================================

/**
 * Fetch pitcher strikeout props from The Odds API for all MLB games today.
 *
 * Flow:
 *  1. Get list of events for baseball_mlb
 *  2. For each event, fetch pitcher_strikeouts market
 *  3. Aggregate best available line per pitcher
 */
export async function getMLBPitcherKProps(
  date: string
): Promise<OddsProp[]> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.warn("[odds-api] ODDS_API_KEY not set — skipping odds fetch");
    return [];
  }

  // Step 1: Get events for today
  // commenceTimeTo uses next-day 08:00 UTC to capture late west-coast games
  // (10pm PT = 05:00 UTC next day)
  const nextDay = new Date(date + "T12:00:00Z");
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayStr = nextDay.toISOString().split("T")[0];

  let events: OddsAPIEvent[] = [];
  try {
    const eventsUrl =
      `${ODDS_API_BASE}/sports/baseball_mlb/events` +
      `?apiKey=${apiKey}&dateFormat=iso&commenceTimeFrom=${date}T00:00:00Z&commenceTimeTo=${nextDayStr}T08:00:00Z`;

    const res = await fetch(eventsUrl, { next: { revalidate: 300 } });
    if (!res.ok) {
      throw new Error(`Odds API events fetch failed: ${res.status}`);
    }
    events = await res.json() as OddsAPIEvent[];
  } catch (err) {
    console.error("[odds-api] getMLBPitcherKProps events fetch error:", err);
    return [];
  }

  if (events.length === 0) return [];

  // Step 2: Fetch props for each event concurrently (batched to avoid rate limit)
  const results: OddsProp[] = [];

  // Process in batches of 5 to respect rate limits
  for (let i = 0; i < events.length; i += 5) {
    const batch = events.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map((event) => fetchEventKProps(event.id, apiKey))
    );
    for (const props of batchResults) {
      results.push(...props);
    }
  }

  return results;
}

async function fetchEventKProps(
  eventId: string,
  apiKey: string
): Promise<OddsProp[]> {
  try {
    // Try both common market key names the Odds API uses for pitcher K props
    const url =
      `${ODDS_API_BASE}/sports/baseball_mlb/events/${eventId}/odds` +
      `?apiKey=${apiKey}&regions=us&markets=pitcher_strikeouts,batter_strikeouts&oddsFormat=american`;

    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) {
      // 404 means this market isn't available for this event — normal
      if (res.status === 404) return [];
      throw new Error(`Odds API event odds fetch failed: ${res.status}`);
    }
    const data: OddsAPIEventOdds = await res.json();
    return parseKProps(data, eventId);
  } catch (err) {
    console.error(`[odds-api] fetchEventKProps error for event ${eventId}:`, err);
    return [];
  }
}

function parseKProps(data: OddsAPIEventOdds, eventId: string): OddsProp[] {
  const pitcherMap = new Map<
    string,
    { line: number; odds_over: number; odds_under: number; book_key: string }
  >();

  for (const book of data.bookmakers ?? []) {
    const market = book.markets?.find(
      (m) => m.key === "pitcher_strikeouts" || m.key === "batter_strikeouts"
    );
    if (!market) continue;

    // Group outcomes by pitcher name + line
    const pitcherOutcomes = new Map<
      string,
      { over?: OddsAPIOutcome; under?: OddsAPIOutcome; point: number }
    >();

    for (const outcome of market.outcomes) {
      const pitcherName = outcome.description ?? outcome.name;
      if (!pitcherName) continue;
      const isOver = outcome.name === "Over";
      const isUnder = outcome.name === "Under";
      if (!isOver && !isUnder) continue;

      const existing = pitcherOutcomes.get(pitcherName) ?? {
        point: outcome.point ?? 0
      };
      if (isOver) existing.over = outcome;
      else existing.under = outcome;
      existing.point = outcome.point ?? existing.point;
      pitcherOutcomes.set(pitcherName, existing);
    }

    // For each pitcher, check if this book is preferred over what we have
    for (const [pitcherName, outcomes] of pitcherOutcomes) {
      if (!outcomes.over || !outcomes.under) continue;

      const currentBest = pitcherMap.get(pitcherName);
      const currentPriority = currentBest
        ? BOOK_PRIORITY.indexOf(currentBest.book_key)
        : Infinity;
      const thisPriority = BOOK_PRIORITY.indexOf(book.key);

      // Prefer books in priority order; if neither is in list, accept first found
      if (currentBest === undefined || thisPriority < currentPriority || currentPriority === -1) {
        pitcherMap.set(pitcherName, {
          line: outcomes.point,
          odds_over: outcomes.over.price,
          odds_under: outcomes.under.price,
          book_key: book.key
        });
      }
    }
  }

  const props: OddsProp[] = [];
  for (const [pitcherName, odds] of pitcherMap) {
    props.push({
      pitcher_id: "", // Will be matched by name against game info
      pitcher_name: pitcherName,
      line: odds.line,
      odds_over: odds.odds_over,
      odds_under: odds.odds_under,
      book_key: odds.book_key,
      event_id: eventId
    });
  }

  return props;
}

/**
 * Matches an OddsProp pitcher to a known pitcher name from game info.
 * Simple fuzzy match: normalize to lowercase, compare last name.
 */
export function matchPropToPitcher(
  props: OddsProp[],
  pitcherName: string,
  pitcherId: string
): OddsProp | null {
  const normalizedTarget = normalizeName(pitcherName);

  // Exact match first
  for (const prop of props) {
    if (normalizeName(prop.pitcher_name) === normalizedTarget) {
      return { ...prop, pitcher_id: pitcherId };
    }
  }

  // Last name match fallback
  const targetLastName = normalizedTarget.split(" ").pop() ?? "";
  for (const prop of props) {
    const propLastName = normalizeName(prop.pitcher_name).split(" ").pop() ?? "";
    if (propLastName === targetLastName && targetLastName.length > 3) {
      return { ...prop, pitcher_id: pitcherId };
    }
  }

  return null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z ]/g, "").trim();
}
