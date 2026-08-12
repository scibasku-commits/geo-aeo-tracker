-- Relational history for the Scibasku AEO pilot.
-- The existing kv_store remains available for optional browser-state sync;
-- measurement history lives here so prompt versions and failed attempts are
-- never overwritten by later runs.

create table if not exists public.aeo_projects (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  brand_name            text not null,
  brand_aliases         text[] not null default '{}',
  brand_domains         text[] not null default '{}',
  competitors           jsonb not null default '[]'::jsonb,
  enabled               boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint aeo_projects_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint aeo_projects_competitors_array check (jsonb_typeof(competitors) = 'array')
);

create table if not exists public.aeo_prompts (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.aeo_projects(id) on delete cascade,
  stable_key            text not null,
  market                text not null,
  enabled               boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (project_id, stable_key),
  constraint aeo_prompts_market check (market in ('ES', 'IT')),
  constraint aeo_prompts_stable_key_format check (stable_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.aeo_prompt_versions (
  id                    uuid primary key default gen_random_uuid(),
  prompt_id             uuid not null references public.aeo_prompts(id) on delete cascade,
  version               integer not null check (version > 0),
  text                  text not null check (char_length(text) between 3 and 2000),
  intent                text not null default 'mixed',
  activated_at          timestamptz not null default now(),
  retired_at            timestamptz,
  created_at            timestamptz not null default now(),
  unique (prompt_id, version),
  constraint aeo_prompt_versions_intent check (intent in ('commercial', 'informational', 'mixed')),
  constraint aeo_prompt_versions_dates check (retired_at is null or retired_at >= activated_at)
);

create unique index if not exists aeo_prompt_versions_one_active_idx
  on public.aeo_prompt_versions (prompt_id)
  where retired_at is null;

create table if not exists public.aeo_batches (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.aeo_projects(id) on delete cascade,
  trigger_kind          text not null,
  status                text not null default 'running',
  total_attempts        integer not null default 0 check (total_attempts >= 0),
  success_count         integer not null default 0 check (success_count >= 0),
  error_count           integer not null default 0 check (error_count >= 0),
  timeout_count         integer not null default 0 check (timeout_count >= 0),
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  constraint aeo_batches_trigger_kind check (trigger_kind in ('manual', 'cron', 'test')),
  constraint aeo_batches_status check (status in ('running', 'completed', 'partial', 'failed')),
  constraint aeo_batches_dates check (completed_at is null or completed_at >= started_at)
);

create table if not exists public.aeo_responses (
  id                    uuid primary key default gen_random_uuid(),
  batch_id              uuid not null references public.aeo_batches(id) on delete cascade,
  prompt_version_id     uuid not null references public.aeo_prompt_versions(id) on delete restrict,
  provider              text not null,
  market                text not null,
  status                text not null,
  answer                text,
  raw_response          jsonb,
  snapshot_id           text,
  cached                boolean not null default false,
  latency_ms            integer check (latency_ms is null or latency_ms >= 0),
  visibility_score      integer check (visibility_score between 0 and 100),
  sentiment             text,
  brand_mentioned       boolean not null default false,
  influenced            boolean not null default false,
  error_code            text,
  error_message         text,
  completed_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (batch_id, prompt_version_id, provider),
  constraint aeo_responses_provider check (provider in ('chatgpt', 'perplexity', 'copilot', 'gemini', 'google_ai')),
  constraint aeo_responses_market check (market in ('ES', 'IT')),
  constraint aeo_responses_status check (status in ('success', 'error', 'timeout')),
  constraint aeo_responses_sentiment check (sentiment is null or sentiment in ('positive', 'neutral', 'negative', 'not-mentioned')),
  constraint aeo_responses_success_payload check (
    (status = 'success' and answer is not null and visibility_score is not null and sentiment is not null and error_message is null)
    or
    (status <> 'success' and answer is null and visibility_score is null and sentiment is null and error_message is not null)
  )
);

create table if not exists public.aeo_citations (
  id                    bigint generated always as identity primary key,
  response_id           uuid not null references public.aeo_responses(id) on delete cascade,
  url                   text not null,
  domain                text not null,
  position              integer not null check (position > 0),
  is_brand_domain       boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (response_id, url)
);

create table if not exists public.aeo_mentions (
  id                    bigint generated always as identity primary key,
  response_id           uuid not null references public.aeo_responses(id) on delete cascade,
  kind                  text not null,
  entity                text not null,
  matched_alias         text not null,
  mention_count         integer not null check (mention_count > 0),
  first_position        integer not null check (first_position >= 0),
  detection_method      text not null default 'configured',
  confidence_score      numeric(3,2) not null default 1.00 check (confidence_score between 0 and 1),
  created_at            timestamptz not null default now(),
  unique (response_id, kind, entity),
  constraint aeo_mentions_kind check (kind in ('brand', 'competitor', 'candidate')),
  constraint aeo_mentions_detection_method check (detection_method in ('configured', 'heuristic'))
);

create index if not exists aeo_prompts_project_enabled_idx
  on public.aeo_prompts (project_id, enabled, market);
create index if not exists aeo_batches_project_started_idx
  on public.aeo_batches (project_id, started_at desc);
create index if not exists aeo_responses_prompt_provider_created_idx
  on public.aeo_responses (prompt_version_id, provider, created_at desc);
create index if not exists aeo_responses_status_created_idx
  on public.aeo_responses (status, created_at desc);
create index if not exists aeo_citations_domain_idx
  on public.aeo_citations (domain, created_at desc);
create index if not exists aeo_mentions_entity_idx
  on public.aeo_mentions (kind, entity, created_at desc);

create or replace function public.aeo_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists aeo_projects_touch_updated_at on public.aeo_projects;
create trigger aeo_projects_touch_updated_at
  before update on public.aeo_projects
  for each row execute function public.aeo_touch_updated_at();

drop trigger if exists aeo_prompts_touch_updated_at on public.aeo_prompts;
create trigger aeo_prompts_touch_updated_at
  before update on public.aeo_prompts
  for each row execute function public.aeo_touch_updated_at();

create or replace function public.aeo_record_response(
  p_batch_id uuid,
  p_prompt_version_id uuid,
  p_provider text,
  p_market text,
  p_status text,
  p_answer text,
  p_raw_response jsonb,
  p_snapshot_id text,
  p_cached boolean,
  p_latency_ms integer,
  p_visibility_score integer,
  p_sentiment text,
  p_brand_mentioned boolean,
  p_influenced boolean,
  p_error_code text,
  p_error_message text,
  p_citations jsonb,
  p_mentions jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  response_id uuid;
begin
  insert into public.aeo_responses (
    batch_id,
    prompt_version_id,
    provider,
    market,
    status,
    answer,
    raw_response,
    snapshot_id,
    cached,
    latency_ms,
    visibility_score,
    sentiment,
    brand_mentioned,
    influenced,
    error_code,
    error_message
  ) values (
    p_batch_id,
    p_prompt_version_id,
    p_provider,
    p_market,
    p_status,
    p_answer,
    p_raw_response,
    p_snapshot_id,
    coalesce(p_cached, false),
    p_latency_ms,
    p_visibility_score,
    p_sentiment,
    coalesce(p_brand_mentioned, false),
    coalesce(p_influenced, false),
    p_error_code,
    p_error_message
  )
  returning id into response_id;

  insert into public.aeo_citations (
    response_id,
    url,
    domain,
    position,
    is_brand_domain
  )
  select
    response_id,
    citation.url,
    lower(citation.domain),
    citation.position,
    coalesce(citation.is_brand_domain, false)
  from jsonb_to_recordset(coalesce(p_citations, '[]'::jsonb)) as citation(
    url text,
    domain text,
    position integer,
    is_brand_domain boolean
  );

  insert into public.aeo_mentions (
    response_id,
    kind,
    entity,
    matched_alias,
    mention_count,
    first_position,
    detection_method,
    confidence_score
  )
  select
    response_id,
    mention.kind,
    mention.entity,
    mention.matched_alias,
    mention.mention_count,
    mention.first_position,
    mention.detection_method,
    mention.confidence_score
  from jsonb_to_recordset(coalesce(p_mentions, '[]'::jsonb)) as mention(
    kind text,
    entity text,
    matched_alias text,
    mention_count integer,
    first_position integer,
    detection_method text,
    confidence_score numeric
  );

  return response_id;
end;
$$;

create or replace view public.aeo_daily_metrics
with (security_invoker = true)
as
select
  batch.project_id,
  response.completed_at::date as measured_on,
  response.market,
  response.provider,
  count(*) as attempts,
  count(*) filter (where response.status = 'success') as successful_responses,
  count(*) filter (where response.status = 'error') as errors,
  count(*) filter (where response.status = 'timeout') as timeouts,
  count(*) filter (where response.status = 'success' and response.brand_mentioned) as visible_responses,
  count(*) filter (where response.status = 'success' and response.influenced) as influenced_responses,
  round(
    100.0 * count(*) filter (where response.status = 'success' and response.brand_mentioned)
    / nullif(count(*) filter (where response.status = 'success'), 0),
    2
  ) as visibility_percent,
  round(
    100.0 * count(*) filter (where response.status = 'success' and response.influenced)
    / nullif(count(*) filter (where response.status = 'success'), 0),
    2
  ) as influence_percent,
  round(
    100.0 * sum(coalesce(mention.brand_count, 0))
    / nullif(sum(coalesce(mention.total_count, 0)), 0),
    2
  ) as share_of_voice_percent
from public.aeo_responses as response
join public.aeo_batches as batch on batch.id = response.batch_id
left join lateral (
  select
    sum(item.mention_count) filter (where item.kind = 'brand') as brand_count,
    sum(item.mention_count) as total_count
  from public.aeo_mentions as item
  where item.response_id = response.id
    and item.kind in ('brand', 'competitor')
) as mention on true
group by batch.project_id, response.completed_at::date, response.market, response.provider;

create or replace view public.aeo_response_feed
with (security_invoker = true)
as
select
  response.id,
  batch.project_id,
  batch.id as batch_id,
  prompt.stable_key,
  prompt.market,
  version.version as prompt_version,
  version.text as prompt_text,
  response.provider,
  response.status,
  response.answer,
  response.visibility_score,
  response.sentiment,
  response.brand_mentioned,
  response.influenced,
  response.error_code,
  response.error_message,
  response.latency_ms,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'url', citation.url,
        'domain', citation.domain,
        'position', citation.position,
        'is_brand_domain', citation.is_brand_domain
      ) order by citation.position
    )
    from public.aeo_citations as citation
    where citation.response_id = response.id
  ), '[]'::jsonb) as citations,
  response.completed_at
