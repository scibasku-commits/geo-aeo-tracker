import { timingSafeEqual } from "node:crypto";

export function getPilotSecret(): string | null {
  const pilotSecret = process.env.PILOT_RUN_SECRET?.trim();
  if (pilotSecret) return pilotSecret;
  const cronSecret = process.env.CRON_SECRET?.trim();
  return cronSecret || null;
}

function safeEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export function isPilotRequestAuthorized(
  headers: Pick<Headers, "get">,
  expected = getPilotSecret(),
): boolean {
  if (!expected) return false;

  const authorization = headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const provided = bearer || headers.get("x-pilot-secret")?.trim() || "";

  return safeEqual(provided, expected);
}

export function isPilotDashboardAuthConfigured(): boolean {
  return Boolean(
    process.env.PILOT_DASHBOARD_USER?.trim() &&
      process.env.PILOT_DASHBOARD_PASSWORD?.trim(),
  );
}

export function isPilotDashboardAuthorized(
  headers: Pick<Headers, "get">,
  expectedUser = process.env.PILOT_DASHBOARD_USER?.trim() ?? "",
  expectedPassword = process.env.PILOT_DASHBOARD_PASSWORD?.trim() ?? "",
): boolean {
  if (!expectedUser || !expectedPassword) return false;

  const authorization = headers.get("authorization") ?? "";
  if (!authorization.startsWith("Basic ")) return false;

  try {
    const decoded = Buffer.from(
      authorization.slice("Basic ".length),
      "base64",
    ).toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return false;
    const providedUser = decoded.slice(0, separator);
    const providedPassword = decoded.slice(separator + 1);
    return (
      safeEqual(providedUser, expectedUser) &&
      safeEqual(providedPassword, expectedPassword)
    );
  } catch {
    return false;
  }
}
