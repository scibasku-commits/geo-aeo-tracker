import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();

try {
  for (const filename of [
    "supabase/migrations/001_kv_store.sql",
    "supabase/migrations/002_aeo_pilot.sql",
  ]) {
    const sql = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
    await db.exec(sql);
  }

  const seeded = await db.query(`
    select p.market, count(*)::int as prompt_count
    from public.aeo_prompts p
    join public.aeo_prompt_versions v on v.prompt_id = p.id
    where p.enabled and v.retired_at is null
    group by p.market
    order by p.market
  `);
  assert.deepEqual(seeded.rows, [
    { market: "ES", prompt_count: 3 },
    { market: "IT", prompt_count: 3 },
  ]);

  const batch = await db.query(`
    insert into public.aeo_batches (
      project_id, trigger_kind, total_attempts
    ) values (
      '00000000-0000-4000-8000-000000000001', 'test', 2
    ) returning id
  `);
  const batchId = batch.rows[0].id;

  await db.query(
    `select public.aeo_record_response(
      $1,
      '20000000-0000-4000-8000-000000000001',
      'chatgpt',
      'ES',
      'success',
      'Viajes Scibasku aparece recomendado.',
      '{"answer":"raw evidence"}'::jsonb,
      'snapshot-test',
      false,
      1250,
      70,
      'positive',
      true,
      true,
      null,
      null,
      '[{"url":"https://ilovecanada.travel/esqui","domain":"ilovecanada.travel","position":1,"is_brand_domain":true}]'::jsonb,
      '[{"kind":"brand","entity":"Viajes Scibasku","matched_alias":"Viajes Scibasku","mention_count":1,"first_position":0,"detection_method":"configured","confidence_score":1},{"kind":"candidate","entity":"Maple Ski Co","matched_alias":"Maple Ski Co","mention_count":1,"first_position":40,"detection_method":"heuristic","confidence_score":0.85}]'::jsonb
    )`,
    [batchId],
  );

  await db.query(
    `select public.aeo_record_response(
      $1,
      '20000000-0000-4000-8000-000000000002',
      'perplexity',
      'ES',
      'timeout',
      null,
      null,
      null,
      false,
      90000,
      null,
      null,
      false,
      false,
      'provider_timeout',
      'Timed out waiting for snapshot',
      '[]'::jsonb,
      '[]'::jsonb
    )`,
    [batchId],
  );

  const metrics = await db.query(`
    select successful_responses::int,
           timeouts::int,
           visibility_percent::text,
           influence_percent::text,
           share_of_voice_percent::text
    from public.aeo_daily_metrics
    where project_id = '00000000-0000-4000-8000-000000000001'
      and market = 'ES'
      and provider = 'chatgpt'
  `);
  assert.deepEqual(metrics.rows, [
    {
      successful_responses: 1,
      timeouts: 0,
      visibility_percent: "100.00",
      influence_percent: "100.00",
      share_of_voice_percent: "100.00",
    },
  ]);

  const timeoutMetrics = await db.query(`
    select successful_responses::int,
           timeouts::int,
           visibility_percent
    from public.aeo_daily_metrics
    where project_id = '00000000-0000-4000-8000-000000000001'
      and market = 'ES'
      and provider = 'perplexity'
  `);
  assert.equal(timeoutMetrics.rows[0].successful_responses, 0);
  assert.equal(timeoutMetrics.rows[0].timeouts, 1);
  assert.equal(timeoutMetrics.rows[0].visibility_percent, null);

  const evidence = await db.query(`
    select
      (select count(*)::int from public.aeo_responses) as responses,
      (select count(*)::int from public.aeo_citations) as citations,
      (select count(*)::int from public.aeo_mentions) as mentions
  `);
  assert.deepEqual(evidence.rows, [
    { responses: 2, citations: 1, mentions: 2 },
  ]);

  const candidates = await db.query(`
    select entity, confidence_score::text, response_count::int
    from public.aeo_competitor_candidates
  `);
  assert.deepEqual(candidates.rows, [
    {
      entity: "Maple Ski Co",
      confidence_score: "0.85",
      response_count: 1,
    },
  ]);

  const feed = await db.query(`
    select jsonb_array_length(citations)::int as citation_count
    from public.aeo_response_feed
    where status = 'success'
  `);
  assert.deepEqual(feed.rows, [{ citation_count: 1 }]);

  console.log(
    "Pilot migration OK: 6 versioned prompts; success, timeout, citation, mention and denominator rules verified.",
  );
} finally {
  await db.close();
}
