import { NextRequest, NextResponse } from "next/server";

/**
 * Debug endpoint — fetches raw Baseball Savant CSV for a pitcher
 * and returns the column headers + first row so we can verify field names.
 *
 * Usage: GET /api/debug-savant?id=477132  (any MLB pitcher ID)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pitcherId = searchParams.get("id") ?? "477132"; // Clayton Kershaw default

  const summaryUrl =
    `https://baseballsavant.mlb.com/statcast_search/csv` +
    `?hfGT=R%7C&hfSea=2026%7C&player_type=pitcher` +
    `&group_by=name&min_pitches=0&sort_col=pitches&sort_order=desc` +
    `&chk_stats_k_percent=on&chk_stats_csw_percent=on&chk_stats_swstr_percent=on` +
    `&chk_stats_o_swing_percent=on&chk_stats_avg_speed=on` +
    `&player_id=${pitcherId}&type=summary`;

  const gameLogUrl =
    `https://baseballsavant.mlb.com/statcast_search/csv` +
    `?hfGT=R%7C&hfSea=2026%7C&player_type=pitcher` +
    `&group_by=name-date&min_pitches=20&sort_col=game_date&sort_order=desc` +
    `&player_id=${pitcherId}`;

  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; StrikeOutsApp/1.0)"
  };

  async function fetchAndParse(url: string) {
    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) return { error: `HTTP ${res.status}`, url };
      const text = await res.text();
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) return { error: "No data rows", url, raw_headers: lines[0] ?? "" };
      const columnHeaders = lines[0].split(",").map((h) => h.trim());
      // Parse first data row
      const firstRowValues = lines[1].split(",");
      const firstRow: Record<string, string> = {};
      columnHeaders.forEach((h, i) => { firstRow[h] = firstRowValues[i]?.trim() ?? ""; });
      return { url, column_count: columnHeaders.length, columns: columnHeaders, first_row: firstRow, total_rows: lines.length - 1 };
    } catch (err) {
      return { error: String(err), url };
    }
  }

  const [summary, gameLog] = await Promise.all([
    fetchAndParse(summaryUrl),
    fetchAndParse(gameLogUrl)
  ]);

  return NextResponse.json({ pitcher_id: pitcherId, summary, game_log: gameLog });
}
