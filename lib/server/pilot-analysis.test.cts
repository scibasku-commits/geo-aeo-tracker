const assert = require("node:assert/strict");
const test = require("node:test");
const { analyzePilotResponse } = require("./pilot-analysis.ts");

const baseInput = {
  brandName: "Viajes Scibasku",
  brandAliases: ["Scibasku"],
  brandDomains: ["viajesscibasku.com", "ilovecanada.travel"],
  competitors: [
    { name: "Rival Ski", aliases: ["Rival"] },
    { name: "Alpine House" },
  ],
};

test("separates brand visibility from source influence", () => {
  const result = analyzePilotResponse({
    ...baseInput,
    answer: "Rival Ski is recommended. Viajes Scibasku is also recommended.",
    sourceUrls: [
      "https://www.ilovecanada.travel/esqui#section",
      "https://example.com/article",
    ],
  });

  assert.equal(result.brandMentioned, true);
  assert.equal(result.influenced, true);
  assert.equal(result.brandMentions[0].mentionCount, 1);
  assert.equal(result.competitorMentions[0].entity, "Rival Ski");
  assert.equal(result.citations[0].domain, "ilovecanada.travel");
  assert.equal(result.citations[0].isBrandDomain, true);
  assert.ok(result.visibilityScore > 0);
});

test("does not double count an alias contained inside the full brand name", () => {
  const result = analyzePilotResponse({
    ...baseInput,
    answer: "Viajes Scibasku prepara viajes. Scibasku también asesora.",
    sourceUrls: [],
  });

  assert.equal(result.brandMentions[0].mentionCount, 2);
});

test("keeps a citation-only answer at zero visibility", () => {
  const result = analyzePilotResponse({
    ...baseInput,
    answer: "Estas son algunas opciones disponibles.",
    sourceUrls: ["https://viajesscibasku.com/canada"],
  });

  assert.equal(result.brandMentioned, false);
  assert.equal(result.influenced, true);
  assert.equal(result.visibilityScore, 0);
  assert.equal(result.sentiment, "not-mentioned");
});

test("deduplicates normalized citation URLs and drops malformed values", () => {
  const result = analyzePilotResponse({
    ...baseInput,
    answer: "Sin menciones.",
    sourceUrls: [
      "https://example.com/page#one",
      "https://example.com/page#two",
      "not a url",
    ],
  });

  assert.deepEqual(result.citations.map((citation) => citation.url), [
    "https://example.com/page",
  ]);
});

test("captures structured brand names as reviewable competitor candidates", () => {
  const result = analyzePilotResponse({
    ...baseInput,
    answer:
      "1. **Snow Travel Spain** — Viajes a Canadá\n2. [Maple Ski Co](https://mapleski.example) — Paquetes a Whistler",
    sourceUrls: [],
  });

  assert.deepEqual(
    result.competitorCandidates.map((candidate) => candidate.entity),
    ["Snow Travel Spain", "Maple Ski Co"],
  );
  assert.equal(result.competitorCandidates[0].detectionMethod, "heuristic");
  assert.equal(result.competitorCandidates[1].confidenceScore, 0.85);
});
