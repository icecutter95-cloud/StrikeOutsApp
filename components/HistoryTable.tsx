"use client";

import { useState } from "react";
import type { Prediction } from "@/lib/types";
import { formatEdge, formatOdds, formatGameTime, gateFailed } from "@/lib/utils";

interface HistoryTableProps {
  predictions: Prediction[];
  /**
   * Which model's recommendation/edge/margin/grading to display. Defaults to v2.
   *
   * Deliberately NOT lib/utils's getActiveRecommendation() etc — those always
   * prefer v2 when adjusted_recommendation is present, which is right for the
   * dashboard (no toggle there) but wrong here: every backfilled row has
   * adjusted_recommendation set, so that helper would silently ignore a "v1"
   * selection and keep showing v2 data. These local versions respect the toggle.
   */
  modelView?: "v1" | "v2";
}

function recFor(p: Prediction, isV2: boolean): Prediction["recommendation"] {
  if (isV2) return p.adjusted_recommendation ?? p.recommendation;
  return p.recommendation;
}

function edgeFor(p: Prediction, isV2: boolean): number | null {
  const raw = isV2 && p.adjusted_recommendation !== null ? p.adjusted_edge_pct : p.edge_pct;
  return raw === null || raw === undefined ? null : Number(raw);
}

/**
 * The side to measure margin toward: the live rec if there is one, otherwise
 * (under v2) whichever side v2's own pricing favored before a gate vetoed it.
 * Deliberately not v1's raw recommendation as a fallback — v1 is computed off
 * the raw projection and can point the opposite direction from what v2's
 * shrunk-probability pricing actually leans (a heavily-favored price can flip
 * the lean once the projection is shrunk toward the line).
 */
function sideFor(p: Prediction, isV2: boolean): Prediction["recommendation"] {
  const rec = recFor(p, isV2);
  if (rec && rec !== "NO_BET") return rec;
  return isV2 ? p.adjusted_candidate_side : null;
}

/** Margin measured toward whichever side is active under the selected model view. */
function marginFor(p: Prediction, isV2: boolean): number | null {
  if (p.projected_ks === null || p.prop_line === null) return null;
  const proj = Number(p.projected_ks);
  const line = Number(p.prop_line);
  const side = sideFor(p, isV2);
  if (side === "BET_UNDER") return line - proj;
  if (side === "BET_OVER") return proj - line;
  return Math.abs(proj - line);
}

/** Gate reason is a v2-only concept — v1 has no margin/form gating at all. */
function gateReasonFor(p: Prediction, isV2: boolean): string | null {
  return isV2 ? p.adjusted_gate_reason : null;
}

/**
 * Correctness derived from actual_ks vs prop_line for whichever model is
 * active. The stored model_correct column is always v1's grading, so under v2
 * it can't be reused directly — this reproduces it exactly on v1 rows and
 * extends the same logic to v2's adjusted_recommendation.
 */
function isCorrect(
  p: Prediction,
  rec: Prediction["recommendation"]
): boolean | null {
  if (!rec || rec === "NO_BET") return null;
  if (p.actual_ks === null || p.prop_line === null) return null;
  return rec === "BET_OVER"
    ? p.actual_ks > p.prop_line
    : p.actual_ks < p.prop_line;
}

type SortField =
  | "game_date"
  | "pitcher_name"
  | "projected_ks"
  | "prop_line"
  | "edge_pct"
  | "actual_ks";

interface SortState {
  field: SortField;
  direction: "asc" | "desc";
}

