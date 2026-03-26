"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Prediction } from "@/lib/types";

interface BetLoggerProps {
  prediction: Prediction;
}

const BOOKS = [
  "DraftKings",
  "FanDuel",
  "BetMGM",
  "Caesars",
  "PointsBet",
  "BetRivers",
  "Barstool",
  "Other"
];

export default function BetLogger({ prediction }: BetLoggerProps) {
  const router = useRouter();
  const [side, setSide] = useState<string>(prediction.user_bet_side ?? "over");
  const [units, setUnits] = useState<string>(
    prediction.user_bet_units?.toString() ?? prediction.recommended_units?.toString() ?? "1"
  );
  const [book, setBook] = useState<string>(prediction.user_bet_book ?? "DraftKings");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const betAlreadyPlaced = prediction.user_bet_placed;

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/predictions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: prediction.id,
          user_bet_placed: true,
          user_bet_side: side,
          user_bet_units: parseFloat(units),
          user_bet_book: book
        })
      });
      if (res.ok) {
        setMessage("Bet logged successfully ✓");
        router.refresh();
      } else {
        const data = await res.json() as { error?: string };
        setMessage(data.error ?? "Failed to save");
      }
    } catch {
      setMessage("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/predictions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: prediction.id,
          user_bet_placed: false,
          user_bet_side: null,
          user_bet_units: null,
          user_bet_book: null
        })
      });
      if (res.ok) {
        setMessage("Bet removed");
        router.refresh();
      }
    } catch {
      setMessage("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {betAlreadyPlaced && (
        <div className="rounded-lg border border-green-700/50 bg-green-900/20 px-4 py-3">
          <p className="text-sm font-medium text-green-400">
            Bet logged: {prediction.user_bet_units}u {prediction.user_bet_side?.toUpperCase()} @ {prediction.user_bet_book}
          </p>
          {prediction.bet_result && (
            <p
              className={`mt-1 text-sm font-bold capitalize ${
                prediction.bet_result === "win"
                  ? "text-green-300"
                  : prediction.bet_result === "loss"
                  ? "text-red-400"
                  : "text-slate-400"
              }`}
            >
              Result: {prediction.bet_result}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        {/* Side selector */}
        <div>
          <label className="mb-1 block text-xs text-slate-400">Side</label>
          <div className="flex gap-2">
            {["over", "under"].map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
                  side === s
                    ? s === "over"
                      ? "bg-green-700 text-white"
                      : "bg-blue-700 text-white"
                    : "border border-slate-600 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Units */}
        <div>
          <label className="mb-1 block text-xs text-slate-400">Units</label>
          <input
            type="number"
            step="0.5"
            min="0.5"
            max="5"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className="w-20 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white"
          />
        </div>

        {/* Book */}
        <div>
          <label className="mb-1 block text-xs text-slate-400">Sportsbook</label>
          <select
            value={book}
            onChange={(e) => setBook(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white"
          >
            {BOOKS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      {message && (
        <p className="text-sm text-slate-400">{message}</p>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? "Saving..." : betAlreadyPlaced ? "Update Bet" : "Log Bet"}
        </button>
        {betAlreadyPlaced && (
          <button
            onClick={handleRemove}
            disabled={saving}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-400 hover:bg-slate-700 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
