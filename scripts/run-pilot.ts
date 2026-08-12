import { executePilotBatch } from "../lib/server/pilot-runner";

const required = [
  "BRIGHT_DATA_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
async function main() {
  const missing = required.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    console.error(`Pilot configuration is incomplete: ${missing.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  try {
    const result = await executePilotBatch({
      triggerKind: process.env.GITHUB_ACTIONS === "true" ? "cron" : "manual",
      concurrency: 6,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.fatalStorageErrors > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unknown pilot error");
    process.exitCode = 1;
  }
}

void main();