export default function HistoryTable({ predictions, modelView = "v2" }: HistoryTableProps) {
  const [sort, setSort] = useState<SortState>({ field: "game_date", direction: "desc" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isV2 = modelView === "v2";

  const handleSort = (field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { ...prev, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { field, direction: "desc" }
    );
  };

  const sorted = [...predictions].sort((a, b) => {
    // edge_pct sorts on whichever model is active, since v1 and v2 edges are
    // on different scales (v2 is shrunk ~1/4) and mixing them would be meaningless.
    const aVal = sort.field === "edge_pct" ? edgeFor(a, isV2) : a[sort.field];
    const bVal = sort.field === "edge_pct" ? edgeFor(b, isV2) : b[sort.field];
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sort.direction === "asc" ? cmp : -cmp;
  });

  const handleExportCSV = () => {
    const headers = [
      "Date",
      "Pitcher",
      "Team",
      "Opponent",
      "Proj Ks",
      "Line",
      "Margin",
      "Edge%",
      "Rec",
      "Lineup",
      "Steam",
      "Actual Ks",
      "Result",
      "Bet Result"
    ].join(",");

    const rows = sorted.map((p) => {
      const rec = recFor(p, isV2);
      const edge = edgeFor(p, isV2);
      const margin = marginFor(p, isV2);
      const correct = isV2 && p.adjusted_recommendation !== null
        ? isCorrect(p, rec)
        : p.model_correct;

      return [
        p.game_date,
        `"${p.pitcher_name}"`,
        p.team,
        p.opponent,
        p.projected_ks?.toFixed(1) ?? "",
        p.prop_line?.toFixed(1) ?? "",
        margin !== null ? margin.toFixed(2) : "",
        edge !== null ? (edge * 100).toFixed(1) : "",
        rec ?? "",
        p.lineup_confirmation_status ?? "",
        p.steam_flag ? "Y" : "N",
        p.actual_ks ?? "",
        correct === true ? "W" : correct === false ? "L" : "",
        p.bet_result ?? ""
      ].join(",");
    });

    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `strikeouts-history-${modelView}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (predictions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
        <p className="text-slate-400">No historical predictions found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={handleExportCSV}
          className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
        >
          ↓ Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800">
            <tr>
              {(
                [
                  { label: "Date", field: "game_date" as SortField },
                  { label: "Pitcher", field: "pitcher_name" as SortField },
                  { label: "Matchup", field: null },
                  { label: "Proj Ks", field: "projected_ks" as SortField },
                  { label: "Line", field: "prop_line" as SortField },
                  { label: "Margin", field: null },
                  { label: "Edge%", field: "edge_pct" as SortField },
                  { label: "Rec", field: null },
                  { label: "Lineup", field: null },
                  { label: "Steam", field: null },
                  { label: "Actual Ks", field: "actual_ks" as SortField },
                  { label: "Result", field: null }
                ] as { label: string; field: SortField | null }[]
              ).map(({ label, field }) => (
                <th
                  key={label}
                  className={`px-3 py-3 text-left text-xs uppercase tracking-wide text-slate-400 ${
                    field ? "cursor-pointer hover:text-slate-200" : ""
                  }`}
                  onClick={() => field && handleSort(field)}
                >
                  {label}
                  {field && sort.field === field && (
                    <span className="ml-1">
                      {sort.direction === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50 bg-slate-800/50">
            {sorted.map((p) => {
              const rec = recFor(p, isV2);
              const edge = edgeFor(p, isV2);
              const margin = marginFor(p, isV2);
              const marginSide = sideFor(p, isV2);
              const gateReason = gateReasonFor(p, isV2);
              // v2 rows predating the migration have no adjusted_recommendation
              // at all, so fall back to v1 grading rather than showing blank.
              const correct = isV2 && p.adjusted_recommendation !== null
                ? isCorrect(p, rec)
                : p.model_correct;

              return (
                <>
                  <tr
                    key={p.id}
                    className={`cursor-pointer transition-colors hover:bg-slate-700/50 ${
                      correct === true
                        ? "bg-green-900/10"
                        : correct === false
                        ? "bg-red-900/10"
                        : ""
                    }`}
                    onClick={() => setExpandedId((prev) => (prev === p.id ? null : p.id))}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-400">
                      {p.game_date}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-white">
                      {p.pitcher_name}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">
                      {p.team} vs {p.opponent}
                    </td>
                    <td className="px-3 py-2.5 text-slate-200">
                      {p.projected_ks?.toFixed(1) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-200">
                      {p.prop_line?.toFixed(1) ?? "—"}
                    </td>
                    <td
                      className={`px-3 py-2.5 ${
                        margin !== null && margin >= 1.5
                          ? "font-semibold text-violet-300"
                          : gateFailed(gateReason, "margin")
                          ? "font-medium text-rose-400"
                          : "text-slate-500"
                      }`}
                      title={
                        gateFailed(gateReason, "margin") && marginSide
                          ? `Margin gate vetoed this bet — v2's own pricing leans ${
                              marginSide === "BET_OVER" ? "over" : "under"
                            }`
                          : undefined
                      }
                    >
                      {margin !== null
                        ? `${margin >= 0 ? "" : "−"}${Math.abs(margin).toFixed(2)}${
                            !(margin >= 1.5) && marginSide
                              ? ` (${marginSide === "BET_OVER" ? "O" : "U"})`
                              : ""
                          }`
                        : "—"}
                    </td>
                    <td
                      className={`px-3 py-2.5 font-medium ${
                        rec !== "NO_BET" && edge !== null && edge > 0
                          ? "text-green-400"
                          : "text-slate-400"
                      }`}
                    >
                      {edge !== null ? formatEdge(edge) : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <RecBadge rec={rec} gateReason={gateReason} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 capitalize">
                      {p.lineup_confirmation_status ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {p.steam_flag ? (
                        <span className="text-orange-400">
                          {p.steam_direction === "up" ? "↑" : "↓"}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2.5 font-semibold ${
                        correct === true
                          ? "text-green-400"
                          : correct === false
                          ? "text-red-400"
                          : "text-slate-200"
                      }`}
                    >
                      {p.actual_ks ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <ResultBadge correct={correct} betResult={p.bet_result} />
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expandedId === p.id && (
                    <tr key={`${p.id}-expanded`} className="bg-slate-800/80">
                      <td colSpan={12} className="px-4 py-3">
                        <ExpandedRow prediction={p} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecBadge({
  rec,
  gateReason
}: {
  rec: Prediction["recommendation"];
  gateReason?: string | null;
}) {
  if (!rec || rec === "NO_BET") {
    // "edge" (never a real disagreement) and null (v1 view, or no v2 data) stay a
    // plain dash — only margin/form are informative "this WAS a bet, then vetoed" cases.
    // Both can fail at once, so this shows every gate that vetoed it, not just one.
    const failed: string[] = [];
    if (gateFailed(gateReason ?? null, "margin")) failed.push("margin");
    if (gateFailed(gateReason ?? null, "form")) failed.push("form");

    if (failed.length > 0) {
      const color = failed.length > 1
        ? "text-amber-400"
        : failed[0] === "form"
        ? "text-fuchsia-400"
        : "text-rose-400";
      return (
        <span
          className={`text-xs font-medium ${color}`}
          title={
            failed.length > 1
              ? "Both margin and form gates vetoed this bet"
              : failed[0] === "form"
              ? "Recent-form guard vetoed this bet"
              : "Margin gate vetoed this bet — raw disagreement was under 1.5 Ks"
          }
        >
          — <span className="opacity-80">{failed.join(", ")}</span>
        </span>
      );
    }
    return <span className="text-slate-500">—</span>;
  }
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-bold ${
        rec === "BET_OVER"
          ? "bg-green-900/40 text-green-400"
          : "bg-blue-900/40 text-blue-400"
      }`}
    >
      {rec === "BET_OVER" ? "Over" : "Under"}
    </span>
  );
}

function ResultBadge({
  correct,
  betResult
}: {
  correct: boolean | null;
  betResult: Prediction["bet_result"];
}) {
  if (betResult) {
    const map = {
      win: "bg-green-900/40 text-green-400",
      loss: "bg-red-900/40 text-red-400",
      push: "bg-slate-700 text-slate-300"
    };
    return (
      <span className={`rounded px-1.5 py-0.5 text-xs font-bold capitalize ${map[betResult]}`}>
        {betResult}
      </span>
    );
  }
  if (correct === true)
    return <span className="text-xs text-green-400">Model ✓</span>;
  if (correct === false)
    return <span className="text-xs text-red-400">Model ✗</span>;
  return <span className="text-slate-600">—</span>;
}

function ExpandedRow({ prediction: p }: { prediction: Prediction }) {
  return (
    <div className="grid gap-4 text-sm sm:grid-cols-3">
      <div>
        <p className="font-medium text-slate-300">{p.pitcher_name}</p>
        <p className="text-slate-500">{p.venue} · {formatGameTime(p.game_time)}</p>
        {p.model_weights && (
          <div className="mt-2 text-xs text-slate-500">
            Weights: L3={((p.model_weights as Record<string, number>).last3 * 100).toFixed(0)}%
            / Sea={((p.model_weights as Record<string, number>).season * 100).toFixed(0)}%
            / CSW={((p.model_weights as Record<string, number>).csw * 100).toFixed(0)}%
            / xFIP={((p.model_weights as Record<string, number>).xfip * 100).toFixed(0)}%
          </div>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-slate-400">
          P(Over): <span className="text-white">{p.model_prob_over !== null ? `${(p.model_prob_over * 100).toFixed(1)}%` : "—"}</span>
        </p>
        <p className="text-slate-400">
          Book Impl. Over:{" "}
          <span className="text-white">
            {p.book_implied_over !== null ? `${(p.book_implied_over * 100).toFixed(1)}%` : "—"}
          </span>
        </p>
        <p className="text-slate-400">
          Park Factor: <span className="text-white">{p.park_factor?.toFixed(3) ?? "—"}</span>
        </p>
        <p className="text-slate-400">
          Weather: <span className="text-white">{p.weather_modifier?.toFixed(3) ?? "—"}</span>
        </p>
      </div>
      <div className="space-y-1">
        {p.user_bet_placed && (
          <>
            <p className="font-medium text-slate-300">User Bet</p>
            <p className="text-slate-400">
              Side:{" "}
              <span className="capitalize text-white">{p.user_bet_side ?? "—"}</span>
            </p>
            <p className="text-slate-400">
              Units: <span className="text-white">{p.user_bet_units ?? "—"}</span>
            </p>
            <p className="text-slate-400">
              Book: <span className="text-white">{p.user_bet_book ?? "—"}</span>
            </p>
          </>
        )}
        {p.clv !== null && (
          <p className="text-slate-400">
            CLV:{" "}
            <span className={p.clv >= 0 ? "text-green-400" : "text-red-400"}>
              {p.clv >= 0 ? "+" : ""}
              {p.clv.toFixed(2)}
            </span>
          </p>
        )}
        {p.closing_line !== null && (
          <p className="text-slate-400">
            Closing Line:{" "}
            <span className="text-white">{p.closing_line?.toFixed(1)}</span>
          </p>
        )}
        {p.prop_odds_over !== null && (
          <p className="text-slate-400">
            Odds:{" "}
            <span className="text-white">
              {formatOdds(p.prop_odds_over)} / {p.prop_odds_under !== null ? formatOdds(p.prop_odds_under) : "—"}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
