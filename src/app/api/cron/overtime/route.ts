import { NextResponse } from "next/server";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { createOverdueTaskAlerts } from "@/lib/taskEscalations";
import type { UserRole } from "@/lib/roles";

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("Overtime endpoint rejected because CRON_SECRET is not configured.");
    return NextResponse.json({ error: "Overtime scheduling is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: administrator, error } = await supabase.from("users")
    .select("id, role")
    .eq("role", "super_admin")
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Unable to resolve an administrator for overtime processing:", error.message);
    return NextResponse.json({ error: "Unable to initialize overtime processing." }, { status: 500 });
  }
  if (!administrator) {
    return NextResponse.json({ error: "No active platform administrator is available for overtime processing." }, { status: 503 });
  }

  try {
    await createOverdueTaskAlerts(administrator.id, administrator.role as UserRole);
    return NextResponse.json({ processed: true });
  } catch (error) {
    console.error("Overtime alert processing failed:", error);
    return NextResponse.json({ error: "Unable to process overtime alerts." }, { status: 500 });
  }
}
