import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getGameResult } from "@/lib/data/mlb-stats";
import { computeCLV, determineModelCorrect, determineBetResult } from "@/lib/projection";
import { toDateString } from "@/lib/utils";
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
    const today = toDateString(new Date());
    const supabase = await createServiceClient();

    // Fetch all predictions that are not yet final and from before today
    const { data: predictions, error: predErr } = await supabase
      .from("predictions")
      .select("*")
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
      dates?: Array<{ games: Array<{ gamePk: number }> }>;
    };

    const gamePks: number[] = [];
    for (const d of schedData.dates ?? []) {
      for (const g of d.games ?? []) {
        gamePks.push(g.gamePk);
      }
    }

    const pitcherIdNum = parseInt(prediction.pitcher_id, 10);
    const pitcherKey = `ID${pitcherIdNum}`;

    // Step 2: Check each game's boxscore for this pitcher in the player list
    for (const gamePk of gamePks) {
      try {
        const boxUrl = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
        const boxRes = await fetch(boxUrl, { cache: "no-store" });
        if (!boxRes.ok) continue;

        const box = await boxRes.json() as {
          teams: {
            home: { players: Record<string, unknown> };
            away: { players: Record<string, unknown> };
          };
        };

        const allPlayers = {
          ...box.teams.home.players,
          ...box.teams.away.players
        };

        if (pitcherKey in allPlayers) {
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
