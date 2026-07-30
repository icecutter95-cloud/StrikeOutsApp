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
    k_line?: string;      // prop line e.g. "4.5"
    recommendation?: string; // "ANY_BET" | "BET_OVER" | "BET_UNDER"
    model?: string;       // "v1" | "v2" — which model's recommendations to score
  };
}

const PAGE_SIZE = 25;

export default async function HistoryPage({ searchParams }: PageProps) {
  const page = parseInt(searchParams.page ?? "1", 10);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();

  // Which model's output is being scored. v2 (shrunk projection + margin/form
  // gating) is the live model and the default; v1 stays queryable so the original
  // series remains interpretable rather than being silently averaged in.
  const modelView = searchParams.model === "v1" ? "v1" : "v2";
  const isV2 = modelView === "v2";
  const recField  = isV2 ? "adjusted_recommendation" : "recommendation";
  const edgeField = isV2 ? "adjusted_edge_pct" : "edge_pct";

  // v2 edges are ~1/4 the v1 scale (the projection is shrunk 75% toward the
  // line), so the tier boundaries have to be re-based or every bet lands in
  // the bottom bucket.
  const edgeTiers = isV2
    ? [
        { label: "<2%",     min: -1.0, max: 0.02 },
        { label: "2–3.9%",  min: 0.02, max: 0.04 },
        { label: "4–5.9%",  min: 0.04, max: 0.06 },
        { label: "6–7.9%",  min: 0.06, max: 0.08 },
        { label: "8%+",     min: 0.08, max: 1.0  },
      ]
    : [
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
      query = query.gte(edgeField, activeTier.min).lt(edgeField, activeTier.max);
    }
  }
  if (searchParams.lineup_status) {
    query = query.eq("lineup_confirmation_status", searchParams.lineup_status);
  }
  if (searchParams.bet_placed === "true") {
    query = query.eq("user_bet_placed", true);
  }
  if (searchParams.k_line) {
    query = query.eq("prop_line", parseFloat(searchParams.k_line));
  }
  if (searchParams.recommendation === "ANY_BET") {
    // Postgres NEQ excludes NULLs from matching (three-valued logic), so this
    // naturally also drops rows with no recommendation at all — exactly what
    // "recommended bets only" should mean.
    query = query.neq(recField, "NO_BET");
  } else if (searchParams.recommendation) {
    query = query.eq(recField, searchParams.recommendation);
  }

  const { data, count, error } = await query;
  const predictions = (data ?? []) as Prediction[];
  const totalCount = count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Compute overall stats — same filters as the table (minus edge_tier and pagination).
  // Paginate in batches of 1000 to bypass PostgREST's server-side max-rows cap,
  // which silently truncates both .limit() and single .range() calls.
  const STATS_BATCH = 1000;

  function buildStatsQuery(from: number) {
    let q = supabase
      .from("predictions")
      .select(
        "edge_pct,recommendation,adjusted_edge_pct,adjusted_recommendation," +
        "model_correct,bet_result,user_bet_units,projected_ks,adjusted_ks," +
        "actual_ks,prop_line,game_date"
      )
      .eq("game_status", "final")
      .range(from, from + STATS_BATCH - 1);

    if (searchParams.date_from)     q = q.gte("game_date", searchParams.date_from);
    if (searchParams.date_to)       q = q.lte("game_date", searchParams.date_to);
    if (searchParams.lineup_status) q = q.eq("lineup_confirmation_status", searchParams.lineup_status);
    if (searchParams.bet_placed === "true") q = q.eq("user_bet_placed", true);
    if (searchParams.k_line)        q = q.eq("prop_line", parseFloat(searchParams.k_line));
    if (searchParams.recommendation === "ANY_BET") {
      q = q.neq(recField, "NO_BET");
    } else if (searchParams.recommendation) {
      q = q.eq(recField, searchParams.recommendation);
    }

    return q;
  }

  const allPredictions: Partial<Prediction>[] = [];
  let batchOffset = 0;
  while (true) {
    const { data: batch, error: batchError } = await buildStatsQuery(batchOffset);
    if (batchError || !batch || batch.length === 0) break;
    allPredictions.push(...(batch as Partial<Prediction>[]));
    if (batch.length < STATS_BATCH) break;
    batchOffset += STATS_BATCH;
  }

  // Build a human-readable label for any active filters so it's clear what the stats are scoped to
  const activeFilterLabels: string[] = [];
  if (searchParams.k_line)        activeFilterLabels.push(`${searchParams.k_line} K line`);
  if (searchParams.recommendation) {
    activeFilterLabels.push(
      searchParams.recommendation === "BET_OVER" ? "Overs only"
      : searchParams.recommendation === "BET_UNDER" ? "Unders only"
      : `Recommended bets only (${modelView})`
    );
  }
  if (searchParams.date_from || searchParams.date_to) {
    activeFilterLabels.push(`${searchParams.date_from ?? "start"} → ${searchParams.date_to ?? "today"}`);
  }
  if (searchParams.lineup_status) activeFilterLabels.push(`${searchParams.lineup_status} lineups`);
  if (searchParams.bet_placed === "true") activeFilterLabels.push("bet placed");
  const filterLabel = activeFilterLabels.length > 0 ? activeFilterLabels.join(" · ") : null;

  // ----------------------------------------------------------
  // Model-version accessors
  // ----------------------------------------------------------
  // Scoring v2 can't reuse the stored model_correct column — that's tied to the
  // v1 recommendation. Deriving the result from actual_ks vs prop_line works for
  // both, and reproduces model_correct exactly on v1 rows.
  function recOf(p: Partial<Prediction>) {
    return isV2 ? p.adjusted_recommendation : p.recommendation;
  }
  function edgeOf(p: Partial<Prediction>): number | null {
    const e = isV2 ? p.adjusted_edge_pct : p.edge_pct;
    return e === null || e === undefined ? null : Number(e);
  }
  function correctOf(p: Partial<Prediction>): boolean | null {
    const rec = recOf(p);
    if (!rec || rec === "NO_BET") return null;
    if (p.actual_ks === null || p.actual_ks === undefined) return null;
    if (p.prop_line === null || p.prop_line === undefined) return null;
    return rec === "BET_OVER"
      ? Number(p.actual_ks) > Number(p.prop_line)
      : Number(p.actual_ks) < Number(p.prop_line);
  }

  // Helper: compute W-L record for a slice of predictions
  function sliceRecord(preds: Partial<Prediction>[], n: number) {
    // preds already sorted date-desc from the query; take first n decided bets
    const decided = preds.filter((p) => correctOf(p) !== null).slice(0, n);
    return {
      wins: decided.filter((p) => correctOf(p) === true).length,
      losses: decided.filter((p) => correctOf(p) === false).length,
      count: decided.length
    };
  }

  // Stats by edge tier
  const tierStats = edgeTiers.map((tier) => {
    const tiered = allPredictions.filter((p) => {
      const e = edgeOf(p);
      const rec = recOf(p);
      return (
        e !== null && e >= tier.min && e < tier.max && !!rec && rec !== "NO_BET"
      );
    });

    const withResult = tiered.filter((p) => correctOf(p) !== null);
    const correct = withResult.filter((p) => correctOf(p)).length;
    const wins = tiered.filter((p) => correctOf(p) === true).length;
    const losses = tiered.filter((p) => correctOf(p) === false).length;
    const units = tiered
      .filter((p) => p.bet_result)
      .reduce((sum, p) => {
        if (p.bet_result === "win") return sum + (p.user_bet_units ?? 1);
        if (p.bet_result === "loss") return sum - (p.user_bet_units ?? 1);
        return sum;
      }, 0);

    // Sort date-desc in JS for the recency slices (avoids Supabase row-limit issues)
    const tieredByDate = [...tiered].sort((a, b) =>
      (b.game_date ?? "").localeCompare(a.game_date ?? "")
    );
    const last10 = sliceRecord(tieredByDate, 10);
    const last20 = sliceRecord(tieredByDate, 20);

    return {
      tier: tier.label,
      min: tier.min,
      max: tier.max,
      bets: tiered.length,
      accuracy:
        withResult.length > 0 ? (correct / withResult.length) * 100 : null,
      wins,
      losses,
      roi: units,
      last10,
      last20
    };
  });

  // Overall model accuracy
  const withResult = allPredictions.filter((p) => correctOf(p) !== null);
  const overallAccuracy =
    withResult.length > 0
      ? (withResult.filter((p) => correctOf(p)).length / withResult.length) * 100
      : null;

  // Projection error is measured against whichever lambda that model actually
  // prices off: raw projected_ks for v1, the shrunk adjusted_ks for v2.
  const withKs = allPredictions.filter((p) => {
    const rec = recOf(p);
    const proj = isV2 ? p.adjusted_ks : p.projected_ks;
    return (
      proj !== null && proj !== undefined &&
      p.actual_ks !== null && p.actual_ks !== undefined &&
      !!rec && rec !== "NO_BET"
    );
  });
  const mae = withKs.length > 0
    ? withKs.reduce((sum, p) => {
        const proj = Number(isV2 ? p.adjusted_ks : p.projected_ks);
        return sum + Math.abs(proj - Number(p.actual_ks));
      }, 0) / withKs.length
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">History</h1>
          <p className="text-sm text-slate-400">
            All finalized predictions · {totalCount} total records
          </p>
        </div>
        <ModelVersionToggle searchParams={searchParams} modelView={modelView} />
      </div>

      <p className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs text-slate-400">
        {isV2 ? (
          <>
            <span className="font-semibold text-violet-300">v2</span> — projection shrunk
            75% toward the prop line, then gated on margin (≥1.5 Ks) and recent form.
            Backfilled across the full season, so these are the bets v2 would have made.
          </>
        ) : (
          <>
            <span className="font-semibold text-slate-300">v1</span> — the original raw
            projection with no shrinkage or gating. Kept for comparison; still written
            in parallel on every new prediction.
          </>
        )}
      </p>

      {/* Overall accuracy */}
      {overallAccuracy !== null && (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 space-y-3">
          {filterLabel && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-amber-400 font-medium">
                Filtered: {filterLabel}
              </p>
              <a
                href="/history"
                className="text-xs text-slate-400 hover:text-white underline"
              >
                Clear filters
              </a>
            </div>
          )}
          <div className="flex items-center gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Overall Accuracy</p>
              <p className="text-2xl font-bold text-white">
                {overallAccuracy.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500">{withResult.length} decided bets</p>
            </div>
            {mae !== null && (
              <div className="border-l border-slate-700 pl-6">
                <p className="text-xs uppercase tracking-wide text-slate-400">Avg Projection Error</p>
                <p className="text-2xl font-bold text-white">{mae.toFixed(2)} Ks</p>
                <p className="text-xs text-slate-500">{withKs.length} predictions</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats by edge tier */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">
          Performance by Edge Tier
          {filterLabel && (
            <span className="ml-2 text-sm font-normal text-amber-400">({filterLabel})</span>
          )}
        </h2>
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
      <HistoryTable predictions={predictions} modelView={modelView} />

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

function ModelVersionToggle({
  searchParams,
  modelView
}: {
  searchParams: Record<string, string | undefined>;
  modelView: string;
}) {
  function urlFor(version: string) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      // Edge tiers differ per model, so a tier selected under one version is
      // meaningless under the other — drop it when switching.
      if (v && k !== "model" && k !== "page" && k !== "edge_tier") p.set(k, v);
    }
    p.set("model", version);
    return `/history?${p.toString()}`;
  }

  const options = [
    { key: "v2", label: "v2 (live)" },
    { key: "v1", label: "v1 (raw)" }
  ];

  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-600">
      {options.map((o) => (
        <a
          key={o.key}
          href={urlFor(o.key)}
          className={`px-3 py-1.5 text-sm font-medium ${
            modelView === o.key
              ? "bg-brand text-white"
              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
        >
          {o.label}
        </a>
      ))}
    </div>
  );
}

function HistoryFilters({
  searchParams
}: {
  searchParams: Record<string, string | undefined>;
}) {
  return (
    <form method="GET" action="/history" className="flex flex-wrap gap-3">
      {/* Preserve the selected model across filter submissions */}
      {searchParams.model && (
        <input type="hidden" name="model" value={searchParams.model} />
      )}
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
      <select
        name="k_line"
        defaultValue={searchParams.k_line ?? ""}
        className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white"
      >
        <option value="">All K Lines</option>
        <option value="0.5">0.5</option>
        <option value="1.5">1.5</option>
        <option value="2.5">2.5</option>
        <option value="3.5">3.5</option>
        <option value="4.5">4.5</option>
        <option value="5.5">5.5</option>
        <option value="6.5">6.5</option>
        <option value="7.5">7.5</option>
        <option value="8.5">8.5</option>
        <option value="9.5">9.5</option>
      </select>
      <select
        name="recommendation"
        defaultValue={searchParams.recommendation ?? ""}
        className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white"
      >
        <option value="">All (incl. No Bet)</option>
        <option value="ANY_BET">Recommended bets only</option>
        <option value="BET_OVER">Over only</option>
        <option value="BET_UNDER">Under only</option>
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
