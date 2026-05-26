import { createClient } from "@/lib/supabase/server";
import { toDateString, formatEdge } from "@/lib/utils";
import type { Prediction } from "@/lib/types";
import PitcherCard from "@/components/PitcherCard";
import DashboardControls from "@/components/DashboardControls";

interface PageProps {
  searchParams: { date?: string; sort?: string };
}

export const revalidate = 0; // Always fetch fresh

/** Compute the largest implied-probability shift (0–1) across either side for a prediction. */
function oddsMovementScore(p: Prediction): number {
  function ip(odds: number) {
    return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
  }
  const overShift =
    p.opening_odds_over && p.prop_odds_over
      ? Math.abs(ip(p.prop_odds_over) - ip(p.opening_odds_over))
      : 0;
  const underShift =
    p.opening_odds_under && p.prop_odds_under
      ? Math.abs(ip(p.prop_odds_under) - ip(p.opening_odds_under))
      : 0;
  return Math.max(overShift, underShift);
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const date = searchParams.date ?? toDateString(new Date());
  const sort = searchParams.sort === "time" ? "time" : searchParams.sort === "move" ? "move" : "edge";

  const supabase = await createClient();

  // "move" sort is computed client-side; fetch ordered by edge_pct as a stable base
  const { data: predictions, error } = await supabase
    .from("predictions")
    .select("*")
    .eq("game_date", date)
    .order(
      sort === "time" ? "game_time" : "edge_pct",
      { ascending: sort === "time" }
    );

  let allPredictions = (predictions ?? []) as Prediction[];

  // Sort by biggest implied-odds move if requested
  if (sort === "move") {
    allPredictions = [...allPredictions].sort(
      (a, b) => oddsMovementScore(b) - oddsMovementScore(a)
    );
  }

  // Summary stats
  const totalGames = allPredictions.length;
  const betsRecommended = allPredictions.filter(
    (p) => p.recommendation !== "NO_BET" && p.recommendation !== null
  ).length;
  const topEdge =
    allPredictions.length > 0 && allPredictions[0].edge_pct !== null
      ? allPredictions[0].edge_pct
      : null;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-slate-400">
            MLB Pitcher Strikeout Props — {formatDate(date)}
          </p>
        </div>
        <DashboardControls date={date} sort={sort as "edge" | "time" | "move"} />
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Slate Games" value={String(totalGames)} />
        <StatCard
          label="Bets Recommended"
          value={String(betsRecommended)}
          highlight={betsRecommended > 0}
        />
        <StatCard
          label="Top Edge"
          value={topEdge !== null ? formatEdge(topEdge) : "—"}
          highlight={topEdge !== null && topEdge > 0.04}
        />
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-red-300">
          <p className="font-medium">Error loading predictions</p>
          <p className="text-sm">{error.message}</p>
        </div>
      )}

      {/* Empty state */}
      {!error && allPredictions.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-700 bg-slate-800/50 py-16 text-center">
          <p className="text-4xl">⚾</p>
          <p className="mt-3 text-lg font-medium text-slate-300">No projections yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Click &ldquo;Refresh Projections&rdquo; to generate today&apos;s analysis
          </p>
        </div>
      )}

      {/* Pitcher grid */}
      {allPredictions.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allPredictions.map((prediction) => (
            <PitcherCard key={prediction.id} prediction={prediction} date={date} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight = false
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${
          highlight ? "text-green-400" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}
