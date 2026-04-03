"use client";

import { useRouter } from "next/navigation";

interface TierStat {
  tier: string;
  min: number;
  max: number;
  bets: number;
  accuracy: number | null;
  wins: number;
  losses: number;
  roi: number;
}

interface StatsTableProps {
  tierStats: TierStat[];
  activeTierMin?: number | null;
}

export default function StatsTable({ tierStats, activeTierMin }: StatsTableProps) {
  const router = useRouter();

  if (tierStats.every((t) => t.bets === 0)) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-500">
        No completed bets yet
      </div>
    );
  }

  const handleRowClick = (min: number) => {
    if (activeTierMin === min) {
      // clicking the active tier deselects it
      router.push("/history");
    } else {
      router.push(`/history?edge_tier=${min}`);
    }
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-slate-400">
              Edge Tier
            </th>
            <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-400">
              Total Bets
            </th>
            <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-400">
              Record
            </th>
            <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-400">
              Accuracy
            </th>
            <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-400">
              ROI (units)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50 bg-slate-800/50">
          {tierStats.map((row) => {
            const isActive = activeTierMin === row.min;
            return (
              <tr
                key={row.tier}
                onClick={() => handleRowClick(row.min)}
                className={`cursor-pointer transition-colors hover:bg-slate-700/50 ${
                  isActive
                    ? "bg-brand/10 ring-1 ring-inset ring-brand/40"
                    : ""
                }`}
              >
                <td className="px-4 py-3 font-medium text-white">
                  {row.tier}
                  {isActive && (
                    <span className="ml-2 text-xs font-normal text-brand">
                      ← filtered
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">{row.bets}</td>
                <td className="px-4 py-3 text-right font-medium">
                  {row.wins > 0 || row.losses > 0 ? (
                    <span>
                      <span className="text-green-400">{row.wins}</span>
                      <span className="text-slate-500">-</span>
                      <span className="text-red-400">{row.losses}</span>
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {row.accuracy !== null ? (
                    <span
                      className={
                        row.accuracy >= 55
                          ? "font-semibold text-green-400"
                          : row.accuracy >= 50
                          ? "text-slate-200"
                          : "text-red-400"
                      }
                    >
                      {row.accuracy.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={
                      row.roi > 0
                        ? "font-semibold text-green-400"
                        : row.roi < 0
                        ? "text-red-400"
                        : "text-slate-400"
                    }
                  >
                    {row.roi > 0 ? "+" : ""}
                    {row.roi.toFixed(1)}u
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
