import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Prediction, LineSnapshot } from "@/lib/types";
import LineMovementChart from "@/components/LineMovementChart";
import LineupTable from "@/components/LineupTable";
import BetLogger from "@/components/BetLogger";
import {
  formatOdds,
  formatEdge,
  formatGameTime,
  getRecommendationColor
} from "@/lib/utils";

interface PageProps {
  params: { id: string };
  searchParams: { date?: string };
}

export const revalidate = 0;

export default async function PitcherDetailPage({ params, searchParams }: PageProps) {
  const supabase = await createClient();
  const date = searchParams.date ?? new Date().toISOString().split("T")[0];

  // Fetch prediction by pitcher_id + date
  const { data: predictions } = await supabase
    .from("predictions")
    .select("*")
    .eq("pitcher_id", params.id)
    .eq("game_date", date)
    .limit(1);

  if (!predictions || predictions.length === 0) {
    notFound();
  }

  const prediction = predictions[0] as Prediction;

  // Fetch line snapshots
  const { data: snapshots } = await supabase
    .from("line_snapshots")
    .select("*")
    .eq("prediction_id", prediction.id)
    .order("created_at", { ascending: true });

  const lineSnapshots = (snapshots ?? []) as LineSnapshot[];

  const recColor = getRecommendationColor(prediction.recommendation ?? "NO_BET");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-white">{prediction.pitcher_name}</h1>
          {prediction.pitcher_hand && (
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-300">
              {prediction.pitcher_hand}HP
            </span>
          )}
        </div>
        <p className="text-slate-400">
          {prediction.team} vs {prediction.opponent} ·{" "}
          {formatGameTime(prediction.game_time)} · {prediction.venue}
        </p>
      </div>

      {/* Main stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BigStatCard
          label="Projected Ks"
          value={prediction.projected_ks?.toFixed(1) ?? "—"}
          sub={
            prediction.confidence_low !== null && prediction.confidence_high !== null
              ? `Range: ${prediction.confidence_low.toFixed(1)}–${prediction.confidence_high.toFixed(1)}`
              : undefined
          }
        />
        <BigStatCard
          label="Prop Line"
          value={prediction.prop_line?.toFixed(1) ?? "—"}
          sub={
            prediction.prop_odds_over !== null && prediction.prop_odds_under !== null
              ? `O ${formatOdds(prediction.prop_odds_over)} / U ${formatOdds(prediction.prop_odds_under)}`
              : undefined
          }
        />
        <BigStatCard
          label="Edge"
          value={prediction.edge_pct !== null ? formatEdge(prediction.edge_pct) : "—"}
          valueClassName={recColor}
        />
        <BigStatCard
          label="Recommendation"
          value={
            prediction.recommendation === "BET_OVER"
              ? "BET OVER"
              : prediction.recommendation === "BET_UNDER"
              ? "BET UNDER"
              : "NO BET"
          }
          sub={
            prediction.recommended_units
              ? `${prediction.recommended_units}u recommended`
              : undefined
          }
          valueClassName={recColor}
        />
      </div>

      {/* Flags row */}
      <div className="flex flex-wrap gap-2">
        <StatusBadge
          label={`Lineup: ${prediction.lineup_confirmation_status ?? "unknown"}`}
          color={
            prediction.lineup_confirmation_status === "confirmed"
              ? "green"
              : prediction.lineup_confirmation_status === "partial"
              ? "yellow"
              : "slate"
          }
        />
        {prediction.steam_flag && (
          <StatusBadge
            label={`Steam ${prediction.steam_direction === "up" ? "↑" : "↓"}`}
            color="orange"
          />
        )}
        <StatusBadge label={`Status: ${prediction.game_status}`} color="slate" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Projection components */}
        <section className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Projection Breakdown</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-700">
              <StatRow label="Projected IP" value={prediction.projected_ip?.toFixed(1) ?? "—"} />
              <StatRow
                label="Last 3 K-Rate"
                value={
                  prediction.last3_k_rate !== null
                    ? `${(prediction.last3_k_rate * 100).toFixed(1)}%`
                    : "—"
                }
              />
              <StatRow
                label="Season K%"
                value={
                  prediction.season_k_pct !== null
                    ? `${(prediction.season_k_pct * 100).toFixed(1)}%`
                    : "—"
                }
              />
              <StatRow
                label="CSW%"
                value={
                  prediction.csw_pct !== null
                    ? `${(prediction.csw_pct * 100).toFixed(1)}%`
                    : "—"
                }
              />
              <StatRow label="Park Factor" value={prediction.park_factor?.toFixed(3) ?? "1.000"} />
              <StatRow
                label="Weather Modifier"
                value={prediction.weather_modifier?.toFixed(3) ?? "1.000"}
              />
              <StatRow
                label="Lineup K Vulnerability"
                value={
                  prediction.lineup_k_vulnerability !== null
                    ? `${(prediction.lineup_k_vulnerability * 100).toFixed(1)}%`
                    : "—"
                }
              />
              <StatRow
                label="Model P(Over)"
                value={
                  prediction.model_prob_over !== null
                    ? `${(prediction.model_prob_over * 100).toFixed(1)}%`
                    : "—"
                }
              />
              <StatRow
                label="Model P(Under)"
                value={
                  prediction.model_prob_under !== null
                    ? `${(prediction.model_prob_under * 100).toFixed(1)}%`
                    : "—"
                }
              />
              <StatRow
                label="Book Implied Over"
                value={
                  prediction.book_implied_over !== null
                    ? `${(prediction.book_implied_over * 100).toFixed(1)}%`
                    : "—"
                }
              />
              <StatRow
                label="Book Implied Under"
                value={
                  prediction.book_implied_under !== null
                    ? `${(prediction.book_implied_under * 100).toFixed(1)}%`
                    : "—"
                }
              />
            </tbody>
          </table>
        </section>

        {/* Model weights */}
        <section className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Model Weights</h2>
          {prediction.model_weights ? (
            <div className="space-y-3">
              {Object.entries(prediction.model_weights).map(([key, value]) => (
                <div key={key}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="capitalize text-slate-300">{key}</span>
                    <span className="text-slate-400">{(Number(value) * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-700">
                    <div
                      className="h-2 rounded-full bg-brand"
                      style={{ width: `${Number(value) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No weight data</p>
          )}

          {/* Actual result (post-game) */}
          {prediction.game_status === "final" && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Actual Result
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-700 p-3 text-center">
                  <p className="text-xs text-slate-400">Ks</p>
                  <p className="text-xl font-bold text-white">
                    {prediction.actual_ks ?? "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-700 p-3 text-center">
                  <p className="text-xs text-slate-400">IP</p>
                  <p className="text-xl font-bold text-white">
                    {prediction.actual_ip?.toFixed(1) ?? "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-700 p-3 text-center">
                  <p className="text-xs text-slate-400">Pitches</p>
                  <p className="text-xl font-bold text-white">
                    {prediction.actual_pitch_count ?? "—"}
                  </p>
                </div>
              </div>
              {prediction.model_correct !== null && (
                <div
                  className={`mt-3 rounded-lg p-2 text-center text-sm font-medium ${
                    prediction.model_correct
                      ? "bg-green-900/40 text-green-400"
                      : "bg-red-900/40 text-red-400"
                  }`}
                >
                  Model {prediction.model_correct ? "Correct ✓" : "Incorrect ✗"}
                  {prediction.clv !== null && (
                    <span className="ml-2 text-xs opacity-75">
                      CLV: {prediction.clv > 0 ? "+" : ""}
                      {prediction.clv.toFixed(2)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Line movement chart */}
      {lineSnapshots.length > 0 && (
        <section className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Line Movement</h2>
          <LineMovementChart snapshots={lineSnapshots} openingLine={prediction.opening_line} />
        </section>
      )}

      {/* Lineup matchup */}
      <section className="rounded-xl border border-slate-700 bg-slate-800 p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Lineup Matchup</h2>
        <LineupTable
          lineupData={prediction.lineup_data ?? null}
          pitcherHand={prediction.pitcher_hand ?? "R"}
          lineupStatus={prediction.lineup_confirmation_status ?? "unconfirmed"}
        />
      </section>

      {/* Bet logger */}
      <section className="rounded-xl border border-slate-700 bg-slate-800 p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Log Your Bet</h2>
        <BetLogger prediction={prediction} />
      </section>
    </div>
  );
}

function BigStatCard({
  label,
  value,
  sub,
  valueClassName = "text-white"
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${valueClassName}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="py-2 text-slate-400">{label}</td>
      <td className="py-2 text-right font-medium text-slate-200">{value}</td>
    </tr>
  );
}

function StatusBadge({
  label,
  color
}: {
  label: string;
  color: "green" | "yellow" | "orange" | "slate" | "red";
}) {
  const colorMap = {
    green: "bg-green-900/40 text-green-400 border-green-700",
    yellow: "bg-yellow-900/40 text-yellow-400 border-yellow-700",
    orange: "bg-orange-900/40 text-orange-400 border-orange-700",
    slate: "bg-slate-700 text-slate-300 border-slate-600",
    red: "bg-red-900/40 text-red-400 border-red-700"
  };
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-medium ${colorMap[color]}`}
    >
      {label}
    </span>
  );
}
