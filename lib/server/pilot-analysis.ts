export type PilotCompetitor = {
  name: string;
  aliases?: string[];
};

export type PilotCitation = {
  url: string;
  domain: string;
  position: number;
  isBrandDomain: boolean;
};

export type PilotMention = {
  kind: "brand" | "competitor" | "candidate";
  entity: string;
  matchedAlias: string;
  mentionCount: number;
  firstPosition: number;
  detectionMethod: "configured" | "heuristic";
  confidenceScore: number;
};

export type PilotAnalysis = {
  visibilityScore: number;
  sentiment: "positive" | "neutral" | "negative" | "not-mentioned";
  brandMentioned: boolean;
  influenced: boolean;
  brandMentions: PilotMention[];
  competitorMentions: PilotMention[];
  competitorCandidates: PilotMention[];
  citations: PilotCitation[];
};

const POSITIVE_WORDS = [
  "best",
  "excellent",
  "recommend",
  "recommended",
  "trusted",
  "leading",
  "mejor",
  "excelente",
  "recomienda",
  "recomendado",
  "fiable",
  "líder",
  "migliore",
  "eccellente",
  "consiglia",
  "consigliato",
  "affidabile",
  "leader",
];

const NEGATIVE_WORDS = [
  "avoid",
  "poor",
  "overpriced",
  "risky",
  "evitar",
  "malo",
  "caro",
  "arriesgado",
  "evitare",
  "scarso",
  "costoso",
  "rischioso",
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLocaleLowerCase();
  if (!trimmed) return "";

  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    return url.hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "").replace(/\/.*$/, "");
  }
}

function domainMatches(hostname: string, expected: string): boolean {
  return hostname === expected || hostname.endsWith(`.${expected}`);
}

function uniqueAliases(values: string[]): string[] {
  const seen = new Set<string>();

  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalize(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.length - a.length);
}

function analyzeEntity(
  answer: string,
  kind: PilotMention["kind"],
  entity: string,
  aliases: string[],
): PilotMention | null {
  const normalizedAnswer = normalize(answer);
  const occupied: Array<[number, number]> = [];
  const hits: Array<{ alias: string; position: number }> = [];

  for (const alias of uniqueAliases(aliases)) {
    const normalizedAlias = normalize(alias);
    let from = 0;

    while (from < normalizedAnswer.length) {
      const position = normalizedAnswer.indexOf(normalizedAlias, from);
      if (position === -1) break;

      const end = position + normalizedAlias.length;
      const overlaps = occupied.some(
        ([usedStart, usedEnd]) => position < usedEnd && end > usedStart,
      );

      if (!overlaps) {
        occupied.push([position, end]);
        hits.push({ alias, position });
      }

      from = Math.max(end, position + 1);
    }
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => a.position - b.position);

  return {
    kind,
    entity,
    matchedAlias: hits[0].alias,
    mentionCount: hits.length,
    firstPosition: hits[0].position,
    detectionMethod: "configured",
    confidenceScore: 1,
  };
}

function discoverCompetitorCandidates(
  answer: string,
  excludedAliases: string[],
): PilotMention[] {
  const matches: Array<{
    label: string;
    position: number;
    confidence: number;
  }> = [];
  const patterns = [
    { regex: /\[([^\]\n]{2,80})\]\(https?:\/\/[^)]+\)/g, confidence: 0.85 },
    { regex: /\*\*([^*\n]{2,80})\*\*/g, confidence: 0.75 },
    {
      regex:
        /^\s*(?:[-*]|\d+[.)])\s+(?:\*\*)?([^:\n–—-]{2,60})(?:\*\*)?\s*[:–—-]/gm,
      confidence: 0.75,
    },
  ];
  const excluded = uniqueAliases(excludedAliases).map(normalize);

  for (const pattern of patterns) {
    for (const match of answer.matchAll(pattern.regex)) {
      const label = match[1]
        .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const normalizedLabel = normalize(label);
      const words = label.split(/\s+/);
      if (
        label.length < 2 ||
        label.length > 80 ||
        words.length > 8 ||
        /[*\[\]]/.test(label) ||
        /[?!]$/.test(label) ||
        excluded.some(
          (alias) =>
            normalizedLabel === alias ||
            normalizedLabel.includes(alias) ||
            alias.includes(normalizedLabel),
        )
      ) {
        continue;
      }
      matches.push({
        label,
        position: match.index ?? answer.indexOf(match[0]),
        confidence: pattern.confidence,
      });
    }
  }

  const grouped = new Map<
    string,
    { label: string; positions: number[]; confidence: number }
  >();
  for (const match of matches) {
    const key = normalize(match.label);
    const current = grouped.get(key);
    if (current) {
      current.positions.push(match.position);
      current.confidence = Math.max(current.confidence, match.confidence);
    } else {
      grouped.set(key, {
        label: match.label,
        positions: [match.position],
        confidence: match.confidence,
      });
    }
  }

  return [...grouped.values()]
    .map((candidate) => ({
      kind: "candidate" as const,
      entity: candidate.label,
      matchedAlias: candidate.label,
      mentionCount: candidate.positions.length,
      firstPosition: Math.min(...candidate.positions),
      detectionMethod: "heuristic" as const,
      confidenceScore: candidate.confidence,
    }))
    .sort((a, b) => a.firstPosition - b.firstPosition)
    .slice(0, 20);
}

