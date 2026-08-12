const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isPilotDashboardAuthorized,
  isPilotRequestAuthorized,
} = require("./pilot-auth.ts");

test("accepts the Vercel cron bearer secret", () => {
  const headers = new Headers({ authorization: "Bearer correct-secret" });
  assert.equal(isPilotRequestAuthorized(headers, "correct-secret"), true);
});

test("accepts the manual pilot header", () => {
  const headers = new Headers({ "x-pilot-secret": "correct-secret" });
  assert.equal(isPilotRequestAuthorized(headers, "correct-secret"), true);
});

test("rejects missing, malformed, and incorrect credentials", () => {
  assert.equal(isPilotRequestAuthorized(new Headers(), "correct-secret"), false);
  assert.equal(
    isPilotRequestAuthorized(
      new Headers({ authorization: "Basic correct-secret" }),
      "correct-secret",
    ),
    false,
  );
  assert.equal(
    isPilotRequestAuthorized(
      new Headers({ authorization: "Bearer wrong-secret" }),
      "correct-secret",
    ),
    false,
  );
  assert.equal(
    isPilotRequestAuthorized(
      new Headers({ authorization: "Bearer correct-secret" }),
      null,
    ),
    false,
  );
});

test("protects the dashboard with basic authentication", () => {
  const valid = Buffer.from("giora:private-password").toString("base64");
  const invalid = Buffer.from("giora:wrong-password").toString("base64");

  assert.equal(
    isPilotDashboardAuthorized(
      new Headers({ authorization: `Basic ${valid}` }),
      "giora",
      "private-password",
    ),
    true,
  );
  assert.equal(
    isPilotDashboardAuthorized(
      new Headers({ authorization: `Basic ${invalid}` }),
      "giora",
      "private-password",
    ),
    false,
  );
  assert.equal(
    isPilotDashboardAuthorized(new Headers(), "giora", "private-password"),
    false,
  );
});
