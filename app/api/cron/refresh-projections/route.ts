import { NextRequest, NextResponse } from "next/server";
import { toDateString } from "@/lib/utils";

export const maxDuration = 60;

/**
 * Cron-triggered GET that re-runs the full projection pipeline for today.
 *
 * Runs twice daily:
 *   10 PM UTC (6 PM ET)  — catches confirmed East/Central lineups before first pitch
 *    2 AM UTC (10 PM ET) — catches confirmed West Coast lineups before first pitch
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
    const date = toDateString(new Date());

    // Call the projections POST endpoint on the same deployment.
    // VERCEL_URL is set automatically on Vercel; fall back to localhost for dev.
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    const res = await fetch(`${baseUrl}/api/projections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the cron secret so the projections route can trust the call
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {})
      },
      body: JSON.stringify({ date })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[refresh-projections] projections POST failed:", res.status, text);
      return NextResponse.json(
        { error: `Projections POST returned ${res.status}`, detail: text },
        { status: 502 }
      );
    }

    const result = await res.json();
    return NextResponse.json({
      triggered_at: new Date().toISOString(),
      date,
      ...result
    });
  } catch (err) {
    console.error("[refresh-projections] GET exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