from public.aeo_responses as response
join public.aeo_batches as batch on batch.id = response.batch_id
join public.aeo_prompt_versions as version on version.id = response.prompt_version_id
join public.aeo_prompts as prompt on prompt.id = version.prompt_id;

create or replace view public.aeo_competitor_candidates
with (security_invoker = true)
as
select
  batch.project_id,
  mention.entity,
  max(mention.confidence_score) as confidence_score,
  count(distinct response.id) as response_count,
  sum(mention.mention_count) as total_mentions,
  min(response.completed_at) as first_seen_at,
  max(response.completed_at) as last_seen_at
from public.aeo_mentions as mention
join public.aeo_responses as response on response.id = mention.response_id
join public.aeo_batches as batch on batch.id = response.batch_id
where mention.kind = 'candidate'
group by batch.project_id, mention.entity;

alter table public.aeo_projects enable row level security;
alter table public.aeo_prompts enable row level security;
alter table public.aeo_prompt_versions enable row level security;
alter table public.aeo_batches enable row level security;
alter table public.aeo_responses enable row level security;
alter table public.aeo_citations enable row level security;
alter table public.aeo_mentions enable row level security;

-- No anon/authenticated policies are defined. The application accesses this
-- data only from server routes with the service-role key.
revoke all on function public.aeo_record_response(
  uuid, uuid, text, text, text, text, jsonb, text, boolean, integer,
  integer, text, boolean, boolean, text, text, jsonb, jsonb
) from public;

