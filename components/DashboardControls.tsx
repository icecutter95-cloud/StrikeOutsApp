"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SortKey = "edge" | "margin" | "time" | "move";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "edge",   label: "Edge %"    },
  { key: "margin", label: "Margin"    },
  { key: "time",   label: "Game Time" },
  { key: "move",   label: "Odds Move" }
];

interface DashboardControlsProps {
  date: string;
  sort: SortKey;
}

export default function DashboardControls({ date, sort }: DashboardControlsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleRefresh = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/projections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date })
      });
      const data = await res.json() as { total_games?: number; projections?: unknown[] };
      if (res.ok) {
        setMessage(`Updated ${data.projections?.length ?? 0} projections`);
        router.refresh();
      } else {
        setMessage("Failed to refresh projections");
      }
    } catch {
      setMessage("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (newDate: string) => {
    router.push(`/?date=${newDate}&sort=${sort}`);
  };

  const handleSort = (newSort: SortKey) => {
    router.push(`/?date=${date}&sort=${newSort}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {message && (
        <span className="text-sm text-slate-400">{message}</span>
      )}

      {/* Sort toggle */}
      <div className="flex rounded-lg border border-slate-600 overflow-hidden text-sm font-medium">
        {SORT_OPTIONS.map((opt, i) => (
          <button
            key={opt.key}
            onClick={() => handleSort(opt.key)}
            className={`px-3 py-2 transition-colors ${
              i > 0 ? "border-l border-slate-600" : ""
            } ${
              sort === opt.key
                ? "bg-brand text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <input
        type="date"
        value={date}
        onChange={(e) => handleDateChange(e.target.value)}
        className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
      />
      <button
        onClick={handleRefresh}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
      >
        {loading ? (
          <>
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Refreshing...
          </>
        ) : (
          <>↻ Refresh Projections</>
        )}
      </button>
    </div>
  );
}
