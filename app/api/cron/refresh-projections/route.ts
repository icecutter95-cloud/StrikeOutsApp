import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { toEasternDateString } from "@/lib/utils";

export const maxDuration = 60;

/**
 * Cron-triggered GET that re-runs the full projection pipeline for today.
 *
 * Runs three times daily (all schedules are UTC in vercel.json):
 *   3 PM UTC (11 AM ET) — catches day-game lineups
 *  10 PM UTC (6 PM ET)  — catches confirmed East/Central lineups before first pitch
 *   2 AM UTC (10 PM ET) — catches confirmed West Coast lineups before first pitch
 *
 * Re-running projections means every game stored in history reflects:
 *   - Real confirmed lineup data (platoon-adjusted K/9, lineup vulnerability)
 *   - Fresh prop lines / updated odds
 *   - Accurate edge% and recommendation
 *
 * This keeps the optimizer's training data clean — stale noon projections
 * with unconfirmed lineups are replaced before close-games grades them.
 */
export async function GET(req: NextRequest) {
  // Validate cron secret
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Eastern, not UTC. The 2 AM UTC run happens at 10 PM ET, by which point the
    // UTC date has already rolled over — it was refreshing tomorrow's empty slate,
    // which is why West Coast lineups never got confirmed automatically.
    const date = toEasternDateString();

    // Call the projections POST endpoint on the same deployment.
    // VERCEL_URL is set automatically on Vercel; fall back to localhost for dev.
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    // VERCEL_AUTOMATION_BYPASS_SECRET is auto-provisioned by Vercel once
    // "Protection Bypass for Automation" is turned on under Deployment
    // Protection settings. Without it, this self-call gets caught by Vercel
    // Authentication (SSO protection) itself — a platform-level 401 that
    // happens before our own CRON_SECRET check ever runs, since it intercepts
    // the request before it reaches route code at all. That's exactly what
    // silently broke every refresh-projections run from 2026-09-02 22:01 UTC
    // through 2026-09-03 15:01 UTC: three straight failures, no lineups
    // updated for a full day, discovered only because the user noticed lineups
    // hadn't confirmed for games that had already started.
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

    const res = await fetch(`${baseUrl}/api/projections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the cron secret so the projections route can trust the call
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
        ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {})
      },
      body: JSON.stringify({ date })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[refresh-projections] projections POST failed:", res.status, text);
      if (res.status === 401 && !bypassSecret) {
        console.error(
          "[refresh-projections] No VERCEL_AUTOMATION_BYPASS_SECRET set — if this " +
          "401 is Vercel's own auth wall ('Protected deployment'), enable " +
          "'Protection Bypass for Automation' under Project Settings > " +
          "Deployment Protection. It auto-provisions this env var."
        );
      }
      return NextResponse.json(
        { error: `Projections POST returned ${res.status}`, detail: text },
        { status: 502 }
      );
    }

    const result = await res.json();

    // Lineup health check.
    // Between 2026-06-30 and 2026-07-11 the lineup fetch returned nothing for 12
    // consecutive days — lineup_data was NULL on every row — and nothing surfaced
    // the failure. The slate kept generating, projections just silently fell back
    // to a neutral 1.0 lineup multiplier. Loudly flag a slate that finishes with
    // zero confirmed lineups so a repeat can't go unnoticed.
    const lineupHealth = await checkLineupHealth(date);
    if (lineupHealth.warning) {
      console.error(
        `[refresh-projections] LINEUP OUTAGE on ${date}: ` +
        `${lineupHealth.total} games, ${lineupHealth.confirmed} confirmed lineups. ` +
        `Projections are running on a neutral lineup multiplier.`
      );
    }

    return NextResponse.json({
      triggered_at: new Date().toISOString(),
      date,
      lineup_health: lineupHealth,
      ...result
    });
  } catch (err) {
    console.error("[refresh-projections] GET exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface LineupHealth {
  total: number;
  confirmed: number;
  warning: boolean;
}

/**
 * Counts confirmed lineups for a slate. `warning` is true when a non-empty slate
 * produced zero confirmed lineups — the signature of a lineup-fetch outage.
 */
async function checkLineupHealth(date: string): Promise<LineupHealth> {
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("predictions")
      .select("lineup_confirmation_status")
      .eq("game_date", date);

    if (error || !data) return { total: 0, confirmed: 0, warning: false };

    const total = data.length;
    const confirmed = data.filter(
      (r) => r.lineup_confirmation_status === "confirmed"
    ).length;

    return { total, confirmed, warning: total >= 5 && confirmed === 0 };
  } catch {
    return { total: 0, confirmed: 0, warning: false };
  }
}
