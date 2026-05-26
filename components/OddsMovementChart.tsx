"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer
} from "recharts";
import type { LineSnapshot } from "@/lib/types";
import { format } from "date-fns";

interface OddsMovementChartProps {
  snapshots: LineSnapshot[];
  projectedKs?: number | null;
  recommendation?: string | null;
}

interface ChartPoint {
  time: string;
  propLine: number;
  overProb: number;
  underProb: number;
  oddsOver: number | null;
  oddsUnder: number | null;
  modelSideProb: number | null; // P(Over) or P(Under) depending on recommendation
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}

/** Convert American odds to implied probability (0–100). */
function toImpliedProb(odds: number): number {
  if (odds > 0) return (100 / (odds + 100)) * 100;
  return (Math.abs(odds) / (Math.abs(odds) + 100)) * 100;
}

/**
 * Poisson CDF — P(Ks ≤ maxK) with mean λ.
 * Used to compute the model's probability of going UNDER a given line.
 * For "Under 4.5": maxK = floor(4.5) = 4 → P(Ks ≤ 4).
 */
function poissonCDF(maxK: number, lambda: number): number {
  if (lambda <= 0) return 1;
  let cdf = 0;
  let term = Math.exp(-lambda); // P(k=0) = e^-λ
  for (let k = 0; k <= maxK; k++) {
    cdf += term;
    term *= lambda / (k + 1); // recurrence: P(k+1) = P(k) * λ/(k+1)
  }
  return Math.min(cdf, 1);
}