function detectSentiment(
  answer: string,
  brandMentioned: boolean,
): PilotAnalysis["sentiment"] {
  if (!brandMentioned) return "not-mentioned";

  const normalizedAnswer = normalize(answer);
  const positive = POSITIVE_WORDS.filter((word) =>
    normalizedAnswer.includes(normalize(word)),
  ).length;
  const negative = NEGATIVE_WORDS.filter((word) =>
    normalizedAnswer.includes(normalize(word)),
  ).length;

  if (positive > negative + 1) return "positive";
  if (negative > positive + 1) return "negative";
  return "neutral";
}

export function analyzePilotResponse(input: {
  answer: string;
  sourceUrls: string[];
  brandName: string;
  brandAliases: string[];
  brandDomains: string[];
  competitors: PilotCompetitor[];
}): PilotAnalysis {
  const brandAliases = uniqueAliases([input.brandName, ...input.brandAliases]);
  const brandMention = analyzeEntity(
    input.answer,
    "brand",
    input.brandName,
    brandAliases,
  );
  const brandMentions = brandMention ? [brandMention] : [];

  const competitorMentions = input.competitors
    .map((competitor) =>
      analyzeEntity(
        input.answer,
        "competitor",
        competitor.name,
        [competitor.name, ...(competitor.aliases ?? [])],
      ),
    )
    .filter((mention): mention is PilotMention => mention !== null);
  const competitorCandidates = discoverCompetitorCandidates(input.answer, [
    ...brandAliases,
    ...input.competitors.flatMap((competitor) => [
      competitor.name,
      ...(competitor.aliases ?? []),
    ]),
  ]);

  const expectedDomains = input.brandDomains.map(normalizeDomain).filter(Boolean);
  const seenUrls = new Set<string>();
  const citations: PilotCitation[] = [];

  for (const sourceUrl of input.sourceUrls) {
    try {
      const url = new URL(sourceUrl);
      url.hash = "";
      const normalizedUrl = url.toString();
      if (seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);

      const domain = normalizeDomain(url.hostname);
      citations.push({
        url: normalizedUrl,
        domain,
        position: citations.length + 1,
        isBrandDomain: expectedDomains.some((expected) =>
          domainMatches(domain, expected),
        ),
      });
    } catch {
      // The upstream scraper can occasionally return malformed source values.
      // Keep the response usable and omit only the invalid citation.
    }
  }

  const brandMentioned = brandMentions.length > 0;
  const influenced = citations.some((citation) => citation.isBrandDomain);
  const sentiment = detectSentiment(input.answer, brandMentioned);

  let visibilityScore = 0;
  if (brandMention) {
    visibilityScore += 30;
    if (brandMention.firstPosition < 200) visibilityScore += 20;
    if (brandMention.mentionCount >= 3) visibilityScore += 15;
    else if (brandMention.mentionCount >= 2) visibilityScore += 8;
    if (influenced) visibilityScore += 20;
    if (sentiment === "positive") visibilityScore += 15;
    else if (sentiment === "neutral") visibilityScore += 5;
  }

  return {
    visibilityScore: Math.min(100, visibilityScore),
    sentiment,
    brandMentioned,
    influenced,
    brandMentions,
    competitorMentions,
    competitorCandidates,
    citations,
  };
}
