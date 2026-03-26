"use client";

import { useState } from "react";
import type { Prediction } from "@/lib/types";
import { formatEdge, formatOdds, formatGameTime } from "@/lib/utils";

interface HistoryTableProps {
  predictions: Prediction[];
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

export default function HistoryTable({ predictions }: HistoryTableProps) {
  const [sort, setSort] = useState<SortState>({ field: "game_date", direction: "desc" });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleSort = (field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { ...prev, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { field, direction: "desc" }
    );
  };

  const sorted = [...predictions].sort((a, b) => {
    const aVal = a[sort.field];
    const bVal = b[sort.field];
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
      "Edge%",
      "Rec",
      "Lineup",
      "Steam",
      "Actual Ks",
      "Result",
      "Bet Result"
    ].join(",");

    const rows = sorted.map((p) =>
      [
        p.game_date,
        `"${p.pitcher_name}"`,
        p.team,
        p.opponent,
        p.projected_ks?.toFixed(1) ?? "",
        p.prop_line?.toFixed(1) ?? "",
        p.edge_pct !== null ? (p.edge_pct * 100).toFixed(1) : "",
        p.recommendation ?? "",
        p.lineup_confirmation_status ?? "",
        p.steam_flag ? "Y" : "N",
        p.actual_ks ?? "",
        p.model_correct === true ? "W" : p.model_correct === false ? "L" : "",
        p.bet_result ?? ""
      ].join(",")
    );

    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `strikeouts-history-${new Date().toISOString().split("T")[0]}.csv`;
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
            {sorted.map((p) => (
              <>
                <tr
                  key={p.id}
                  className={`cursor-pointer transition-colors hover:bg-slate-700/50 ${
                    p.model_correct === true
                      ? "bg-green-900/10"
                      : p.model_correct === false
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
                    className={`px-3 py-2.5 font-medium ${
                      p.recommendation !== "NO_BET" && p.edge_pct !== null && p.edge_pct > 0
                        ? "text-green-400"
                        : "text-slate-400"
                    }`}
                  >
                    {p.edge_pct !== null ? formatEdge(p.edge_pct) : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <RecBadge rec={p.recommendation} />
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
                      p.model_correct === true
                        ? "text-green-400"
                        : p.model_correct === false
                        ? "text-red-400"
                        : "text-slate-200"
                    }`}
                  >
                    {p.actual_ks ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <ResultBadge correct={p.model_correct} betResult={p.bet_result} />
                  </td>
                </tr>

                {/* Expanded detail row */}
                {expandedId === p.id && (
                  <tr key={`${p.id}-expanded`} className="bg-slate-800/80">
                    <td colSpan={11} className="px-4 py-3">
                      <ExpandedRow prediction={p} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecBadge({ rec }: { rec: Prediction["recommendation"] }) {
  if (!rec || rec === "NO_BET") {
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
