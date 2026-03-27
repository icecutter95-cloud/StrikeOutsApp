import type { GameInfo, LineupPlayer, GameResult } from "@/lib/types";

const MLB_API = "https://statsapi.mlb.com/api/v1";

// ============================================================
// Interfaces for raw API shapes
// ============================================================

interface MLBTeam {
  id: number;
  name: string;
  abbreviation?: string;
}

interface MLBVenue {
  id: number;
  name: string;
}

interface MLBProbablePitcher {
  id: number;
  fullName: string;
  pitchHand?: { code: string };
}

interface MLBGame {
  gamePk: number;
  gameDate: string;
  teams: {
    home: { team: MLBTeam; probablePitcher?: MLBProbablePitcher };
    away: { team: MLBTeam; probablePitcher?: MLBProbablePitcher };
  };
  venue: MLBVenue;
  status?: { abstractGameState?: string };
}

interface MLBScheduleDate {
  games: MLBGame[];
}

interface MLBBatter {
  id: number;
  fullName: string;
  batSide?: { code: string };
}

interface MLBBoxscoreTeam {
  battingOrder?: number[];
  players: Record<string, { person: MLBBatter; position?: { code: string }; jerseyNumber?: string; stats?: unknown }>;
}

interface MLBBoxscore {
  teams: {
    home: MLBBoxscoreTeam;
    away: MLBBoxscoreTeam;
  };
}

interface MLBGameLogSplit {
  date: string;
  stat: {
    strikeOuts: number;
    inningsPitched: string;
    numberOfPitches: number;
  };
}

interface MLBBoxscorePitcherStats {
  strikeOuts?: number;
  inningsPitched?: string;
  numberOfPitches?: number;
}

interface MLBBoxscorePlayerEntry {
  person: { id: number };
  stats?: {
    pitching?: MLBBoxscorePitcherStats;
  };
}

// ============================================================
// Helpers
// ============================================================

function ipToDecimal(ipString: string): number {
  if (!ipString) return 0;
  const parts = ipString.split(".");
  const fullInnings = parseInt(parts[0], 10) || 0;
  const outs = parseInt(parts[1] || "0", 10);
  return fullInnings + outs / 3;
}

// ============================================================
// Public API functions
// ============================================================

/**
 * Fetches today's MLB schedule with probable pitchers.
 * Returns one GameInfo per team that has a probable pitcher listed.
 */
