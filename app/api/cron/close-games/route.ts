import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getGameResult } from "@/lib/data/mlb-stats";
import { computeCLV, determineModelCorrect, determineBetResult } from "@/lib/projection";
import { toEasternDateString } from "@/lib/utils";
import type { Prediction } from "@/lib/types";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Validate cron secret
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today = toEasternDateString();
    const supabase = await createServiceClient();

    // Fetch predictions that are not yet final and from before today.
    //
    // Bounded to a rolling lookback window rather than "since the season
    // began" — a handful of predictions per date never resolve (resolveGamePk
    // can't match them: scratched starters, postponements, name mismatches
    // against the MLB API) and were being re-queried and re-attempted by this
    // route every single day, forever. Each attempt makes its own MLB schedule
    // + boxscore API calls, so the backlog's cost compounds daily. By
    // 2026-08-14 that backlog had grown to 60+ stragglers going back to April,
    // and adding a normal ~18-game day on top of it pushed the run past the
    // 60s function limit — it got killed mid-run with no logged error (a bare
    // 500, no stack trace), silently leaving that whole day's games unclosed.
    // A prediction that hasn't resolved in 5 days isn't going to resolve on
    // day 6 either; stop paying for it.
    const lookbackDate = toEasternDateString(
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    );

    const { data: predictions, error: predErr } = await supabase
      .from("predictions")
      .select("*")
      .gte("game_date", lookbackDate)
      .lt("game_date", today)
      .neq("game_status", "final");

    if (predErr) {
      return NextResponse.json({ error: predErr.message }, { status: 500 });
    }

    if (!predictions || predictions.length === 0) {
      return NextResponse.json({
        message: "No open predictions to close",
        closed: 0
      });
    }

    let closedCount = 0;
    const errors: string[] = [];

    for (const prediction of predictions as Prediction[]) {
      try {
        // We need the game_id (gamePk) — it's not stored in predictions.
        // We'll attempt to fetch via game_date and pitcher_id from the MLB schedule.
        // As a workaround, we can look up the gamePk from the schedule on game_date.
        const gamePk = await resolveGamePk(prediction);
        if (!gamePk) {
          console.warn(`[close-games] Could not resolve gamePk for ${prediction.pitcher_name} on ${prediction.game_date}`);
          continue;
        }

        const result = await getGameResult(gamePk, parseInt(prediction.pitcher_id, 10));
        if (!result) {
          // Game may not be finished yet — mark in_progress
          await supabase
            .from("predictions")
            .update({ game_status: "in_progress" })
            .eq("id", prediction.id);
          continue;
        }

        // Fetch closing line = last snapshot taken BEFORE game started (pre-game close)
        const { data: lastSnapshot } = await supabase
          .from("line_snapshots")
          .select("line")
          .eq("prediction_id", prediction.id)
          .lte("created_at", prediction.game_time ?? new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        const closingLine = lastSnapshot?.line ?? null;
        const clv = computeCLV(
          prediction.user_bet_side ?? prediction.recommendation?.toLowerCase().replace("bet_", "") ?? "",
          prediction.opening_line,
          closingLine
        );

        const modelCorrect = determineModelCorrect(
          prediction.recommendation,
          prediction.prop_line,
          result.actualKs
        );

        const betResult = determineBetResult(
          prediction.user_bet_side,
          prediction.prop_line,
          result.actualKs
        );

        await supabase
          .from("predictions")
          .update({
            actual_ks: result.actualKs,
            actual_ip: result.actualIp,
            actual_pitch_count: result.actualPitches,
            closing_line: closingLine,
            model_correct: modelCorrect,
            clv,
            bet_result: betResult,
            game_status: "final"
          })
          .eq("id", prediction.id);

        closedCount++;
      } catch (predErr) {
        const msg = `Error closing ${prediction.pitcher_name} (${prediction.game_date}): ${predErr}`;
        console.error("[close-games]", msg);
        errors.push(msg);
      }
    }

    return NextResponse.json({
      today,
      predictions_found: predictions.length,
      closed: closedCount,
      errors
    });
  } catch (err) {
    console.error("[close-games] GET exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Resolves a gamePk by fetching the schedule for that date, then checking each
 * game's boxscore player list for the pitcher ID.
 *
 * Uses the boxscore (not probablePitcher) so it works even when the actual
 * starter differed from the listed probable pitcher.
 */
async function resolveGamePk(prediction: Prediction): Promise<number | null> {
  try {
    // Step 1: Get all gamePks for that date
    const schedUrl =
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${prediction.game_date}&sportId=1`;
    const schedRes = await fetch(schedUrl, { cache: "no-store" });
    if (!schedRes.ok) return null;

    const schedData = await schedRes.json() as {
      dates?: Array<{
        games: Array<{
          gamePk: number;
          status?: { abstractGameState?: string };
        }>;
      }>;
    };

    // Only consider games that the MLB API has marked as Final.
    // This prevents partially-scored West Coast games from being closed prematurely.
    const gamePks: number[] = [];
    for (const d of schedData.dates ?? []) {
      for (const g of d.games ?? []) {
        if (g.status?.abstractGameState === "Final") {
          gamePks.push(g.gamePk);
        }
      }
    }

    const pitcherIdNum = parseInt(prediction.pitcher_id, 10);
    const pitcherKey = `ID${pitcherIdNum}`;

    // Step 2: Check each game's boxscore — only match if pitcher has actual pitching stats
    for (const gamePk of gamePks) {
      try {
        const boxUrl = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
        const boxRes = await fetch(boxUrl, { cache: "no-store" });
        if (!boxRes.ok) continue;

        const box = await boxRes.json() as {
          teams: {
            home: { players: Record<string, { stats?: { pitching?: { numberOfPitches?: number; inningsPitched?: string } } }> };
            away: { players: Record<string, { stats?: { pitching?: { numberOfPitches?: number; inningsPitched?: string } } }> };
          };
        };

        const allPlayers = {
          ...box.teams.home.players,
          ...box.teams.away.players
        };

        const entry = allPlayers[pitcherKey];
        if (!entry?.stats?.pitching) continue;

        // Only count this as a match if the pitcher actually took the mound
        const pitches = entry.stats.pitching.numberOfPitches ?? 0;
        const ip = entry.stats.pitching.inningsPitched ?? "0";
        if (pitches > 0 || ip !== "0.0" && ip !== "0") {
          return gamePk;
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}
