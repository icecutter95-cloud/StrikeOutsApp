"use client";

import { useState } from "react";
import type { ModelConfig } from "@/lib/types";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";

interface ModelConfigPanelProps {
  initialConfig: ModelConfig;
}

const WEIGHT_COLORS = ["#1a56db", "#22c55e", "#f59e0b", "#ec4899"];

const DEFAULT_CONFIG: Omit<ModelConfig, "id" | "updated_at"> = {
  weight_last3: 0.35,
  weight_season: 0.30,
  weight_csw: 0.20,
  weight_xfip: 0.15,
  edge_tier1_min: 0.04,
  edge_tier1_units: 1.0,
  edge_tier2_min: 0.07,
  edge_tier2_units: 1.5,
  edge_tier3_min: 0.10,
  edge_tier3_units: 2.0,
  unconfirmed_lineup_penalty: 0.02
};

export default function ModelConfigPanel({ initialConfig }: ModelConfigPanelProps) {
  const [config, setConfig] = useState<ModelConfig>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const weightSum =
    config.weight_last3 +
    config.weight_season +
    config.weight_csw +
    config.weight_xfip;

  const weightsValid = Math.abs(weightSum - 1.0) < 0.001;

  const pieData = [
    { name: "Last 3 Starts", value: config.weight_last3 },
    { name: "Season K%", value: config.weight_season },
    { name: "CSW%", value: config.weight_csw },
    { name: "xFIP", value: config.weight_xfip }
  ];

  const handleWeightChange = (field: keyof ModelConfig, value: number) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!weightsValid) {
      setMessage({ type: "error", text: "Weights must sum to 1.0" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      const data = await res.json() as { config?: ModelConfig; error?: string };
      if (res.ok && data.config) {
        setConfig(data.config);
        setMessage({ type: "success", text: "Configuration saved successfully" });
      } else {
        setMessage({ type: "error", text: data.error ?? "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig((prev) => ({ ...prev, ...DEFAULT_CONFIG }));
    setMessage({ type: "success", text: "Reset to defaults (not yet saved)" });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Weights */}
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Model Weights</h2>
          <p
            className={`mb-4 text-sm ${weightsValid ? "text-slate-500" : "text-red-400 font-medium"}`}
          >
            Sum: {(weightSum * 100).toFixed(1)}% {weightsValid ? "✓" : "— must equal 100%"}
          </p>
          <div className="space-y-4">
            <WeightSlider
              label="Last 3 Starts"
              field="weight_last3"
              value={config.weight_last3}
              onChange={handleWeightChange}
              color={WEIGHT_COLORS[0]}
            />
            <WeightSlider
              label="Season K%"
              field="weight_season"
              value={config.weight_season}
              onChange={handleWeightChange}
              color={WEIGHT_COLORS[1]}
            />
            <WeightSlider
              label="CSW%"
              field="weight_csw"
              value={config.weight_csw}
              onChange={handleWeightChange}
              color={WEIGHT_COLORS[2]}
            />
            <WeightSlider
              label="xFIP"
              field="weight_xfip"
              value={config.weight_xfip}
              onChange={handleWeightChange}
              color={WEIGHT_COLORS[3]}
            />
          </div>
        </div>

        {/* Weight pie chart */}
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Weight Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={WEIGHT_COLORS[i % WEIGHT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                contentStyle={{ background: "#1e293b", border: "1px solid #334155", color: "#f1f5f9" }}
              />
              <Legend
                formatter={(value: string) => (
                  <span className="text-sm text-slate-300">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Edge tiers */}
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Edge Tiers & Unit Sizing</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              {
                tier: "Tier 1",
                minField: "edge_tier1_min" as const,
                unitsField: "edge_tier1_units" as const,
                color: "text-yellow-400"
              },
              {
                tier: "Tier 2",
                minField: "edge_tier2_min" as const,
                unitsField: "edge_tier2_units" as const,
                color: "text-orange-400"
              },
              {
                tier: "Tier 3",
                minField: "edge_tier3_min" as const,
                unitsField: "edge_tier3_units" as const,
                color: "text-red-400"
              }
            ] as const
          ).map(({ tier, minField, unitsField, color }) => (
            <div key={tier} className="rounded-lg bg-slate-700/50 p-4">
              <p className={`text-sm font-semibold ${color}`}>{tier}</p>
              <div className="mt-3 space-y-2">
                <label className="block">
                  <span className="text-xs text-slate-400">Min Edge</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={(config[minField] * 100).toFixed(1)}
                      onChange={(e) =>
                        handleWeightChange(minField, parseFloat(e.target.value) / 100)
                      }
                      className="mt-1 w-full rounded border border-slate-600 bg-slate-700 px-2 py-1 text-sm text-white"
                    />
                    <span className="text-slate-400 text-sm">%</span>
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">Units</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="5"
                    value={config[unitsField]}
                    onChange={(e) =>
                      handleWeightChange(unitsField, parseFloat(e.target.value))
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-700 px-2 py-1 text-sm text-white"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Other settings */}
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Other Settings</h2>
        <label className="block max-w-sm">
          <span className="text-sm text-slate-300">Unconfirmed Lineup Penalty</span>
          <p className="text-xs text-slate-500">
            Subtract this from edge% when lineup is unconfirmed
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={(config.unconfirmed_lineup_penalty * 100).toFixed(1)}
              onChange={(e) =>
                handleWeightChange(
                  "unconfirmed_lineup_penalty",
                  parseFloat(e.target.value) / 100
                )
              }
              className="w-24 rounded border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white"
            />
            <span className="text-slate-400 text-sm">%</span>
          </div>
        </label>
      </div>

      {/* Save / reset actions */}
      <div className="flex items-center gap-4">
        {message && (
          <p
            className={`text-sm ${
              message.type === "success" ? "text-green-400" : "text-red-400"
            }`}
          >
            {message.text}
          </p>
        )}
        <div className="ml-auto flex gap-3">
          <button
            onClick={handleReset}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700"
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !weightsValid}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WeightSlider({
  label,
  field,
  value,
  onChange,
  color
}: {
  label: string;
  field: keyof ModelConfig;
  value: number;
  onChange: (field: keyof ModelConfig, value: number) => void;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-medium text-white">{(value * 100).toFixed(0)}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={Math.round(value * 100)}
        onChange={(e) => onChange(field, parseInt(e.target.value, 10) / 100)}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-600"
        style={{ accentColor: color }}
      />
    </div>
  );
}
