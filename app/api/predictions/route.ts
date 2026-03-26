import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { toDateString } from "@/lib/utils";

// ============================================================
// GET /api/predictions?date=YYYY-MM-DD
// ============================================================
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") ?? toDateString(new Date());

    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("predictions")
      .select("*")
      .eq("game_date", date)
      .order("edge_pct", { ascending: false });

    if (error) {
      console.error("[predictions] GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ predictions: data ?? [], date });
  } catch (err) {
    console.error("[predictions] GET exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ============================================================
// PATCH /api/predictions — update user bet info
// ============================================================
interface PatchBody {
  id: string;
  user_bet_placed?: boolean;
  user_bet_side?: string;
  user_bet_units?: number;
  user_bet_book?: string;
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as PatchBody;
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing prediction id" }, { status: 400 });
    }

    // Only allow bet-related fields to be patched
    const allowedFields = [
      "user_bet_placed",
      "user_bet_side",
      "user_bet_units",
      "user_bet_book"
    ];
    const safeUpdates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in updates) {
        safeUpdates[field] = (updates as Record<string, unknown>)[field];
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("predictions")
      .update(safeUpdates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[predictions] PATCH error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ prediction: data });
  } catch (err) {
    console.error("[predictions] PATCH exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
