import { NextRequest, NextResponse } from "next/server";
import {
  getPilotSecret,
  isPilotRequestAuthorized,
} from "@/lib/server/pilot-auth";
import { executePilotBatch } from "@/lib/server/pilot-runner";
import { isCloudStorageConfigured } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function preflight(req: NextRequest): NextResponse | null {
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
  if (!process.env.BRIGHT_DATA_KEY?.trim()) {
    return NextResponse.json(
      { error: "Bright Data capture is not configured." },
      { status: 503 },
    );
  }
  return null;
}

export async function POST(req: NextRequest) {
  const failedPreflight = preflight(req);
  if (failedPreflight) return failedPreflight;

  try {
    const result = await executePilotBatch({ triggerKind: "manual" });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Pilot batch failed.", detail: message.slice(0, 1000) },
      { status: 500 },
    );
  }
}
