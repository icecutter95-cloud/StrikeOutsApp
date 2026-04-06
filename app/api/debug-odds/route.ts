import { NextRequest, NextResponse } from "next/server";
import { getTodaysGames } from "@/lib/data/mlb-stats";
import { getMLBPitcherKProps } from "@/lib/data/odds-api";
import { toDateString } from "@/lib/utils";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? toDateString(new Date());

  const [games, props] = await Promise.all([
    getTodaysGames(date),
    getMLBPitcherKProps(date)
  ]);

  const mlbNames = games.map((g) => g.pitcher_name);
  const oddsNames = props.map((p) => ({ name: p.pitcher_name, line: p.line, book: p.book_key }));

  // Show which MLB pitchers have no matching prop
  const unmatched = mlbNames.filter(
    (name) => !props.some((p) => {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
      return normalize(p.pitcher_name) === normalize(name) ||
        normalize(p.pitcher_name).split(" ").pop() === normalize(name).split(" ").pop();
    })
  );

  return NextResponse.json({ date, mlbNames, oddsNames, unmatched });
}
