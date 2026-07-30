"use client";

import { useRouter } from "next/navigation";

interface RecentRecord {
  wins: number;
  losses: number;
  count: number; // actual bets in window (may be < 10/20 if tier has fewer)
}

interface TierStat {
  tier: string;
  min: number;
  max: number;
  bets: number;
  accuracy: number | null;
  wins: number;
  losses: number;
  roi: number;
  last10?: RecentRecord;
  last20?: RecentRecord;
}

interface StatsTableProps {
  tierStats: TierStat[];
  /** Aggregate row across every recommended bet, regardless of edge tier. */
  totals?: TierStat;
  activeTierMin?: number | null;
}

function RecentRecordCell({ record }: { record?: RecentRecord }) {
  if (!record || record.count === 0) {
    return <span className="text-slate-600">—</span>;
  }
  const pct = record.wins / record.count;
  const color =
    pct >= 0.55 ? "text-green-400" : pct >= 0.50 ? "text-slate-300" : "text-red-400";
  return (
    <span className={`font-medium ${color}`}>
      {record.wins}-{record.losses}
      {record.count < 10 && (
        <span className="ml-1 text-xs font-normal text-slate-500">
          ({record.count})
        </span>
      )}
    </span>
  );
}

/** The seven data cells shared by both a tier row and the totals row. */
function StatRowCells({ row, bold }: { row: TierStat; bold?: boolean }) {
  return (
    <>
      <td className={`px-4 py-3 text-right ${bold ? "font-semibold text-white" : "text-slate-300"}`}>
        {row.bets}
      </td>
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
        <RecentRecordCell record={row.last10} />
      </td>
      <td className="px-4 py-3 text-right">
        <RecentRecordCell record={row.last20} />
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
    </>
  );
}

export default function StatsTable({ tierStats, totals, activeTierMin }: StatsTableProps) {
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
              Last 10
            </th>
            <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-400">
              Last 20
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
                <StatRowCells row={row} />
              </tr>
            );
          })}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t-2 border-slate-600 bg-slate-800/80">
              <td className="px-4 py-3 font-semibold text-white">{totals.tier}</td>
              <StatRowCells row={totals} bold />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
