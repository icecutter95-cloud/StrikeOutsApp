import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { ModelConfig } from "@/lib/types";

// ============================================================
// GET /api/config — fetch model_config
// ============================================================
export async function GET() {
  try {
    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("model_config")
      .select("*")
      .eq("id", 1)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: data as ModelConfig });
  } catch (err) {
    console.error("[config] GET exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ============================================================
// PUT /api/config — update model_config
// ============================================================
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Partial<ModelConfig>;

    // Only allow updatable fields
    const allowedFields: (keyof ModelConfig)[] = [
      "weight_last3",
      "weight_season",
      "weight_csw",
      "weight_xfip",
      "edge_tier1_min",
      "edge_tier1_units",
      "edge_tier2_min",
      "edge_tier2_units",
      "edge_tier3_min",
      "edge_tier3_units",
      "unconfirmed_lineup_penalty"
    ];

    const updates: Partial<ModelConfig> = {};
    for (const field of allowedFields) {
      if (field in body && body[field] !== undefined) {
        (updates as Record<string, unknown>)[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Validate weights sum to 1.0
    const weightFields = ["weight_last3", "weight_season", "weight_csw", "weight_xfip"] as const;
    const hasAllWeights = weightFields.every((w) => w in updates);
    if (hasAllWeights) {
      const sum = weightFields.reduce((acc, w) => acc + (Number(updates[w]) || 0), 0);
      if (Math.abs(sum - 1.0) > 0.001) {
        return NextResponse.json(
          { error: `Model weights must sum to 1.0 (got ${sum.toFixed(3)})` },
          { status: 400 }
        );
      }
    }

    updates.updated_at = new Date().toISOString() as unknown as string;

    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("model_config")
      .update(updates)
      .eq("id", 1)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: data as ModelConfig });
  } catch (err) {
    console.error("[config] PUT exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
