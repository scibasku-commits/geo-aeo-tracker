import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  isPilotDashboardAuthConfigured,
  isPilotDashboardAuthorized,
} from "@/lib/server/pilot-auth";
import { isCloudStorageConfigured } from "@/lib/server/supabase";
import { loadPilotDashboard } from "@/lib/server/pilot-repository";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Piloto AEO de Scibasku",
  description: "Visibilidad e influencia de Scibasku en respuestas de IA.",
};

type Row = Record<string, unknown>;

function formatDate(value: unknown): string {
  if (typeof value !== "string") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(date);
}

function formatPercent(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(parsed)}%`;
}

function statusClasses(status: unknown): string {
  if (status === "success" || status === "completed") {
    return "bg-th-success-soft text-th-success";
  }
  if (status === "running") {
    return "bg-th-accent-soft text-th-text-accent";
  }
  if (status === "partial" || status === "timeout") {
    return "bg-th-warning-soft text-th-warning";
  }
  return "bg-th-danger-soft text-th-danger";
}

function citationsFrom(value: unknown): Array<{
  url: string;
  domain: string;
  is_brand_domain: boolean;
}> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { url: string; domain: string; is_brand_domain: boolean } =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as Row).url === "string" &&
          typeof (item as Row).domain === "string" &&
          typeof (item as Row).is_brand_domain === "boolean",
      ),
  );
}

function SetupState({ message }: { message: string }) {
  return (
    <main lang="es" className="h-screen overflow-y-auto bg-th-bg px-5 py-12 text-th-text sm:px-8">
      <section className="mx-auto max-w-3xl rounded-2xl border border-th-border bg-th-card p-7 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">
          Piloto AEO de Scibasku
        </h1>
        <p className="mt-3 max-w-[68ch] text-base leading-7 text-th-text-secondary">
          {message}
        </p>
        <p className="mt-5 rounded-xl bg-th-inset px-4 py-3 text-sm leading-6 text-th-text-secondary">
          El dashboard no inventa datos de muestra: aparecerá cuando Supabase
          tenga aplicada la migración y exista al menos un lote guardado.
        </p>
      </section>
    </main>
  );
}

export default async function PilotPage() {
  if (
    isPilotDashboardAuthConfigured() &&
    !isPilotDashboardAuthorized(await headers())
  ) {
    notFound();
  }

  if (!isCloudStorageConfigured()) {
    return (
      <SetupState message="La interfaz está lista, pero este entorno aún no tiene conectada la base Supabase del piloto." />
    );
  }

  let dashboard: Awaited<ReturnType<typeof loadPilotDashboard>>;
  try {
    dashboard = await loadPilotDashboard();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return <SetupState message={`No se pudieron leer los resultados: ${message}`} />;
  }

  const batches = dashboard.batches as Row[];
  const metrics = dashboard.metrics as Row[];
  const responses = dashboard.responses as Row[];
  const candidates = dashboard.candidates as Row[];
  const latestBatch = batches[0];
  const latestBatchId = latestBatch?.id;
  const latestResponses = responses.filter(
    (response) => response.batch_id === latestBatchId,
  );
  const latestSuccessful = latestResponses.filter(
    (response) => response.status === "success",
  );
  const latestVisible = latestSuccessful.filter(
    (response) => response.brand_mentioned === true,
  ).length;
  const latestInfluenced = latestSuccessful.filter(
    (response) => response.influenced === true,
  ).length;

  return (
    <main lang="es" className="h-screen overflow-y-auto bg-th-bg px-4 py-8 text-th-text sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 border-b border-th-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Piloto AEO de Scibasku
            </h1>
            <p className="mt-3 max-w-[70ch] text-base leading-7 text-th-text-secondary">
              Seis prompts versionados, España e Italia, medidos en ChatGPT,
              Perplexity y Google AI Mode. Errores y timeouts quedan separados
              del denominador.
            </p>
          </div>
          <Link
            href="/"
            className="w-fit rounded-lg border border-th-border bg-th-card px-4 py-2 text-sm font-medium text-th-text-secondary transition-colors hover:border-th-border-hover hover:bg-th-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-th-accent"
          >
            Abrir tracker completo
          </Link>
        </header>

        {latestBatch ? (
          <section
            aria-labelledby="latest-batch-heading"
            className="mt-8 rounded-2xl border border-th-border bg-th-card p-6 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="latest-batch-heading" className="text-lg font-semibold">
                  Último lote
                </h2>
                <p className="mt-1 text-sm text-th-text-secondary">
                  {formatDate(latestBatch.started_at)} · {String(latestBatch.trigger_kind)}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusClasses(latestBatch.status)}`}
              >
                {String(latestBatch.status)}
              </span>
            </div>

            <dl className="mt-6 grid gap-x-8 gap-y-5 border-t border-th-border-subtle pt-6 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <dt className="text-sm text-th-text-secondary">Respuestas válidas</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {latestSuccessful.length}/{Number(latestBatch.total_attempts)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-th-text-secondary">Visibilidad</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {latestSuccessful.length
                    ? formatPercent((100 * latestVisible) / latestSuccessful.length)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-th-text-secondary">Influencia</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {latestSuccessful.length
                    ? formatPercent((100 * latestInfluenced) / latestSuccessful.length)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-th-text-secondary">Errores</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {Number(latestBatch.error_count)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-th-text-secondary">Timeouts</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {Number(latestBatch.timeout_count)}
                </dd>
              </div>
            </dl>
          </section>
        ) : (
          <section className="mt-8 rounded-2xl border border-th-border bg-th-card p-7 shadow-sm">
            <h2 className="text-lg font-semibold">Todavía no hay mediciones</h2>
            <p className="mt-2 max-w-[68ch] text-base leading-7 text-th-text-secondary">
              El esquema y los seis prompts están listos. El primer lote aparecerá
              aquí cuando el capturador y Supabase tengan sus credenciales.
            </p>
          </section>
        )}

        <section aria-labelledby="coverage-heading" className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="coverage-heading" className="text-xl font-semibold">
                Cobertura diaria
              </h2>
              <p className="mt-1 text-sm text-th-text-secondary">
                Un error de captura no se transforma en una ausencia de marca.
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-th-border bg-th-card shadow-sm">
            <table className="min-w-full border-collapse text-start text-sm">
              <thead className="bg-th-card-alt text-th-text-secondary">
                <tr>
                  {[
                    "Fecha",
                    "Mercado",
                    "Motor",
                    "Válidas",
                    "Errores",
                    "Timeouts",
                    "Visibilidad",
                    "Influencia",
                    "Share of voice",
                  ].map((label) => (
                    <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 text-start font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.length > 0 ? (
                  metrics.map((metric, index) => (
                    <tr key={`${String(metric.measured_on)}-${String(metric.market)}-${String(metric.provider)}-${index}`} className="border-t border-th-border-subtle">
                      <td className="whitespace-nowrap px-4 py-3">{String(metric.measured_on)}</td>
                      <td className="px-4 py-3 font-medium">{String(metric.market)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{String(metric.provider)}</td>
                      <td className="px-4 py-3 tabular-nums">{Number(metric.successful_responses)}</td>
                      <td className="px-4 py-3 tabular-nums">{Number(metric.errors)}</td>
                      <td className="px-4 py-3 tabular-nums">{Number(metric.timeouts)}</td>
                      <td className="px-4 py-3 font-medium tabular-nums">{formatPercent(metric.visibility_percent)}</td>
                      <td className="px-4 py-3 font-medium tabular-nums">{formatPercent(metric.influence_percent)}</td>
                      <td className="px-4 py-3 font-medium tabular-nums">{formatPercent(metric.share_of_voice_percent)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-th-text-secondary">
                      Sin datos diarios todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="responses-heading" className="mt-10 pb-12">
          <h2 id="responses-heading" className="text-xl font-semibold">
            Respuestas recientes
          </h2>
          <p className="mt-1 text-sm text-th-text-secondary">
            Texto, versión del prompt y estado exacto de cada intento.
          </p>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-th-border bg-th-card shadow-sm">
            <table className="min-w-full border-collapse text-start text-sm">
              <thead className="bg-th-card-alt text-th-text-secondary">
                <tr>
                  {[
                    "Momento",
                    "Estado",
                    "Mercado",
                    "Motor",
                    "Prompt",
                    "Versión",
                    "Score",
                  ].map((label) => (
                    <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 text-start font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responses.length > 0 ? (
                  responses.map((response) => {
                    const citations = citationsFrom(response.citations);
                    return (
                    <tr key={String(response.id)} className="border-t border-th-border-subtle align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-th-text-secondary">{formatDate(response.completed_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses(response.status)}`}>
                          {String(response.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{String(response.market)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{String(response.provider)}</td>
                      <td className="min-w-72 max-w-xl px-4 py-3 leading-6 break-words">
                        {String(response.prompt_text)}
                        {response.error_message ? (
                          <span className="mt-1 block text-xs leading-5 text-th-danger">
                            {String(response.error_message)}
                          </span>
                        ) : null}
                        {response.answer ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-medium text-th-text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-th-accent">
                              Ver respuesta y {citations.length} fuente{citations.length === 1 ? "" : "s"}
                            </summary>
                            <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-th-inset p-3 text-xs leading-5 text-th-text-secondary">
                              {String(response.answer)}
                            </p>
                            {citations.length > 0 ? (
                              <ul className="mt-2 space-y-1 text-xs">
                                {citations.map((citation) => (
                                  <li key={citation.url} className="break-all">
                                    <a
                                      href={citation.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-th-text-accent underline decoration-th-border-hover underline-offset-2"
                                    >
                                      {citation.domain}
                                      {citation.is_brand_domain ? " · dominio propio" : ""}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </details>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 tabular-nums">v{Number(response.prompt_version)}</td>
                      <td className="px-4 py-3 font-medium tabular-nums">
                        {response.visibility_score === null ? "—" : Number(response.visibility_score)}
                      </td>
                    </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-th-text-secondary">
                      Sin respuestas guardadas todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="candidates-heading" className="pb-12">
          <h2 id="candidates-heading" className="text-xl font-semibold">
            Competidores por revisar
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm leading-6 text-th-text-secondary">
            Nombres extraídos de listas y enlaces estructurados en las respuestas.
            Son candidatos con confianza visible; no entran en el share of voice
            hasta confirmarlos como marcas.
          </p>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-th-border bg-th-card shadow-sm">
            <table className="min-w-full border-collapse text-start text-sm">
              <thead className="bg-th-card-alt text-th-text-secondary">
                <tr>
                  {[
                    "Candidato",
                    "Confianza",
                    "Respuestas",
                    "Menciones",
                    "Primera vez",
                    "Última vez",
                  ].map((label) => (
                    <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 text-start font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {candidates.length > 0 ? (
                  candidates.map((candidate) => (
                    <tr key={String(candidate.entity)} className="border-t border-th-border-subtle">
                      <td className="px-4 py-3 font-medium">{String(candidate.entity)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatPercent(Number(candidate.confidence_score) * 100)}</td>
                      <td className="px-4 py-3 tabular-nums">{Number(candidate.response_count)}</td>
                      <td className="px-4 py-3 tabular-nums">{Number(candidate.total_mentions)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-th-text-secondary">{formatDate(candidate.first_seen_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-th-text-secondary">{formatDate(candidate.last_seen_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-th-text-secondary">
                      Sin candidatos todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
