import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "./supabase";
import type {
  PilotCitation,
  PilotCompetitor,
  PilotMention,
} from "./pilot-analysis";

const competitorSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
});

const competitorsSchema = z.array(competitorSchema);

export type PilotProject = {
  id: string;
  slug: string;
  name: string;
  brandName: string;
  brandAliases: string[];
  brandDomains: string[];
  competitors: PilotCompetitor[];
};

export type PilotPromptVersion = {
  id: string;
  promptId: string;
  stableKey: string;
  market: "ES" | "IT";
  version: number;
  text: string;
  intent: "commercial" | "informational" | "mixed";
};

export type PilotDefinition = {
  project: PilotProject;
  prompts: PilotPromptVersion[];
};

export type PersistedPilotAttempt = {
  batchId: string;
  promptVersionId: string;
  provider: "chatgpt" | "perplexity" | "google_ai";
  market: "ES" | "IT";
  status: "success" | "error" | "timeout";
  answer: string | null;
  rawResponse: unknown;
  snapshotId: string | null;
  cached: boolean;
  latencyMs: number;
  visibilityScore: number | null;
  sentiment: "positive" | "neutral" | "negative" | "not-mentioned" | null;
  brandMentioned: boolean;
  influenced: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  citations: PilotCitation[];
  mentions: PilotMention[];
};

function requireSupabase(): SupabaseClient {
  const client = getServerSupabase();
  if (!client) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return client;
}

export async function loadPilotDefinition(
  slug = "scibasku-ski",
): Promise<PilotDefinition> {
  const supabase = requireSupabase();
  const { data: projectRow, error: projectError } = await supabase
    .from("aeo_projects")
    .select(
      "id, slug, name, brand_name, brand_aliases, brand_domains, competitors",
    )
    .eq("slug", slug)
    .eq("enabled", true)
    .single();

  if (projectError || !projectRow) {
    throw new Error(
      `Pilot project '${slug}' is unavailable: ${projectError?.message ?? "not found"}`,
    );
  }

  const { data: promptRows, error: promptError } = await supabase
    .from("aeo_prompts")
    .select("id, stable_key, market")
    .eq("project_id", projectRow.id)
    .eq("enabled", true)
    .order("market")
    .order("stable_key");

  if (promptError) {
    throw new Error(`Could not load pilot prompts: ${promptError.message}`);
  }

  const promptIds = (promptRows ?? []).map((row) => row.id as string);
  if (promptIds.length === 0) {
    throw new Error(`Pilot project '${slug}' has no enabled prompts.`);
  }

  const { data: versionRows, error: versionError } = await supabase
    .from("aeo_prompt_versions")
    .select("id, prompt_id, version, text, intent")
    .in("prompt_id", promptIds)
    .is("retired_at", null);

  if (versionError) {
    throw new Error(
      `Could not load active prompt versions: ${versionError.message}`,
    );
  }

  const versionByPrompt = new Map(
    (versionRows ?? []).map((row) => [row.prompt_id as string, row]),
  );

  const prompts = (promptRows ?? []).map((row) => {
    const version = versionByPrompt.get(row.id as string);
    if (!version) {
      throw new Error(`Prompt '${row.stable_key}' has no active version.`);
    }

    return {
      id: version.id as string,
      promptId: row.id as string,
      stableKey: row.stable_key as string,
      market: row.market as "ES" | "IT",
      version: version.version as number,
      text: version.text as string,
      intent: version.intent as PilotPromptVersion["intent"],
    };
  });

  const competitors = competitorsSchema.parse(projectRow.competitors ?? []);

  return {
    project: {
      id: projectRow.id as string,
      slug: projectRow.slug as string,
      name: projectRow.name as string,
      brandName: projectRow.brand_name as string,
      brandAliases: (projectRow.brand_aliases ?? []) as string[],
      brandDomains: (projectRow.brand_domains ?? []) as string[],
      competitors,
    },
    prompts,
  };
}

