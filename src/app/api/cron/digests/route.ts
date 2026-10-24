import { NextResponse } from "next/server";
import { dispatchRoleScopedDigests } from "@/lib/digests";

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("Digest endpoint rejected because CRON_SECRET is not configured.");
    return NextResponse.json({ error: "Digest scheduling is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cadence = new URL(request.url).searchParams.get("cadence");
  if (cadence !== "weekly" && cadence !== "monthly") {
    return NextResponse.json({ error: "Choose weekly or monthly cadence." }, { status: 400 });
  }

  try {
    const result = await dispatchRoleScopedDigests(cadence);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to dispatch email digests.";
    console.error("Digest dispatch failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
