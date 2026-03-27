import type { LineupPlayer } from "@/lib/types";

interface LineupTableProps {
  lineupData: LineupPlayer[] | null;
  pitcherHand: "R" | "L";
  lineupStatus: "confirmed" | "partial" | "unconfirmed";
}

const HIGH_K_THRESHOLD = 0.30;

export default function LineupTable({
  lineupData,
  pitcherHand,
  lineupStatus
}: LineupTableProps) {
  if (lineupStatus === "unconfirmed") {
    return (
      <div className="rounded-lg border border-yellow-700 bg-yellow-900/20 p-4 text-center">
        <p className="text-yellow-400 font-medium">❓ Lineup Unconfirmed</p>
        <p className="mt-1 text-sm text-yellow-500">
          Lineups are typically posted 1–3 hours before first pitch. Check back closer to game time.
        </p>
      </div>
    );
  }

  if (!lineupData || lineupData.length === 0) {
    return (
      <p className="text-sm text-slate-500">No lineup data available.</p>
    );
  }

  return (
    <div className="space-y-3">
      {lineupStatus === "partial" && (
        <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/10 px-3 py-2 text-sm text-yellow-500">
          ⚠️ Partial lineup — some batters may be unconfirmed
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="pb-2 text-left text-xs uppercase tracking-wide text-slate-500">#</th>
              <th className="pb-2 text-left text-xs uppercase tracking-wide text-slate-500">Batter</th>
              <th className="pb-2 text-center text-xs uppercase tracking-wide text-slate-500">Bats</th>
              <th className="pb-2 text-right text-xs uppercase tracking-wide text-slate-500">
                K% vs {pitcherHand}HP
              </th>
              <th className="pb-2 text-right text-xs uppercase tracking-wide text-slate-500">
                K Contribution
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {lineupData.map((batter) => {
              const kPct =
                pitcherHand === "R" ? batter.k_pct_vs_rhp : batter.k_pct_vs_lhp;
              const isHighK = kPct !== null && kPct !== undefined && kPct > HIGH_K_THRESHOLD;

              return (
                <tr
                  key={batter.batter_id}
                  className={isHighK ? "bg-red-900/10" : ""}
                >
                  <td className="py-2 text-slate-500">{batter.batting_order}</td>
                  <td className="py-2 font-medium text-slate-200">
                    {batter.batter_name}
                    {isHighK && (
                      <span className="ml-1 text-xs text-red-400">▲</span>
                    )}
                  </td>
                  <td className="py-2 text-center text-slate-400">
                    {batter.hand ?? "—"}
                  </td>
                  <td className="py-2 text-right">
                    {kPct !== null && kPct !== undefined ? (
                      <span className={isHighK ? "font-semibold text-red-400" : "text-slate-300"}>
                        {(kPct * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right text-slate-500">
                    {kPct !== null && kPct !== undefined
                      ? `~${(kPct * 0.9).toFixed(2)}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
