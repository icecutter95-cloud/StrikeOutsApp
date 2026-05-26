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
}

interface ChartPoint {
  time: string;
  overProb: number;
  underProb: number;
  oddsOver: number | null;
  oddsUnder: number | null;
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

function fmt(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

export default function OddsMovementChart({ snapshots }: OddsMovementChartProps) {
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

  const data: ChartPoint[] = validSnaps.map((s) => ({
    time: format(new Date(s.created_at), "h:mm a"),
    overProb: toImpliedProb(s.odds_over!),
    underProb: toImpliedProb(s.odds_under!),
    oddsOver: s.odds_over,
    oddsUnder: s.odds_under
  }));

  const first = data[0];
  const last = data[data.length - 1];
  const overShift = last.overProb - first.overProb; // + means market buying overs

  const allProbs = data.flatMap((d) => [d.overProb, d.underProb]);
  const minY = Math.floor(Math.min(...allProbs)) - 3;
  const maxY = Math.ceil(Math.max(...allProbs)) + 3;

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

      <ResponsiveContainer width="100%" height={220}>
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
          <Tooltip content={<CustomTooltip />} />
          {/* 50% = fair-value reference */}
          <ReferenceLine
            y={50}
            stroke="#475569"
            strokeDasharray="4 4"
            label={{
              value: "50%",
              fill: "#64748b",
              fontSize: 10,
              position: "insideTopRight"
            }}
          />
          <Line
            type="monotone"
            dataKey="overProb"
            name="Over"
            stroke="#4ade80"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#4ade80", strokeWidth: 0 }}
            activeDot={{ r: 6, fill: "#4ade80" }}
          />
          <Line
            type="monotone"
            dataKey="underProb"
            name="Under"
            stroke="#60a5fa"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#60a5fa", strokeWidth: 0 }}
            activeDot={{ r: 6, fill: "#60a5fa" }}
          />
        </LineChart>
      </ResponsiveContainer>

      <p className="text-xs text-slate-500">
        Implied probability converted from American odds — higher = more market money on that side.
        Green = over, blue = under.
      </p>
    </div>
  );
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 p-3 text-sm shadow-xl">
      <p className="mb-1.5 font-semibold text-white">{d.time}</p>
      <p className="text-green-400">
        Over:{" "}
        <span className="font-bold">
          {d.oddsOver !== null ? fmt(d.oddsOver) : "—"}
        </span>
        <span className="ml-1.5 text-xs text-slate-400">
          ({d.overProb.toFixed(1)}% implied)
        </span>
      </p>
      <p className="text-blue-400">
        Under:{" "}
        <span className="font-bold">
          {d.oddsUnder !== null ? fmt(d.oddsUnder) : "—"}
        </span>
        <span className="ml-1.5 text-xs text-slate-400">
          ({d.underProb.toFixed(1)}% implied)
        </span>
      </p>
    </div>
  );
}
