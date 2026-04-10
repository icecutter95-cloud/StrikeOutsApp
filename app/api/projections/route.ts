import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTodaysGames, getLineup, getPitcherRecentStarts } from "@/lib/data/mlb-stats";
import { getPitcherSeasonStats, getBatterStrikeoutStats, getPitcherRecentVelocity, getPitcherPlatoonSplits } from "@/lib/data/baseball-savant";
import { getPitcherXFIP } from "@/lib/data/fangraphs";
import { getMLBPitcherKProps, matchPropToPitcher } from "@/lib/data/odds-api";
import { getWeatherModifier } from "@/lib/data/weather";
import { generateProjection } from "@/lib/projection";
import type { PitcherStats, ModelConfig } from "@/lib/types";
import { toDateString } from "@/lib/utils";

export const maxDuration = 60; // Vercel max for hobby; upgrade to Pro for longer

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { date?: string };
    const date = body.date ?? toDateString(new Date());

    const supabase = await createServiceClient();

    // ----------------------------------------------------------
    // 1. Fetch model config
    // ----------------------------------------------------------
    const { data: configRows, error: configErr } = await supabase
      .from("model_config")
      .select("*")
      .limit(1);

    if (configErr || !configRows || configRows.length === 0) {
      return NextResponse.json({ error: "Failed to fetch model config" }, { status: 500 });
    }
    const config = configRows[0] as ModelConfig;

    // ----------------------------------------------------------
    // 2. Fetch today's games
    // ----------------------------------------------------------
    const games = await getTodaysGames(date);
    if (games.length === 0) {
      return NextResponse.json({ message: "No games found for date", date, projections: [] });
    }

    // ----------------------------------------------------------
    // 3. Fetch all prop lines at once
    // ----------------------------------------------------------
    const allProps = await getMLBPitcherKProps(date);

    // ----------------------------------------------------------
    // 4. Process each game
    // ----------------------------------------------------------
    const projectionResults = [];

    for (const game of games) {
      try {
        const pitcherId = parseInt(game.pitcher_id, 10);

        // --- Pitcher stats: check cache first ---
        const { data: cachedStats } = await supabase
          .from("pitcher_stats_cache")
          .select("*")
          .eq("pitcher_id", game.pitcher_id)
          .single();

        let pitcherStats: PitcherStats;

        const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
        if (
          cachedStats &&
          cachedStats.updated_at > oneHourAgo
        ) {
          pitcherStats = cachedStats as PitcherStats;
        } else {
          // Fetch fresh data
          const [seasonStats, recentStarts, recentVelocity, platoonSplits, xfip] = await Promise.all([
            getPitcherSeasonStats(pitcherId),
            getPitcherRecentStarts(pitcherId),
            getPitcherRecentVelocity(pitcherId),
            getPitcherPlatoonSplits(pitcherId),
            getPitcherXFIP(game.pitcher_name)
          ]);

          // Compute last3_k_rate
          let last3KRate: number | null = null;
          let last3Ip: number | null = null;
          let avgPitches: number | null = null;
          let lastStartPitches: number | null = null;
          let lastStartIp: number | null = null;

          if (recentStarts.length > 0) {
            const last3 = recentStarts.slice(-3);
            const totalKs = last3.reduce((sum, s) => sum + s.ks, 0);
            const totalIp = last3.reduce((sum, s) => sum + s.ip, 0);
            last3KRate = totalIp > 0 ? totalKs / (totalIp * 3) : null; // K per batter (approx)
            last3Ip = totalIp / last3.length;

            const allPitches = recentStarts.map((s) => s.pitches).filter((p) => p > 0);
            avgPitches = allPitches.length > 0
              ? allPitches.reduce((a, b) => a + b, 0) / allPitches.length
              : null;

            lastStartPitches = recentStarts[recentStarts.length - 1]?.pitches ?? null;
            lastStartIp = recentStarts[recentStarts.length - 1]?.ip ?? null;
          }

          pitcherStats = {
            pitcher_id: game.pitcher_id,
            pitcher_name: game.pitcher_name,
            team: game.team,
            hand: game.pitcher_hand,
            season_k_pct: seasonStats.season_k_pct ?? null,
            season_k9: seasonStats.season_k9 ?? null,
            csw_pct: seasonStats.csw_pct ?? null,
            swstr_pct: seasonStats.swstr_pct ?? null,
            o_swing_pct: seasonStats.o_swing_pct ?? null,
            season_avg_velocity: seasonStats.season_avg_velocity ?? null,
            last3_avg_velocity: recentVelocity,
            k_pct_vs_lhh: platoonSplits.k_pct_vs_lhh,
            k_pct_vs_rhh: platoonSplits.k_pct_vs_rhh,
            xfip: xfip,
            last3_k_rate: last3KRate,
            last3_ip: last3Ip,
            avg_pitches_per_start: avgPitches,
            last_start_pitches: lastStartPitches,
            last_start_ip: lastStartIp,
            pitch_mix: null,
            updated_at: new Date().toISOString()
          };

          // Upsert to cache
          await supabase.from("pitcher_stats_cache").upsert({
            ...pitcherStats
          });
        }

        // --- Lineup (fetch opposing batters, not the pitcher's own team) ---
        const rawLineup = await getLineup(game.game_id, game.opponent_side);

        // Enrich lineup with K% data
        const enrichedLineup = await Promise.all(
          rawLineup.map(async (batter) => {
            // Check batter cache
            const { data: batterCache } = await supabase
              .from("batter_stats_cache")
              .select("*")
              .eq("batter_id", batter.batter_id)
              .single();

            if (batterCache && (batterCache.k_pct_vs_rhp !== null || batterCache.k_pct_vs_lhp !== null)) {
              return {
                ...batter,
                k_pct_vs_rhp: batterCache.k_pct_vs_rhp ?? null,
                k_pct_vs_lhp: batterCache.k_pct_vs_lhp ?? null
              };
            }

            // Fetch from Baseball Savant
            const batterStats = await getBatterStrikeoutStats(parseInt(batter.batter_id, 10));
            if (batterStats.k_pct_vs_rhp !== undefined || batterStats.k_pct_vs_lhp !== undefined) {
              await supabase.from("batter_stats_cache").upsert({
                batter_id: batter.batter_id,
                batter_name: batter.batter_name,
                hand: batter.hand,
                k_pct_vs_rhp: batterStats.k_pct_vs_rhp ?? null,
                k_pct_vs_lhp: batterStats.k_pct_vs_lhp ?? null,
                updated_at: new Date().toISOString()
              });
            }
            return {
              ...batter,
              k_pct_vs_rhp: batterStats.k_pct_vs_rhp ?? null,
              k_pct_vs_lhp: batterStats.k_pct_vs_lhp ?? null
            };
          })
        );

        // --- Prop line ---
        const matchedProp = matchPropToPitcher(allProps, game.pitcher_name, game.pitcher_id);

        // If the game has already started and the API is no longer returning a line,
        // preserve the existing odds/edge/recommendation from the DB so we don't wipe history.
        const gameHasStarted = new Date(game.game_time) < new Date();
        let existingOdds: {
          prop_line: number | null;
          prop_odds_over: number | null;
          prop_odds_under: number | null;
          opening_line: number | null;
          edge_pct: number | null;
          model_prob_over: number | null;
          model_prob_under: number | null;
          book_implied_over: number | null;
          book_implied_under: number | null;
          recommendation: string | null;
          recommended_units: number | null;
        } | null = null;

        if (gameHasStarted && !matchedProp) {
          const { data: existing } = await supabase
            .from("predictions")
            .select("prop_line,prop_odds_over,prop_odds_under,opening_line,edge_pct,model_prob_over,model_prob_under,book_implied_over,book_implied_under,recommendation,recommended_units")
            .eq("pitcher_id", game.pitcher_id)
            .eq("game_date", date)
            .single();
          existingOdds = existing ?? null;
        }

        const propLine = matchedProp?.line ?? existingOdds?.prop_line ?? null;
        const propOddsOver = matchedProp?.odds_over ?? existingOdds?.prop_odds_over ?? null;
        const propOddsUnder = matchedProp?.odds_under ?? existingOdds?.prop_odds_under ?? null;

        // --- Weather ---
        const weatherMod = await getWeatherModifier(game.venue, new Date(game.game_time));

        // --- Run projection ---
        const projection = await generateProjection(
          pitcherStats,
          enrichedLineup,
          game.pitcher_hand ?? "R",
          game.venue,
          new Date(game.game_time),
          propLine,
          propOddsOver,
          propOddsUnder,
          config,
          weatherMod
        );

        // --- Upsert prediction ---
        const predictionRecord = {
          game_date: date,
          pitcher_name: game.pitcher_name,
          pitcher_id: game.pitcher_id,
          team: game.team,
          opponent: game.opponent,
          venue: game.venue,
          game_time: game.game_time,
          pitcher_hand: game.pitcher_hand,
          projected_ks: projection.projected_ks,
          confidence_low: projection.confidence_low,
          confidence_high: projection.confidence_high,
          last3_k_rate: pitcherStats.last3_k_rate,
          season_k_pct: pitcherStats.season_k_pct,
          csw_pct: pitcherStats.csw_pct,
          xfip_k_rate: pitcherStats.xfip,
          model_weights: {
            last3: config.weight_last3,
            season: config.weight_season,
            csw: config.weight_csw,
            xfip: config.weight_xfip
          },
          lineup_confirmation_status: projection.lineup_confirmation_status,
          lineup_k_vulnerability: projection.lineup_k_vulnerability,
          lineup_data: enrichedLineup.length > 0 ? enrichedLineup : null,
          prop_line: propLine,
          prop_odds_over: propOddsOver,
          prop_odds_under: propOddsUnder,
          opening_line: existingOdds?.opening_line ?? null,
          edge_pct: existingOdds && !matchedProp ? existingOdds.edge_pct : projection.edge_pct,
          model_prob_over: existingOdds && !matchedProp ? existingOdds.model_prob_over : projection.model_prob_over,
          model_prob_under: existingOdds && !matchedProp ? existingOdds.model_prob_under : projection.model_prob_under,
          book_implied_over: existingOdds && !matchedProp ? existingOdds.book_implied_over : projection.book_implied_over,
          book_implied_under: existingOdds && !matchedProp ? existingOdds.book_implied_under : projection.book_implied_under,
          recommendation: existingOdds && !matchedProp ? existingOdds.recommendation : projection.recommendation,
          recommended_units: existingOdds && !matchedProp ? existingOdds.recommended_units : projection.recommended_units,
          projected_ip: projection.projected_ip,
          park_factor: projection.park_factor,
          weather_modifier: projection.weather_modifier,
          game_status: "scheduled"
        };

        const { data: upserted, error: upsertErr } = await supabase
          .from("predictions")
          .upsert(predictionRecord, {
            onConflict: "pitcher_id,game_date"
          })
          .select()
          .single();

        if (upsertErr) {
          console.error(`[projections] Upsert error for ${game.pitcher_name}:`, upsertErr);
        }

        projectionResults.push({
          game,
          projection,
          prediction_id: upserted?.id ?? null,
          prop: matchedProp
        });
      } catch (gameErr) {
        console.error(`[projections] Error processing ${game.pitcher_name}:`, gameErr);
      }
    }

    return NextResponse.json({
      date,
      total_games: games.length,
      projections: projectionResults
    });
  } catch (err) {
    console.error("[projections] POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
