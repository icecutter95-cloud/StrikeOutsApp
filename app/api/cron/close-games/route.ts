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

        // Fetch closing line (latest snapshot)
        const { data: lastSnapshot } = await supabase
          .from("line_snapshots")
          .select("line")
          .eq("prediction_id", prediction.id)
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
 * Resolves a gamePk (MLB game ID) for a prediction by querying the schedule
 * for that game_date and matching the pitcher name / team.
 *
 * This is needed because gamePk is not stored in the predictions table.
 * A more robust approach would store game_id at prediction creation time.
 */
async function resolveGamePk(prediction: Prediction): Promise<number | null> {
  try {
    const url =
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${prediction.game_date}` +
      `&hydrate=probablePitcher`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;

    const data = await res.json() as {
      dates?: Array<{
        games: Array<{
          gamePk: number;
          teams: {
            home: { team: { abbreviation?: string }; probablePitcher?: { id: number } };
            away: { team: { abbreviation?: string }; probablePitcher?: { id: number } };
          };
        }>;
      }>;
    };

    const pitcherIdNum = parseInt(prediction.pitcher_id, 10);

    for (const dateObj of data.dates ?? []) {
      for (const game of dateObj.games ?? []) {
        const homePitcher = game.teams.home.probablePitcher?.id;
        const awayPitcher = game.teams.away.probablePitcher?.id;
        if (homePitcher === pitcherIdNum || awayPitcher === pitcherIdNum) {
          return game.gamePk;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
