import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getMLBPitcherKProps, matchPropToPitcher } from "@/lib/data/odds-api";
import { toDateString } from "@/lib/utils";
import type { Prediction } from "@/lib/types";

export const maxDuration = 60;

// Steam detection threshold: 0.5 line movement since opening
const STEAM_THRESHOLD = 0.5;

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

    // Fetch all open predictions for today
    const { data: predictions, error: predErr } = await supabase
      .from("predictions")
      .select("*")
      .eq("game_date", date)
      .neq("game_status", "final");

    if (predErr) {
      return NextResponse.json({ error: predErr.message }, { status: 500 });
    }
    if (!predictions || predictions.length === 0) {
      return NextResponse.json({ message: "No open predictions for today", date });
    }

    // Fetch current odds
    const allProps = await getMLBPitcherKProps(date);
    if (allProps.length === 0) {
      return NextResponse.json({ message: "No props available from odds API", date });
    }

    const snapshotsInserted: number[] = [];
    const steamUpdates: string[] = [];

    for (const prediction of predictions as Prediction[]) {
      const matchedProp = matchPropToPitcher(
        allProps,
        prediction.pitcher_name,
        prediction.pitcher_id
      );
      if (!matchedProp) continue;

      const now = new Date().toISOString();

      // Insert line snapshot
      const { error: snapErr } = await supabase.from("line_snapshots").insert({
        prediction_id: prediction.id,
        pitcher_id: prediction.pitcher_id,
        game_date: date,
        line: matchedProp.line,
        odds_over: matchedProp.odds_over,
        odds_under: matchedProp.odds_under,
        book_key: matchedProp.book_key,
        created_at: now
      });

      if (snapErr) {
        console.error(`[fetch-odds] Snapshot insert error for ${prediction.pitcher_name}:`, snapErr);
        continue;
      }
      snapshotsInserted.push(matchedProp.line);

      // Update the current prop line on the prediction
      const updates: Partial<Prediction> = {
        prop_line: matchedProp.line,
        prop_odds_over: matchedProp.odds_over,
        prop_odds_under: matchedProp.odds_under
      };

      // Set opening line on first snapshot
      if (!prediction.opening_line) {
        updates.opening_line = matchedProp.line;
      }

      // Steam detection: compare current line to opening line
      const openingLine = prediction.opening_line ?? matchedProp.line;
      const movement = Math.abs(matchedProp.line - openingLine);

      if (movement >= STEAM_THRESHOLD) {
        updates.steam_flag = true;
        updates.steam_direction = matchedProp.line > openingLine ? "up" : "down";
        steamUpdates.push(prediction.pitcher_name);
      }

      await supabase
        .from("predictions")
        .update(updates)
        .eq("id", prediction.id);
    }

    return NextResponse.json({
      date,
      predictions_checked: predictions.length,
      snapshots_inserted: snapshotsInserted.length,
      steam_detected: steamUpdates
    });
  } catch (err) {
    console.error("[fetch-odds] GET exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
