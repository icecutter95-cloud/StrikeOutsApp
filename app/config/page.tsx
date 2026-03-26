import { createClient } from "@/lib/supabase/server";
import type { ModelConfig } from "@/lib/types";
import ModelConfigPanel from "@/components/ModelConfigPanel";

export const revalidate = 0;

export default async function ConfigPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("model_config")
    .select("*")
    .eq("id", 1)
    .single();

  const config = data as ModelConfig | null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Model Configuration</h1>
        <p className="text-sm text-slate-400">
          Adjust projection weights, edge thresholds, and betting unit sizing
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-red-300">
          <p>Failed to load config: {error.message}</p>
        </div>
      )}

      {config && <ModelConfigPanel initialConfig={config} />}
    </div>
  );
}
