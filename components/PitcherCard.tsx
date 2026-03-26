import Link from "next/link";
import type { Prediction } from "@/lib/types";
import {
  formatOdds,
  formatEdge,
  formatGameTime,
  getRecommendationColor
} from "@/lib/utils";

interface PitcherCardProps {
  prediction: Prediction;
  date: string;
}

export default function PitcherCard({ prediction, date }: PitcherCardProps) {
  const recColor = getRecommendationColor(prediction.recommendation ?? "NO_BET");
  const isBet = prediction.recommendation && prediction.recommendation !== "NO_BET";

  return (
    <Link
      href={`/pitcher/${prediction.pitcher_id}?date=${date}`}
      className={`block rounded-xl border transition-all hover:border-slate-500 hover:-translate-y-0.5 hover:shadow-lg ${
        isBet
          ? "border-brand/60 bg-slate-800/90 shadow-brand/10 shadow-md"
          : "border-slate-700 bg-slate-800"
      }`}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-white leading-tight">{prediction.pitcher_name}</h3>
            <p className="text-xs text-slate-400">
              {prediction.team} vs {prediction.opponent}
            </p>
          </div>
          <RecommendationBadge rec={prediction.recommendation} />
        </div>

        {/* Game time + venue */}
        <p className="mt-1 text-xs text-slate-500">
          {formatGameTime(prediction.game_time)} · {prediction.venue.split(" ").slice(0, 2).join(" ")}
        </p>

        {/* Projected Ks — big number */}
        <div className="mt-4 flex items-end gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Projected Ks</p>
            <p className="text-4xl font-black text-white leading-none">
              {prediction.projected_ks?.toFixed(1) ?? "—"}
            </p>
            {prediction.confidence_low !== null && prediction.confidence_high !== null && (
              <p className="text-xs text-slate-500">
                {prediction.confidence_low.toFixed(1)}–{prediction.confidence_high.toFixed(1)}
              </p>
            )}
          </div>

          {prediction.prop_line !== null && (
            <div className="ml-auto text-right">
              <p className="text-xs text-slate-500">Line</p>
              <p className="text-xl font-bold text-slate-200">
                {prediction.prop_line.toFixed(1)}
              </p>
              {prediction.prop_odds_over !== null && prediction.prop_odds_under !== null && (
                <p className="text-xs text-slate-500">
                  {formatOdds(prediction.prop_odds_over)} /{" "}
                  {formatOdds(prediction.prop_odds_under)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Edge + units */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400">Edge:</span>
            <span className={`text-sm font-semibold ${recColor}`}>
              {prediction.edge_pct !== null ? formatEdge(prediction.edge_pct) : "—"}
            </span>
          </div>
          {isBet && prediction.recommended_units !== null && (
            <UnitBadge units={prediction.recommended_units} />
          )}
        </div>

        {/* Status flags */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <LineupBadge status={prediction.lineup_confirmation_status} />
          {prediction.steam_flag && (
            <span className="rounded-full bg-orange-900/40 px-2 py-0.5 text-xs font-medium text-orange-400">
              Steam {prediction.steam_direction === "up" ? "↑" : "↓"}
            </span>
          )}
          {prediction.game_status === "final" && (
            <FinalBadge prediction={prediction} />
          )}
        </div>
      </div>
    </Link>
  );
}

function RecommendationBadge({ rec }: { rec: Prediction["recommendation"] }) {
  if (!rec || rec === "NO_BET") {
    return (
      <span className="shrink-0 rounded-full bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-400">
        No Bet
      </span>
    );
  }
  const isOver = rec === "BET_OVER";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
        isOver
          ? "bg-green-900/50 text-green-400"
          : "bg-blue-900/50 text-blue-400"
      }`}
    >
      {isOver ? "BET OVER" : "BET UNDER"}
    </span>
  );
}

function LineupBadge({
  status
}: {
  status: Prediction["lineup_confirmation_status"];
}) {
  if (!status) return null;
  const map = {
    confirmed: { label: "Lineup ✓", cls: "bg-green-900/40 text-green-500" },
    partial: { label: "Partial ⚠️", cls: "bg-yellow-900/40 text-yellow-400" },
    unconfirmed: { label: "Unconfirmed ❓", cls: "bg-slate-700 text-slate-400" }
  };
  const config = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.cls}`}>
      {config.label}
    </span>
  );
}

function UnitBadge({ units }: { units: number }) {
  const flameMap: Record<string, string> = {
    "2": "🔥🔥 2u",
    "1.5": "🔥 1.5u",
    "1": "1u"
  };
  const label = flameMap[String(units)] ?? `${units}u`;
  return (
    <span className="rounded-full bg-brand/20 px-2 py-0.5 text-xs font-bold text-brand">
      {label}
    </span>
  );
}

function FinalBadge({ prediction }: { prediction: Prediction }) {
  if (prediction.model_correct === null) {
    return (
      <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-400">
        Final: {prediction.actual_ks ?? "—"} Ks
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        prediction.model_correct
          ? "bg-green-900/40 text-green-400"
          : "bg-red-900/40 text-red-400"
      }`}
    >
      {prediction.actual_ks} Ks {prediction.model_correct ? "✓" : "✗"}
    </span>
  );
}
