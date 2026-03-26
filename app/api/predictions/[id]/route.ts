import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// ============================================================
// GET /api/predictions/[id]
// Returns a single prediction with all line snapshots
// ============================================================
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    if (!id) {
      return NextResponse.json({ error: "Missing prediction id" }, { status: 400 });
    }

    const supabase = await createServiceClient();

    const [predictionResult, snapshotsResult] = await Promise.all([
      supabase.from("predictions").select("*").eq("id", id).single(),
      supabase
        .from("line_snapshots")
        .select("*")
        .eq("prediction_id", id)
        .order("created_at", { ascending: true })
    ]);

    if (predictionResult.error) {
      if (predictionResult.error.code === "PGRST116") {
        return NextResponse.json({ error: "Prediction not found" }, { status: 404 });
      }
      return NextResponse.json({ error: predictionResult.error.message }, { status: 500 });
    }

    return NextResponse.json({
      prediction: predictionResult.data,
      line_snapshots: snapshotsResult.data ?? []
    });
  } catch (err) {
    console.error("[predictions/id] GET exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
