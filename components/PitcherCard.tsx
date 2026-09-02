import Link from "next/link";
import type { Prediction } from "@/lib/types";
import {
  formatOdds,
  formatEdge,
  formatGameTime,
  getRecommendationColor,
  getActiveRecommendation,
  getActiveEdge,
  getActiveUnits,
  getProjectionMargin,
  isActiveBet,
  gateFailed
} from "@/lib/utils";

interface PitcherCardProps {
  prediction: Prediction;
  date: string;
}

export default function PitcherCard({ prediction, date }: PitcherCardProps) {
  const activeRec = getActiveRecommendation(prediction);
  const activeEdge = getActiveEdge(prediction);
  const activeUnits = getActiveUnits(prediction);
  const recColor = getRecommendationColor(activeRec ?? "NO_BET");
  const isBet = isActiveBet(prediction);

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
          <RecommendationBadge rec={activeRec} />
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
              {activeEdge !== null ? formatEdge(activeEdge) : "—"}
            </span>
          </div>
          {isBet && activeUnits !== null && <UnitBadge units={activeUnits} />}
        </div>

        {/* Status flags */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <LineupBadge status={prediction.lineup_confirmation_status} />
          <MarginBadge prediction={prediction} />
          <FormGateBadge prediction={prediction} />
          <WasRecommendedBadge prediction={prediction} />
          <LineMoveBadge prediction={prediction} />
          <OddsShiftBadge prediction={prediction} />
          <DivergenceBadge prediction={prediction} />
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

/**
 * Gap between the raw projection and the prop line — the strongest single filter
 * in the season backtest. v2 requires >= 1.5 Ks before a bet fires, so showing it
 * makes the gate legible: anything below the threshold is why a play is a No Bet.
 */
function MarginBadge({ prediction }: { prediction: Prediction }) {
  const margin = getProjectionMargin(prediction);
  if (margin === null) return null;

  const meets = margin >= 1.5;
  // gate_reason === "margin" means this specific bet had a real side selected
  // and got vetoed for falling short here — distinct from a plain low margin
  // where there was never enough disagreement with the market to matter.
  const blocked = gateFailed(prediction.adjusted_gate_reason, "margin");

  // Deliberately v2's side, not v1's raw recommendation — a heavily-favored
  // price can flip v2's own lean to the under even when the raw projection
  // sits well above the line (v1 would still call that an over). Falling back
  // to v1 here would reproduce exactly the misreading this label exists to fix.
  const side =
    prediction.adjusted_recommendation && prediction.adjusted_recommendation !== "NO_BET"
      ? prediction.adjusted_recommendation
      : prediction.adjusted_candidate_side;
  const sideLabel = !meets && side ? ` (${side === "BET_OVER" ? "Over" : "Under"})` : "";

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        meets
          ? "bg-violet-900/40 text-violet-300"
          : blocked
          ? "bg-rose-900/40 text-rose-300"
          : "bg-slate-700 text-slate-400"
      }`}
      title={
        blocked
          ? `Margin gate vetoed this bet — v2's own pricing leans ${
              side === "BET_OVER" ? "over" : "under"
            }, but the projection is only ${Math.abs(margin).toFixed(2)} Ks from the line on that side, below the 1.5 threshold.`
          : `Projection is ${Math.abs(margin).toFixed(2)} Ks from the line. v2 requires 1.5+ to bet.`
      }
    >
      Margin{sideLabel} {margin >= 0 ? "" : "−"}{Math.abs(margin).toFixed(2)}K
      {meets ? " ✓" : blocked ? " ✗" : ""}
    </span>
  );
}

/**
 * Shown only when the recent-form guard is specifically what vetoed v2's
 * candidate side (margin may or may not have also failed — see MarginBadge).
 * Direction comes straight from adjusted_candidate_side rather than being
 * re-derived from the ratio, so it can't disagree with what the Margin badge
 * is showing for the same row.
 */
function FormGateBadge({ prediction }: { prediction: Prediction }) {
  if (!gateFailed(prediction.adjusted_gate_reason, "form")) return null;
  if (prediction.adjusted_candidate_side === null) return null;

  const { last3_k_rate, season_k_pct } = prediction;
  if (last3_k_rate === null || season_k_pct === null || season_k_pct === 0) return null;

  const ratio = last3_k_rate / season_k_pct;
  const hot = prediction.adjusted_candidate_side === "BET_UNDER";

  return (
    <span
      className="rounded-full bg-fuchsia-900/40 px-2 py-0.5 text-xs font-medium text-fuchsia-300"
      title={`Last-3 K rate is running at ${(ratio * 100).toFixed(0)}% of season pace — ${
        hot ? "hot form vetoed the under" : "cold form vetoed the over"
      }.`}
    >
      Form Veto {hot ? "🔥" : "🥶"}
    </span>
  );
}

/**
 * Shown only when the card is NOT currently a live bet but was one earlier
 * today. Grading still runs off the current adjusted_recommendation (or
 * whatever it freezes to at first pitch) — this is purely a breadcrumb so
 * checking the board later than a price move doesn't erase all trace that a
 * real recommendation window existed. See Andrew Painter, 2026-09-02: over
 * was live most of the day, then the market moved (over -130 -> -162) and
 * priced it out with no visible sign one was ever there.
 */
function WasRecommendedBadge({ prediction }: { prediction: Prediction }) {
  if (isActiveBet(prediction)) return null;
  const { adjusted_first_recommended_at, adjusted_first_recommended_side, adjusted_first_recommended_odds } = prediction;
  if (adjusted_first_recommended_at === null) return null;

  const isOver = adjusted_first_recommended_side === "BET_OVER";
  const oddsLabel =
    adjusted_first_recommended_odds !== null ? formatOdds(adjusted_first_recommended_odds) : "—";

  return (
    <span
      className="rounded-full bg-sky-900/40 px-2 py-0.5 text-xs font-medium text-sky-300"
      title={`This was a live ${
        isOver ? "Over" : "Under"
      } recommendation at ${formatGameTime(adjusted_first_recommended_at)} at ${oddsLabel} — a later price move took the edge away.`}
    >
      Was {isOver ? "Over" : "Under"} @ {oddsLabel} · {formatGameTime(adjusted_first_recommended_at)}
    </span>
  );
}

function LineMoveBadge({ prediction }: { prediction: Prediction }) {
  const { opening_line, prop_line, steam_flag, steam_direction } = prediction;

  // Coerce to number — Supabase DECIMAL columns can come back as strings
  const open = opening_line !== null ? Number(opening_line) : null;
  const cur  = prop_line    !== null ? Number(prop_line)    : null;

  // Primary: we have both values and the line actually moved
  if (open !== null && cur !== null && open !== cur) {
    const direction  = cur > open ? "↑" : "↓";
    const colorClass = cur < open
      ? "bg-orange-900/40 text-orange-400"  // line dropped
      : "bg-sky-900/40 text-sky-400";       // line rose
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
        title="Prop line has moved since opening"
      >
        Line: {open.toFixed(1)}→{cur.toFixed(1)} {direction}
      </span>
    );
  }

  // Fallback: opening_line not stored but steam was detected by the cron
  if (steam_flag) {
    return (
      <span className="rounded-full bg-orange-900/40 px-2 py-0.5 text-xs font-medium text-orange-400">
        Steam {steam_direction === "up" ? "↑" : "↓"}
      </span>
    );
  }

  return null;
}

function impliedProb(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function fmtOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

function OddsShiftBadge({ prediction }: { prediction: Prediction }) {
  const {
    opening_odds_over,
    opening_odds_under,
    prop_odds_over,
    prop_odds_under
  } = prediction;
  const recommendation = getActiveRecommendation(prediction);

  // Only show for active bet recommendations
  if (!recommendation || recommendation === "NO_BET") return null;

  const isOver = recommendation === "BET_OVER";
  const openOdds = isOver ? opening_odds_over : opening_odds_under;
  const curOdds  = isOver ? prop_odds_over   : prop_odds_under;

  // Need both opening and current to compute shift
  if (!openOdds || !curOdds || openOdds === curOdds) return null;

  const shift = impliedProb(curOdds) - impliedProb(openOdds); // positive = more money on this side
  if (Math.abs(shift) < 0.015) return null; // < 1.5% implied prob shift — not worth showing

  // Market confirming your recommendation? Green. Fading it? Amber.
  const confirms = shift > 0;
  const colorClass = confirms
    ? "bg-green-900/40 text-green-400"
    : "bg-amber-900/40 text-amber-400";

  const sideLabel = isOver ? "O" : "U";
  const shiftLabel = `${shift > 0 ? "+" : ""}${(shift * 100).toFixed(1)}%`;

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
      title={`${isOver ? "Over" : "Under"} odds at open vs now. ${confirms ? "Market agrees with recommendation." : "Market fading recommendation."}`}
    >
      {sideLabel}: {fmtOdds(openOdds)}→{fmtOdds(curOdds)}{" "}
      <span className="opacity-75">({shiftLabel})</span>
    </span>
  );
}

function computeStuffDivergence(prediction: Prediction): {
  type: "regression" | "upside" | null;
  pct: number;
} {
  const { last3_k_rate, swstr_pct, csw_pct } = prediction;
  if (last3_k_rate === null) return { type: null, pct: 0 };

  // Prefer SwStr% — it's the metric computeCSWK9() actually uses, and the only
  // one Savant populates. csw_pct remains as a fallback but is NULL in practice.
  // Calibrations mirror lib/projection: SwStr% * 81, CSW% * 25.
  let stuffK9: number;
  if (swstr_pct !== null) {
    stuffK9 = (swstr_pct > 1 ? swstr_pct / 100 : swstr_pct) * 81;
  } else if (csw_pct !== null) {
    stuffK9 = (csw_pct > 1 ? csw_pct / 100 : csw_pct) * 25;
  } else {
    return { type: null, pct: 0 };
  }

  const last3K9 = last3_k_rate <= 1 ? last3_k_rate * 27 : last3_k_rate;

  if (stuffK9 === 0) return { type: null, pct: 0 };
  const divergence = (last3K9 - stuffK9) / stuffK9;

  if (divergence > 0.3) return { type: "regression", pct: divergence };
  if (divergence < -0.3) return { type: "upside", pct: divergence };
  return { type: null, pct: divergence };
}

function DivergenceBadge({ prediction }: { prediction: Prediction }) {
  const { type, pct } = computeStuffDivergence(prediction);
  if (!type) return null;

  if (type === "regression") {
    return (
      <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-400"
        title={`Last 3 starts K/9 is ${Math.abs(pct * 100).toFixed(0)}% above CSW%-implied rate — regression risk`}>
        Regression Risk ↓
      </span>
    );
  }
  return (
    <span className="rounded-full bg-cyan-900/40 px-2 py-0.5 text-xs font-medium text-cyan-400"
      title={`Last 3 starts K/9 is ${Math.abs(pct * 100).toFixed(0)}% below CSW%-implied rate — stuff suggests upside`}>
      Upside Risk ↑
    </span>
  );
}
