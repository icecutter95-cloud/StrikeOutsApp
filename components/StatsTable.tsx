interface TierStat {
  tier: string;
  bets: number;
  accuracy: number | null;
  wins: number;
  losses: number;
  roi: number;
}

interface StatsTableProps {
  tierStats: TierStat[];
}

export default function StatsTable({ tierStats }: StatsTableProps) {
  if (tierStats.every((t) => t.bets === 0)) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-500">
        No completed bets yet
      </div>
    );
  }

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
              Accuracy
            </th>
            <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-400">
              W / L
            </th>
            <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-400">
              ROI (units)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50 bg-slate-800/50">
          {tierStats.map((row) => (
            <tr key={row.tier} className="hover:bg-slate-700/30">
              <td className="px-4 py-3 font-medium text-white">{row.tier}</td>
              <td className="px-4 py-3 text-right text-slate-300">{row.bets}</td>
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
                <span className="text-green-400">{row.wins}W</span>
                {" / "}
                <span className="text-red-400">{row.losses}L</span>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