export async function getTodaysGames(date: string): Promise<GameInfo[]> {
  const url =
    `${MLB_API}/schedule?sportId=1&date=${date}` +
    `&hydrate=probablePitcher(note),lineups,venue,team`;

  let data: { dates?: MLBScheduleDate[] };
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`MLB schedule fetch failed: ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error("[mlb-stats] getTodaysGames error:", err);
    return [];
  }

  const games: GameInfo[] = [];

  for (const dateObj of data.dates ?? []) {
    for (const game of dateObj.games ?? []) {
      const gameTime = game.gameDate;
      const venue = game.venue?.name ?? "Unknown";

      // Skip games that are already final
      if (game.status?.abstractGameState === "Final") continue;

      const sides: Array<{
        team: MLBTeam;
        opponent: MLBTeam;
        opponentSide: "home" | "away";
        pitcher?: MLBProbablePitcher;
      }> = [
        {
          team: game.teams.home.team,
          opponent: game.teams.away.team,
          opponentSide: "away",
          pitcher: game.teams.home.probablePitcher
        },
        {
          team: game.teams.away.team,
          opponent: game.teams.home.team,
          opponentSide: "home",
          pitcher: game.teams.away.probablePitcher
        }
      ];

      for (const side of sides) {
        if (!side.pitcher) continue;
        games.push({
          pitcher_id: String(side.pitcher.id),
          pitcher_name: side.pitcher.fullName,
          team: side.team.abbreviation ?? side.team.name,
          team_id: side.team.id,
          opponent: side.opponent.abbreviation ?? side.opponent.name,
          opponent_id: side.opponent.id,
          opponent_side: side.opponentSide,
          venue,
          game_time: gameTime,
          pitcher_hand: (side.pitcher.pitchHand?.code as "R" | "L") ?? null,
          game_id: game.gamePk
        });
      }
    }
  }

  return games;
}

interface MLBScheduleLineupPlayer {
  id: number;
  fullName: string;
  primaryPosition?: { code: string; abbreviation: string };
}

interface MLBScheduleWithLineups {
  dates?: Array<{
    games?: Array<{
      lineups?: {
        homePlayers?: MLBScheduleLineupPlayer[];
        awayPlayers?: MLBScheduleLineupPlayer[];
      };
    }>;
  }>;
}

/**
 * Fetches the opponent lineup for a given game using the MLB schedule
 * endpoint with lineups hydration. Array order = batting order.
 * Lineups are available once officially posted (~2–3 hrs before first pitch).
 *
 * opponentSide: which side the OPPOSING batters bat from ("home" | "away").
 */
export async function getLineup(
  gamePk: number,
  opponentSide: "home" | "away"
): Promise<LineupPlayer[]> {
  try {
    const url = `${MLB_API}/schedule?sportId=1&gamePk=${gamePk}&hydrate=lineups`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) {
      console.error(`[mlb-stats] getLineup schedule fetch failed: ${res.status}`);
      return [];
    }

    const data = await res.json() as MLBScheduleWithLineups;
    const game = data.dates?.[0]?.games?.[0];

    if (!game?.lineups) {
      console.log(`[mlb-stats] getLineup: no lineups in schedule for gamePk ${gamePk}`);
      return [];
    }

    const players =
      opponentSide === "home"
        ? game.lineups.homePlayers
        : game.lineups.awayPlayers;

    if (!players || players.length === 0) {
      console.log(`[mlb-stats] getLineup: ${opponentSide}Players array empty for gamePk ${gamePk}`);
      return [];
    }

    // Array order = batting order; batSide not provided in this endpoint
    return players.map((p, idx) => ({
      batter_id: String(p.id),
      batter_name: p.fullName,
      hand: null, // batSide not included in schedule lineup hydration
      batting_order: idx + 1,
      k_pct_vs_rhp: null,
      k_pct_vs_lhp: null
    }));
  } catch (err) {
    console.error("[mlb-stats] getLineup error:", err);
    return [];
  }
}

/**
 * Fetches recent game log for a pitcher (last 5 starts in current season).
 */
export async function getPitcherRecentStarts(
  pitcherId: number
): Promise<{ ks: number; ip: number; pitches: number; date: string }[]> {
  const url =
    `${MLB_API}/people/${pitcherId}/stats` +
    `?stats=gameLog&group=pitching&season=2026&gameType=R`;

  let data: { stats?: Array<{ splits?: MLBGameLogSplit[] }> };
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`MLB game log fetch failed: ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error("[mlb-stats] getPitcherRecentStarts error:", err);
    return [];
  }

  const splits: MLBGameLogSplit[] =
    data.stats?.[0]?.splits ?? [];

  // Filter to starts (where IP > 1) and take last 5
  const starts = splits
    .filter((s) => ipToDecimal(s.stat.inningsPitched) >= 1)
    .slice(-5);

  return starts.map((s) => ({
    ks: s.stat.strikeOuts,
    ip: ipToDecimal(s.stat.inningsPitched),
    pitches: s.stat.numberOfPitches,
    date: s.date
  }));
}

/**
 * Fetches the final game result for a pitcher (used by close-games cron).
 */
export async function getGameResult(
  gamePk: number,
  pitcherId: number
): Promise<GameResult | null> {
  const url = `${MLB_API}/game/${gamePk}/boxscore`;

  let data: MLBBoxscore;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`MLB boxscore fetch failed: ${res.status}`);
    data = await res.json() as MLBBoxscore;
  } catch (err) {
    console.error("[mlb-stats] getGameResult error:", err);
    return null;
  }

  // Search both teams' players for this pitcher
  const allTeams = [data.teams.home, data.teams.away];
  for (const team of allTeams) {
    const key = `ID${pitcherId}`;
    const entry = team.players?.[key] as MLBBoxscorePlayerEntry | undefined;
    if (entry?.stats?.pitching) {
      const p = entry.stats.pitching;
      return {
        actualKs: p.strikeOuts ?? 0,
        actualIp: ipToDecimal(p.inningsPitched ?? "0"),
        actualPitches: p.numberOfPitches ?? 0
      };
    }
  }

  return null;
}

/**
 * Returns the game status from the MLB schedule API.
 */
export async function getGameStatus(
  gamePk: number
): Promise<"scheduled" | "in_progress" | "final"> {
  const url = `${MLB_API}/game/${gamePk}/linescore`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return "scheduled";
    const data = await res.json() as { currentInning?: number; isTopInning?: boolean };
    // If there's a current inning, the game has started
    if (data.currentInning) {
      // If it's past the 9th and no active play, treat as final
      // MLB boxscore status is more reliable; use linescore as a proxy
      return "in_progress";
    }
    return "scheduled";
  } catch {
    return "scheduled";
  }
}
