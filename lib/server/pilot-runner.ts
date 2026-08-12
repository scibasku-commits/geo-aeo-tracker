import { analyzePilotResponse } from "./pilot-analysis";
import {
  completePilotBatch,
  createPilotBatch,
  loadPilotDefinition,
  recordPilotAttempt,
  type PersistedPilotAttempt,
  type PilotPromptVersion,
} from "./pilot-repository";
import { runAiScraper } from "./brightdata-scraper";

export const PILOT_PROVIDERS = [
  "chatgpt",
  "perplexity",
  "google_ai",
] as const;

type PilotProvider = (typeof PILOT_PROVIDERS)[number];

type PilotJob = {
  prompt: PilotPromptVersion;
  provider: PilotProvider;
};

type JobResult = {
  status: PersistedPilotAttempt["status"];
  persisted: boolean;
  persistenceError: string | null;
};

function sanitizeErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const secrets = [
    process.env.BRIGHT_DATA_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.PILOT_RUN_SECRET,
    process.env.CRON_SECRET,
  ].filter((secret): secret is string => Boolean(secret));

  return secrets
    .reduce(
      (current, secret) => current.replaceAll(secret, "[redacted]"),
      rawMessage.replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]"),
    )
    .slice(0, 2000);
}

function classifyError(error: unknown): {
  status: "error" | "timeout";
  code: string;
  message: string;
} {
  const message = sanitizeErrorMessage(error);
  const lower = message.toLocaleLowerCase();

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return { status: "timeout", code: "provider_timeout", message };
  }
  if (lower.includes("missing bright_data_key")) {
    return { status: "error", code: "missing_bright_data_key", message };
  }
  return { status: "error", code: "provider_error", message };
}

async function runJob(input: {
  batchId: string;
  project: Awaited<ReturnType<typeof loadPilotDefinition>>["project"];
  job: PilotJob;
}): Promise<JobResult> {
  const { batchId, project, job } = input;
  const startedAt = Date.now();
  let attempt: PersistedPilotAttempt;

  try {
    const result = await runAiScraper({
      provider: job.provider,
      prompt: job.prompt.text,
      requireSources: true,
      country: job.prompt.market,
    });
    const analysis = analyzePilotResponse({
      answer: result.answer,
      sourceUrls: result.sources,
      brandName: project.brandName,
      brandAliases: project.brandAliases,
      brandDomains: project.brandDomains,
      competitors: project.competitors,
    });

    attempt = {
      batchId,
      promptVersionId: job.prompt.id,
      provider: job.provider,
      market: job.prompt.market,
      status: "success",
      answer: result.answer,
      rawResponse: result.raw,
      snapshotId: result.snapshotId ?? null,
      cached: result.cached,
      latencyMs: Date.now() - startedAt,
      visibilityScore: analysis.visibilityScore,
      sentiment: analysis.sentiment,
      brandMentioned: analysis.brandMentioned,
      influenced: analysis.influenced,
      errorCode: null,
      errorMessage: null,
      citations: analysis.citations,
      mentions: [
        ...analysis.brandMentions,
        ...analysis.competitorMentions,
        ...analysis.competitorCandidates,
      ],
    };
  } catch (error) {
    const classified = classifyError(error);
    attempt = {
      batchId,
      promptVersionId: job.prompt.id,
      provider: job.provider,
      market: job.prompt.market,
      status: classified.status,
      answer: null,
      rawResponse: null,
      snapshotId: null,
      cached: false,
      latencyMs: Date.now() - startedAt,
      visibilityScore: null,
      sentiment: null,
      brandMentioned: false,
      influenced: false,
      errorCode: classified.code,
      errorMessage: classified.message,
      citations: [],
      mentions: [],
    };
  }

  try {
    await recordPilotAttempt(attempt);
    return { status: attempt.status, persisted: true, persistenceError: null };
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return {
      status: attempt.status,
      persisted: false,
      persistenceError: message.slice(0, 1000),
    };
  }
}

async function runWithConcurrency<T>(
  jobs: PilotJob[],
  limit: number,
  worker: (job: PilotJob) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(jobs.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < jobs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(jobs[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, () => consume()),
  );
  return results;
}

export async function executePilotBatch(input?: {
  projectSlug?: string;
  triggerKind?: "manual" | "cron" | "test";
  concurrency?: number;
}) {
  if (!process.env.BRIGHT_DATA_KEY?.trim()) {
    throw new Error("Pilot cannot run until BRIGHT_DATA_KEY is configured.");
  }

  const definition = await loadPilotDefinition(
    input?.projectSlug ?? process.env.PILOT_PROJECT_SLUG ?? "scibasku-ski",
  );
  const jobs = definition.prompts.flatMap((prompt) =>
    PILOT_PROVIDERS.map((provider) => ({ prompt, provider })),
  );
  const batchId = await createPilotBatch({
    projectId: definition.project.id,
    triggerKind: input?.triggerKind ?? "manual",
    totalAttempts: jobs.length,
  });

  const results = await runWithConcurrency(
    jobs,
    Math.max(1, Math.min(input?.concurrency ?? 3, 6)),
    (job) => runJob({ batchId, project: definition.project, job }),
  );
  const persisted = results.filter((result) => result.persisted);
  const successCount = persisted.filter(
    (result) => result.status === "success",
  ).length;
  const timeoutCount = persisted.filter(
    (result) => result.status === "timeout",
  ).length;
  const errorCount = persisted.filter(
    (result) => result.status === "error",
  ).length;
  const fatalStorageErrors = results.length - persisted.length;
  const persistenceErrors = results
    .filter((result) => result.persistenceError)
    .map((result) => result.persistenceError)
    .filter((message): message is string => message !== null);

  await completePilotBatch({
    batchId,
    successCount,
    timeoutCount,
    errorCount,
    fatalStorageErrors,
  });

  return {
    batchId,
    project: definition.project.slug,
    promptCount: definition.prompts.length,
    providerCount: PILOT_PROVIDERS.length,
    totalAttempts: jobs.length,
    successCount,
    errorCount,
    timeoutCount,
    fatalStorageErrors,
    persistenceErrors,
  };
}
