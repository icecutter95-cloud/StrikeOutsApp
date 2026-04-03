import { createClient } from "@/lib/supabase/server";
import type { Prediction } from "@/lib/types";
import HistoryTable from "@/components/HistoryTable";
import StatsTable from "@/components/StatsTable";

export const revalidate = 0;

interface PageProps {
  searchParams: {
    page?: string;
    date_from?: string;
    date_to?: string;
    edge_tier?: string;   // min value as string e.g. "0.04"
    lineup_status?: string;
    bet_placed?: string;
  };
}

const PAGE_SIZE = 25;

export default async function HistoryPage({ searchParams }: PageProps) {
  const page = parseInt(searchParams.page ?? "1", 10);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();

  // Edge tier definitions — declared early so query filtering can reference them
  const edgeTiers = [
    { label: "4–6.9%",   min: 0.04, max: 0.07 },
    { label: "7–9.9%",   min: 0.07, max: 0.10 },
    { label: "10–14.9%", min: 0.10, max: 0.15 },
    { label: "15–19.9%", min: 0.15, max: 0.20 },
    { label: "20–29.9%", min: 0.20, max: 0.30 },
    { label: "30%+",     min: 0.30, max: 1.0  },
  ];

  const activeTierMin = searchParams.edge_tier
    ? parseFloat(searchParams.edge_tier)
    : null;

  // Build query
  let query = supabase
    .from("predictions")
    .select("*", { count: "exact" })
    .eq("game_status", "final")
    .order("game_date", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (searchParams.date_from) {
    query = query.gte("game_date", searchParams.date_from);
  }
  if (searchParams.date_to) {
    query = query.lte("game_date", searchParams.date_to);
  }
  if (activeTierMin !== null) {
    const activeTier = edgeTiers.find((t) => t.min === activeTierMin);
    if (activeTier) {
      query = query.gte("edge_pct", activeTier.min).lt("edge_pct", activeTier.max);
    }
  }
  if (searchParams.lineup_status) {
    query = query.eq("lineup_confirmation_status", searchParams.lineup_status);
  }
  if (searchParams.bet_placed === "true") {
    query = query.eq("user_bet_placed", true);
  }

  const { data, count, error } = await query;
  const predictions = (data ?? []) as Prediction[];
  const totalCount = count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Compute overall stats for the history
  const { data: allFinal } = await supabase
    .from("predictions")
    .select("edge_pct,recommendation,model_correct,bet_result,user_bet_units")
    .eq("game_status", "final");

  const allPredictions = (allFinal ?? []) as Partial<Prediction>[];

  // Stats by edge tier
  const tierStats = edgeTiers.map((tier) => {
    const tiered = allPredictions.filter(
      (p) =>
        p.edge_pct !== null &&
        p.edge_pct !== undefined &&
        p.edge_pct >= tier.min &&
        p.edge_pct < tier.max &&
        p.recommendation !== "NO_BET"
    );

    const withResult = tiered.filter((p) => p.model_correct !== null);
    const correct = withResult.filter((p) => p.model_correct).length;
    const wins = tiered.filter((p) => p.model_correct === true).length;
    const losses = tiered.filter((p) => p.model_correct === false).length;
    const units = tiered
      .filter((p) => p.bet_result)
      .reduce((sum, p) => {
        if (p.bet_result === "win") return sum + (p.user_bet_units ?? 1);
        if (p.bet_result === "loss") return sum - (p.user_bet_units ?? 1);
        return sum;
      }, 0);
    return {
      tier: tier.label,
      min: tier.min,
      max: tier.max,
      bets: tiered.length,
      accuracy:
        withResult.length > 0 ? (correct / withResult.length) * 100 : null,
      wins,
      losses,
      roi: units
    };
  });

  // Overall model accuracy
  const withResult = allPredictions.filter(
    (p) => p.model_correct !== null && p.recommendation !== "NO_BET"
  );
  const overallAccuracy =
    withResult.length > 0
      ? (withResult.filter((p) => p.model_correct).length / withResult.length) * 100
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">History</h1>
        <p className="text-sm text-slate-400">
          All finalized predictions · {totalCount} total records
        </p>
      </div>

      {/* Overall accuracy */}
      {overallAccuracy !== null && (
        <div className="flex items-center gap-6 rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Overall Accuracy</p>
            <p className="text-2xl font-bold text-white">
              {overallAccuracy.toFixed(1)}%
            </p>
            <p className="text-xs text-slate-500">{withResult.length} decided bets</p>
          </div>
        </div>
      )}

      {/* Stats by edge tier */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Performance by Edge Tier</h2>
        <StatsTable tierStats={tierStats} activeTierMin={activeTierMin} />
      </section>

      {/* Filters */}
      <HistoryFilters searchParams={searchParams} />

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-red-300">
          {error.message}
        </div>
      )}

      {/* Table */}
      <HistoryTable predictions={predictions} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Page {page} of {totalPages} ({totalCount} records)
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={buildPageUrl(searchParams, page - 1)}
                className="rounded-lg border border-slate-600 px-3 py-1.5 hover:bg-slate-700"
              >
                ← Prev
              </a>
            )}
            {page < totalPages && (
              <a
                href={buildPageUrl(searchParams, page + 1)}
                className="rounded-lg border border-slate-600 px-3 py-1.5 hover:bg-slate-700"
              >
                Next →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function buildPageUrl(
  params: Record<string, string | undefined>,
  newPage: number
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && k !== "page") p.set(k, v);
  }
  p.set("page", String(newPage));
  return `/history?${p.toString()}`;
}

function HistoryFilters({
  searchParams
}: {
  searchParams: Record<string, string | undefined>;
}) {
  return (
    <form method="GET" action="/history" className="flex flex-wrap gap-3">
      <input
        type="date"
        name="date_from"
        defaultValue={searchParams.date_from ?? ""}
        className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white"
        placeholder="From"
      />
      <input
        type="date"
        name="date_to"
        defaultValue={searchParams.date_to ?? ""}
        className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white"
        placeholder="To"
      />
      <select
        name="lineup_status"
        defaultValue={searchParams.lineup_status ?? ""}
        className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white"
      >
        <option value="">All Lineup Statuses</option>
        <option value="confirmed">Confirmed</option>
        <option value="partial">Partial</option>
        <option value="unconfirmed">Unconfirmed</option>
      </select>
      <select
        name="bet_placed"
        defaultValue={searchParams.bet_placed ?? ""}
        className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white"
      >
        <option value="">All</option>
        <option value="true">Bet Placed</option>
      </select>
      <button
        type="submit"
        className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
      >
        Filter
      </button>
    </form>
  );
}
