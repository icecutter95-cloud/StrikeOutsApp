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

interface LineMovementChartProps {
  snapshots: LineSnapshot[];
  openingLine?: number | null;
}

interface ChartPoint {
  time: string;
  timestamp: number;
  line: number;
  oddsOver: number | null;
  oddsUnder: number | null;
  book: string | null;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}

export default function LineMovementChart({
  snapshots,
  openingLine
}: LineMovementChartProps) {
  if (snapshots.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        No line movement data yet
      </p>
    );
  }

  const data: ChartPoint[] = snapshots.map((s) => ({
    time: format(new Date(s.created_at), "h:mm a"),
    timestamp: new Date(s.created_at).getTime(),
    line: Number(s.line),
    oddsOver: s.odds_over,
    oddsUnder: s.odds_under,
    book: s.book_key
  }));

  const firstLine = data[0].line;
  const lastLine = data[data.length - 1].line;
  const lineMovedUp = lastLine > firstLine;
  const lineColor = lineMovedUp ? "#60a5fa" : "#f87171"; // blue = up, red = down

  const minLine = Math.min(...data.map((d) => d.line)) - 0.5;
  const maxLine = Math.max(...data.map((d) => d.line)) + 0.5;

  return (
    <div className="space-y-2">
      {/* Movement summary */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-slate-400">
          Opening:{" "}
          <span className="font-medium text-white">
            {openingLine?.toFixed(1) ?? data[0].line.toFixed(1)}
          </span>
        </span>
        <span className="text-slate-400">
          Current:{" "}
          <span className="font-medium text-white">{lastLine.toFixed(1)}</span>
        </span>
        {openingLine !== null && openingLine !== undefined && (
          <span
            className={`font-medium ${
              lastLine > openingLine
                ? "text-blue-400"
                : lastLine < openingLine
                ? "text-red-400"
                : "text-slate-400"
            }`}
          >
            {lastLine > openingLine
              ? `+${(lastLine - openingLine).toFixed(1)}`
              : lastLine < openingLine
              ? `${(lastLine - openingLine).toFixed(1)}`
              : "No change"}
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
            domain={[minLine, maxLine]}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={{ stroke: "#475569" }}
            tickLine={false}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip content={<CustomTooltip />} />
          {openingLine !== null && openingLine !== undefined && (
            <ReferenceLine
              y={openingLine}
              stroke="#64748b"
              strokeDasharray="4 4"
              label={{
                value: `Open ${openingLine.toFixed(1)}`,
                fill: "#64748b",
                fontSize: 10,
                position: "insideTopRight"
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="line"
            stroke={lineColor}
            strokeWidth={2.5}
            dot={{ r: 4, fill: lineColor, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: lineColor }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 p-3 text-sm shadow-xl">
      <p className="font-semibold text-white">{d.time}</p>
      <p className="text-slate-300">
        Line: <span className="font-bold text-white">{d.line.toFixed(1)}</span>
      </p>
      {d.oddsOver !== null && (
        <p className="text-slate-400">
          Over: {d.oddsOver > 0 ? "+" : ""}
          {d.oddsOver}
        </p>
      )}
      {d.oddsUnder !== null && (
        <p className="text-slate-400">
          Under: {d.oddsUnder > 0 ? "+" : ""}
          {d.oddsUnder}
        </p>
      )}
      {d.book && <p className="mt-1 text-xs text-slate-500">{d.book}</p>}
    </div>
  );
}
