import { NextRequest, NextResponse } from "next/server";
import {
  getPilotSecret,
  isPilotRequestAuthorized,
} from "@/lib/server/pilot-auth";
import { loadPilotDashboard } from "@/lib/server/pilot-repository";
import { isCloudStorageConfigured } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!getPilotSecret()) {
    return NextResponse.json(
      { error: "PILOT_RUN_SECRET or CRON_SECRET is not configured." },
      { status: 503 },
    );
  }
  if (!isPilotRequestAuthorized(req.headers)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isCloudStorageConfigured()) {
    return NextResponse.json(
      { error: "Supabase persistence is not configured." },
      { status: 503 },
    );
  }

  try {
    const data = await loadPilotDashboard();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Could not load pilot results.", detail: message.slice(0, 1000) },
      { status: 500 },
    );
  }
}
