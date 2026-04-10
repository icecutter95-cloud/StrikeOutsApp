import { NextRequest, NextResponse } from "next/server";
import { getPitcherFanGraphsStats } from "@/lib/data/fangraphs";

/**
 * Debug endpoint — verifies FanGraphs xFIP lookup is working.
 *
 * Usage: GET /api/debug-fangraphs?name=Corbin+Burnes
 *        GET /api/debug-fangraphs?name=Sonny+Gray
 *
 * Returns the matched xFIP value (or null if not found), plus a sample
 * of the raw response to confirm the API is reachable and the field names
 * are what we expect.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pitcherName = searchParams.get("name") ?? "Corbin Burnes";

  const season = new Date().getFullYear();
  // Same URL as getPitcherXFIP() — qual=10 filters out tiny-sample relievers
  const url =
    `https://www.fangraphs.com/api/leaders/major-league/data` +
    `?pos=all&stats=pit&lg=all&qual=10&pageitems=30&pagenum=1` +
    `&ind=0&season=${season}&team=0&startdt=&enddt=&month=0` +
    `&hand=&type=1&postseason=&sortdir=desc&sortstat=xFIP`;

  interface FanGraphsRow {
    PlayerName?: string;
    xFIP?: number | string | null;
    "O-Swing%"?: number | string | null;
    [key: string]: unknown;
  }

  interface FanGraphsResponse {
    data?: FanGraphsRow[];
  }

  let rawSample: unknown = null;
  let fetchStatus = 0;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StrikeOutsApp/1.0)",
        Accept: "application/json"
      },
      cache: "no-store"
    });
    fetchStatus = res.status;
    if (res.ok) {
      const json = await res.json() as FanGraphsResponse;
      const rows = json?.data ?? [];
      // Return first 5 rows and their keys so we can verify field names
      rawSample = {
        total_rows: rows.length,
        available_keys: rows[0] ? Object.keys(rows[0]) : [],
        first_5: rows.slice(0, 5).map((r) => ({
          PlayerName: r.PlayerName,
          xFIP: r.xFIP,
          "O-Swing%": r["O-Swing%"]
        }))
      };
    }
  } catch (err) {
    rawSample = { error: String(err) };
  }

  // Now do the actual lookup via the exported function
  const fgStats = await getPitcherFanGraphsStats(pitcherName);

  return NextResponse.json({
    pitcher_name: pitcherName,
    xfip_result: fgStats.xfip,
    o_swing_pct_result: fgStats.o_swing_pct,
    fangraphs_status: fetchStatus,
    raw_sample: rawSample
  });
}