function fmt(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

export default function OddsMovementChart({ snapshots, projectedKs, recommendation }: OddsMovementChartProps) {
  const validSnaps = snapshots.filter(
    (s) => s.odds_over !== null && s.odds_under !== null
  );

  if (validSnaps.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        No odds data yet — snapshots populate once the line goes live
      </p>
    );
  }

  const showModel = projectedKs !== null && projectedKs !== undefined && projectedKs > 0;
  const isOver = recommendation === "BET_OVER";
  const modelSideLabel = isOver ? "Over" : "Under";

  const data: ChartPoint[] = validSnaps.map((s) => {
    const propLine = Number(s.line);
    let modelSideProb: number | null = null;
    if (showModel) {
      const pUnder = poissonCDF(Math.floor(propLine), projectedKs!) * 100;
      modelSideProb = isOver ? 100 - pUnder : pUnder;
    }
    return {
      time: format(new Date(s.created_at), "h:mm a"),
      propLine,
      overProb: toImpliedProb(s.odds_over!),
      underProb: toImpliedProb(s.odds_under!),
      oddsOver: s.odds_over,
      oddsUnder: s.odds_under,
      modelSideProb
    };
  });

  const first = data[0];
  const last  = data[data.length - 1];
  const overShift = last.overProb - first.overProb;

  // Y-axis domain: cover all three series
  const allProbs = data.flatMap((d) =>
    d.modelSideProb !== null
      ? [d.overProb, d.underProb, d.modelSideProb]
      : [d.overProb, d.underProb]
  );
  const minY = Math.floor(Math.min(...allProbs)) - 3;
  const maxY = Math.ceil(Math.max(...allProbs)) + 3;

  // Current model edge on the recommended side
  const bookSideProb = isOver ? last.overProb : last.underProb;
  const currentModelEdge =
    showModel && last.modelSideProb !== null
      ? last.modelSideProb - bookSideProb
      : null;

  return (
    <div className="space-y-3">
      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-5 text-sm">
        <div className="space-y-0.5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Over</p>
          <p className="font-medium">
            <span className="text-slate-400">{first.oddsOver !== null ? fmt(first.oddsOver) : "—"}</span>
            <span className="mx-1.5 text-slate-600">→</span>
            <span className="font-bold text-green-400">{last.oddsOver !== null ? fmt(last.oddsOver) : "—"}</span>
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Under</p>
          <p className="font-medium">
            <span className="text-slate-400">{first.oddsUnder !== null ? fmt(first.oddsUnder) : "—"}</span>
            <span className="mx-1.5 text-slate-600">→</span>
            <span className="font-bold text-blue-400">{last.oddsUnder !== null ? fmt(last.oddsUnder) : "—"}</span>
          </p>
        </div>
        {showModel && currentModelEdge !== null && (
          <div className="space-y-0.5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Model Edge ({modelSideLabel} {last.propLine.toFixed(1)})
            </p>
            <p className={`font-bold ${currentModelEdge >= 0 ? "text-amber-400" : "text-red-400"}`}>
              {currentModelEdge >= 0 ? "+" : ""}{currentModelEdge.toFixed(1)}%
            </p>
          </div>
        )}
        {Math.abs(overShift) >= 2 && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              overShift > 0
                ? "bg-green-900/40 text-green-400"
                : "bg-blue-900/40 text-blue-400"
            }`}
          >
            Market → {overShift > 0 ? "Overs" : "Unders"} ({Math.abs(overShift).toFixed(1)}% implied)
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-green-400 rounded" />
          Book Over implied
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-blue-400 rounded" />
          Book Under implied
        </span>
        {showModel && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-amber-400" />
            Model P({modelSideLabel}) — Poisson, proj. {projectedKs!.toFixed(1)} Ks
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="time"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={{ stroke: "#475569" }}
            tickLine={false}
          />
          <YAxis
            domain={[minY, maxY]}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={{ stroke: "#475569" }}
            tickLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            width={40}
          />
          <Tooltip content={<CustomTooltip showModel={showModel} isOver={isOver} modelSideLabel={modelSideLabel} />} />
          {/* 50% = fair-value reference */}
          <ReferenceLine
            y={50}
            stroke="#475569"
            strokeDasharray="4 4"
            label={{ value: "50%", fill: "#64748b", fontSize: 10, position: "insideTopRight" }}
          />
          <Line
            type="monotone"
            dataKey="overProb"
            stroke="#4ade80"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#4ade80", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "#4ade80" }}
          />
          <Line
            type="monotone"
            dataKey="underProb"
            stroke="#60a5fa"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#60a5fa", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "#60a5fa" }}
          />
          {showModel && (
            <Line
              type="stepAfter"
              dataKey="modelSideProb"
              stroke="#fbbf24"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              activeDot={{ r: 5, fill: "#fbbf24" }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      <p className="text-xs text-slate-500">
        Book lines = implied probability from American odds.
        {showModel && (
          <> Yellow dashed = model&apos;s P({modelSideLabel}) via Poisson at each snapshot&apos;s prop line (proj. {projectedKs!.toFixed(1)} Ks).
          Gap between yellow and {isOver ? "green" : "blue"} = model edge on the {modelSideLabel.toLowerCase()}.</>
        )}
      </p>
    </div>
  );
}

function CustomTooltip({
  active,
  payload,
  showModel,
  isOver,
  modelSideLabel
}: TooltipProps & { showModel: boolean; isOver: boolean; modelSideLabel: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  const bookSideProb = isOver ? d.overProb : d.underProb;
  const edge =
    showModel && d.modelSideProb !== null
      ? d.modelSideProb - bookSideProb
      : null;

  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 p-3 text-sm shadow-xl">
      <p className="mb-1.5 font-semibold text-white">
        {d.time}
        <span className="ml-2 text-xs font-normal text-slate-400">
          Line: {d.propLine.toFixed(1)}
        </span>
      </p>
      <p className="text-green-400">
        Over: <span className="font-bold">{d.oddsOver !== null ? fmt(d.oddsOver) : "—"}</span>
        <span className="ml-1.5 text-xs text-slate-400">({d.overProb.toFixed(1)}%)</span>
      </p>
      <p className="text-blue-400">
        Under: <span className="font-bold">{d.oddsUnder !== null ? fmt(d.oddsUnder) : "—"}</span>
        <span className="ml-1.5 text-xs text-slate-400">({d.underProb.toFixed(1)}%)</span>
      </p>
      {showModel && d.modelSideProb !== null && (
        <>
          <p className="mt-1 text-amber-400">
            Model P({modelSideLabel}): <span className="font-bold">{d.modelSideProb.toFixed(1)}%</span>
          </p>
          {edge !== null && (
            <p className={`text-xs mt-0.5 ${edge >= 0 ? "text-amber-300" : "text-red-400"}`}>
              Edge: {edge >= 0 ? "+" : ""}{edge.toFixed(1)}%
            </p>
          )}
        </>
      )}
    </div>
  );
}
