import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTodaysGames, getPitcherRecentStarts } from "@/lib/data/mlb-stats";
import { getPitcherSeasonStats } from "@/lib/data/baseball-savant";
import { generateProjection } from "@/lib/projection";
import { getWeatherModifier } from "@/lib/data/weather";
import { toDateString } from "@/lib/utils";
import type { ModelConfig, PitcherStats } from "@/lib/types";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Validate cron secret
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const date = toDateString(new Date());
    const supabase = await createServiceClient();

    // Fetch model config
    const { data: configRows, error: configErr } = await supabase
      .from("model_config")
      .select("*")
      .limit(1);

    if (configErr || !configRows?.length) {
      return NextResponse.json({ error: "Failed to fetch model config" }, { status: 500 });
    }
    const config = configRows[0] as ModelConfig;

    // Fetch today's games
    const games = await getTodaysGames(date);
    if (games.length === 0) {
      return NextResponse.json({ message: "No games found", date, starters_processed: 0 });
    }

    let processed = 0;
    const errors: string[] = [];

    for (const game of games) {
      try {
        const pitcherId = parseInt(game.pitcher_id, 10);

        // Fetch and refresh pitcher stats
        const [seasonStats, recentStarts] = await Promise.all([
          getPitcherSeasonStats(pitcherId),
          getPitcherRecentStarts(pitcherId)
        ]);

        let last3KRate: number | null = null;
        let last3Ip: number | null = null;
        let avgPitches: number | null = null;
        let lastStartPitches: number | null = null;
        let lastStartIp: number | null = null;

        if (recentStarts.length > 0) {
          const last3 = recentStarts.slice(-3);
          const totalKs = last3.reduce((s, r) => s + r.ks, 0);
          const totalIp = last3.reduce((s, r) => s + r.ip, 0);
          last3KRate = totalIp > 0 ? (totalKs / (totalIp * 3)) : null;
          last3Ip = totalIp / last3.length;

          const pitchesArr = recentStarts.map((r) => r.pitches).filter((p) => p > 0);
          avgPitches = pitchesArr.length > 0
            ? pitchesArr.reduce((a, b) => a + b, 0) / pitchesArr.length
            : null;

          lastStartPitches = recentStarts[recentStarts.length - 1]?.pitches ?? null;
          lastStartIp = recentStarts[recentStarts.length - 1]?.ip ?? null;
        }

        const pitcherStats: PitcherStats = {
          pitcher_id: game.pitcher_id,
          pitcher_name: game.pitcher_name,
          team: game.team,
          hand: game.pitcher_hand,
          season_k_pct: seasonStats.season_k_pct ?? null,
          season_k9: seasonStats.season_k9 ?? null,
          csw_pct: seasonStats.csw_pct ?? null,
          swstr_pct: seasonStats.swstr_pct ?? null,
          xfip: null,
          last3_k_rate: last3KRate,
          last3_ip: last3Ip,
          avg_pitches_per_start: avgPitches,
          last_start_pitches: lastStartPitches,
          last_start_ip: lastStartIp,
          pitch_mix: null,
          updated_at: new Date().toISOString()
        };

        // Upsert to cache
        await supabase.from("pitcher_stats_cache").upsert(pitcherStats);

        // Run preliminary projection (no prop line yet)
        const weatherMod = await getWeatherModifier(game.venue, new Date(game.game_time));

        const projection = await generateProjection(
          pitcherStats,
          [],
          game.pitcher_hand ?? "R",
          game.venue,
          new Date(game.game_time),
          null,
          null,
          null,
          config,
          weatherMod
        );

        // Insert preliminary prediction record (upsert by pitcher_id + game_date)
        await supabase.from("predictions").upsert(
          {
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
            lineup_confirmation_status: "unconfirmed",
            projected_ip: projection.projected_ip,
            park_factor: projection.park_factor,
            weather_modifier: projection.weather_modifier,
            game_status: "scheduled",
            recommendation: "NO_BET" // No line yet
          },
          { onConflict: "pitcher_id,game_date" }
        );

        processed++;
      } catch (gameErr) {
        const msg = `Error processing ${game.pitcher_name}: ${gameErr}`;
        console.error("[fetch-starters]", msg);
        errors.push(msg);
      }
    }

    return NextResponse.json({
      date,
      total_games: games.length,
      starters_processed: processed,
      errors
    });
  } catch (err) {
    console.error("[fetch-starters] GET exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