do $$
begin
  -- Hosted Supabase projects grant function execution to API roles through
  -- default privileges. PUBLIC revocation alone does not remove those grants,
  -- while local PostgreSQL-compatible test engines may not define the roles.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.aeo_record_response(
      uuid, uuid, text, text, text, text, jsonb, text, boolean, integer,
      integer, text, boolean, boolean, text, text, jsonb, jsonb
    ) from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.aeo_record_response(
      uuid, uuid, text, text, text, text, jsonb, text, boolean, integer,
      integer, text, boolean, boolean, text, text, jsonb, jsonb
    ) from authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.aeo_record_response(
      uuid, uuid, text, text, text, text, jsonb, text, boolean, integer,
      integer, text, boolean, boolean, text, text, jsonb, jsonb
    ) to service_role;
  end if;
end;
$$;

insert into public.aeo_projects (
  id,
  slug,
  name,
  brand_name,
  brand_aliases,
  brand_domains
) values (
  '00000000-0000-4000-8000-000000000001',
  'scibasku-ski',
  'Scibasku Ski AEO Pilot',
  'Viajes Scibasku',
  array['Scibasku'],
  array['viajesscibasku.com', 'ilovecanada.travel', 'viajesdeski.es']
)
on conflict (slug) do nothing;

insert into public.aeo_prompts (id, project_id, stable_key, market)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'es-agencias-canada', 'ES'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'es-whistler', 'ES'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'es-heliesqui-canada', 'ES'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'it-agenzie-canada', 'IT'),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'it-whistler', 'IT'),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', 'it-eliski-canada', 'IT')
on conflict (project_id, stable_key) do nothing;

insert into public.aeo_prompt_versions (id, prompt_id, version, text, intent)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, 'Agencias españolas para viajar a esquiar a Canadá', 'commercial'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1, 'Esquiar en Whistler: cómo organizar el viaje desde España', 'informational'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 1, 'Heliesquí en Canadá: operadores y cómo reservarlo', 'commercial'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 1, 'Agenzie per viaggi sci in Canada dall''Italia', 'commercial'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', 1, 'Sciare a Whistler: come organizzare il viaggio', 'informational'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', 1, 'Eliski in Canada: operatori e prenotazione', 'commercial')
on conflict (prompt_id, version) do nothing;