export async function createPilotBatch(input: {
  projectId: string;
  triggerKind: "manual" | "cron" | "test";
  totalAttempts: number;
}): Promise<string> {
  const supabase = requireSupabase();
  const staleBefore = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { error: staleError } = await supabase
    .from("aeo_batches")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
    })
    .eq("project_id", input.projectId)
    .eq("status", "running")
    .lt("started_at", staleBefore);
  if (staleError) {
    throw new Error(`Could not close stale pilot batches: ${staleError.message}`);
  }

  const { data, error } = await supabase
    .from("aeo_batches")
    .insert({
      project_id: input.projectId,
      trigger_kind: input.triggerKind,
      total_attempts: input.totalAttempts,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Could not create pilot batch: ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

export async function recordPilotAttempt(
  attempt: PersistedPilotAttempt,
): Promise<string> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc("aeo_record_response", {
    p_batch_id: attempt.batchId,
    p_prompt_version_id: attempt.promptVersionId,
    p_provider: attempt.provider,
    p_market: attempt.market,
    p_status: attempt.status,
    p_answer: attempt.answer,
    p_raw_response: attempt.rawResponse ?? null,
    p_snapshot_id: attempt.snapshotId,
    p_cached: attempt.cached,
    p_latency_ms: attempt.latencyMs,
    p_visibility_score: attempt.visibilityScore,
    p_sentiment: attempt.sentiment,
    p_brand_mentioned: attempt.brandMentioned,
    p_influenced: attempt.influenced,
    p_error_code: attempt.errorCode,
    p_error_message: attempt.errorMessage,
    p_citations: attempt.citations.map((citation) => ({
      url: citation.url,
      domain: citation.domain,
      position: citation.position,
      is_brand_domain: citation.isBrandDomain,
    })),
    p_mentions: attempt.mentions.map((mention) => ({
      kind: mention.kind,
      entity: mention.entity,
      matched_alias: mention.matchedAlias,
      mention_count: mention.mentionCount,
      first_position: mention.firstPosition,
      detection_method: mention.detectionMethod,
      confidence_score: mention.confidenceScore,
    })),
  });

  if (error || !data) {
    throw new Error(
      `Could not persist pilot response: ${error?.message ?? "no response id"}`,
    );
  }
  return data as string;
}

export async function completePilotBatch(input: {
  batchId: string;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  fatalStorageErrors: number;
}): Promise<void> {
  const supabase = requireSupabase();
  const failedCount =
    input.errorCount + input.timeoutCount + input.fatalStorageErrors;
  const status =
    input.successCount === 0
      ? "failed"
      : failedCount > 0
        ? "partial"
        : "completed";

  const { error } = await supabase
    .from("aeo_batches")
    .update({
      status,
      success_count: input.successCount,
      error_count: input.errorCount + input.fatalStorageErrors,
      timeout_count: input.timeoutCount,
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.batchId);

  if (error) {
    throw new Error(`Could not complete pilot batch: ${error.message}`);
  }
}

export async function loadPilotDashboard(slug = "scibasku-ski") {
  const supabase = requireSupabase();
  const definition = await loadPilotDefinition(slug);

  const [batchesResult, metricsResult, responsesResult, candidatesResult] =
    await Promise.all([
      supabase
        .from("aeo_batches")
        .select(
          "id, status, trigger_kind, total_attempts, success_count, error_count, timeout_count, started_at, completed_at",
        )
        .eq("project_id", definition.project.id)
        .order("started_at", { ascending: false })
        .limit(14),
      supabase
        .from("aeo_daily_metrics")
        .select("*")
        .eq("project_id", definition.project.id)
        .order("measured_on", { ascending: false })
        .limit(60),
      supabase
        .from("aeo_response_feed")
        .select("*")
        .eq("project_id", definition.project.id)
        .order("completed_at", { ascending: false })
        .limit(100),
      supabase
        .from("aeo_competitor_candidates")
        .select("*")
        .eq("project_id", definition.project.id)
        .order("response_count", { ascending: false })
        .limit(30),
    ]);

  const error =
    batchesResult.error ??
    metricsResult.error ??
    responsesResult.error ??
    candidatesResult.error;
  if (error) {
    throw new Error(`Could not load pilot dashboard: ${error.message}`);
  }

  return {
    definition,
    batches: batchesResult.data ?? [],
    metrics: metricsResult.data ?? [],
    responses: responsesResult.data ?? [],
    candidates: candidatesResult.data ?? [],
  };
}
