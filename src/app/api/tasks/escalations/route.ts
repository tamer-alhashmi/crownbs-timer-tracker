import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createOverdueTaskAlerts } from "@/lib/taskEscalations";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    await createOverdueTaskAlerts(session.userId, session.role);
    return NextResponse.json({ processed: true });
  } catch (error) {
    console.error("[Task Escalation]: Scheduled check failed.", error);
    return NextResponse.json({ error: "Unable to check overdue tasks right now." }, { status: 500 });
  }
}
