import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { createControl } from "../app";
import { createAccountAuth } from "../accounts";

const calls: { route: string; body: any }[] = [];
const provider = (async (url: string | URL | Request, init?: RequestInit) => {
  const route = new URL(String(url)).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ route, body });
  if (route.endsWith("/signup")) return Response.json({ id: "user-test" });
  if (route.endsWith("/token")) {
    if (body.password !== "a-valid-test-password")
      return Response.json({ code: "invalid_credentials" }, { status: 400 });
    return Response.json({
      access_token:
        body.email === "unconfirmed@example.test"
          ? "unconfirmed-token"
          : "verified-token",
      refresh_token: "must-not-reach-browser",
      expires_in: 3600,
    });
  }
  if (route.endsWith("/user")) {
    const auth = new Headers(init?.headers).get("Authorization");
    return Response.json({
      id: "verified-user-id",
      email: "engineer@example.test",
      email_confirmed_at: auth?.includes("unconfirmed")
        ? null
        : "2026-09-12T12:00:00Z",
      user_metadata: { role: "admin" },
    });
  }
  if (route.endsWith("/logout")) return new Response(null, { status: 204 });
  throw new Error("Unexpected provider request");
}) as typeof fetch;
const auth = createAccountAuth(
  {
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable",
  },
  provider,
);
const folder = mkdtempSync(path.join(tmpdir(), "2db-accounts-test-"));
const control = createControl({
  dataDir: path.join(folder, "data"),
  privateDir: path.join(folder, "private"),
  remoteTickets: async () => [
    {
      id: "auth-test-ticket",
      customer_id: "test-buyer",
      customer_name: "Test buyer",
      customer_role: "buyer",
      subject: "Discount complaint",
      complaint: "I used a discount code, but I was charged the full price.",
      submitted_at: "2026-09-12T12:00:00Z",
    },
  ],
  accountAuth: auth,
  agentStatus: async () =>
    ({
      state: "Setup required",
      sdk: { ready: true, message: "Installed" },
      authentication: { ready: false, message: "Not configured" },
      browser: { ready: false, message: "Not configured" },
      isolation: { ready: false, browser: false, message: "Not configured" },
    }) as any,
});
const server = control.app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
async function post(
  route: string,
  body: object,
  headers: Record<string, string> = {},
) {
  const response = await fetch(origin + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  control.store.close();
});

test("signup validates input and returns email confirmation without a privileged session", async () => {
  assert.equal(
    (
      await post("/auth-api/signup", {
        email: "bad",
        password: "a-valid-test-password",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/auth-api/signup", {
        email: "user@example.test",
        password: "short",
      })
    ).status,
    400,
  );
  const result = await post("/auth-api/signup", {
    email: "new@example.test",
    password: "a-valid-test-password",
  });
  assert.equal(result.status, 202);
  assert.match(result.body.message, /confirm your account/);
  assert.equal(result.body.token, undefined);
});
test("confirmed accounts enter the shared workspace; invalid and unconfirmed accounts cannot", async () => {
  assert.equal(
    (
      await post("/auth-api/login", {
        email: "engineer@example.test",
        password: "wrong-password",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post("/auth-api/login", {
        email: "unconfirmed@example.test",
        password: "a-valid-test-password",
      })
    ).status,
    401,
  );
  const result = await post("/auth-api/login", {
    email: "engineer@example.test",
    password: "a-valid-test-password",
    role: "admin",
  });
  assert.equal(result.status, 200);
  assert.equal(
    result.body.reviewer,
    "engineer@example.test (verified-user-id)",
  );
  assert.ok(result.body.token && result.body.token !== "verified-token");
  assert.equal(
    JSON.stringify(result.body).includes("must-not-reach-browser"),
    false,
  );
  const headers = { Authorization: `Bearer ${result.body.token}` };
  const session = await fetch(origin + "/engineer-api/session", { headers });
  assert.equal((await session.json()).reviewer, result.body.reviewer);
  assert.equal(
    (await fetch(origin + "/engineer-api/inbox", { headers })).status,
    200,
  );
  await post("/engineer-api/logout", {}, headers);
  assert.equal(
    (await fetch(origin + "/engineer-api/inbox", { headers })).status,
    401,
  );
  assert.ok(calls.some((call) => call.route.endsWith("/logout")));
});
test("cross-origin account mutations are rejected", async () => {
  const result = await post(
    "/auth-api/login",
    { email: "engineer@example.test", password: "a-valid-test-password" },
    { Origin: "https://untrusted.example" },
  );
  assert.equal(result.status, 403);
});
test("allowed dashboard origins can preflight ticket deletion", async () => {
  const response = await fetch(origin + "/engineer-api/tickets/example-ticket", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "DELETE",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.match(response.headers.get("access-control-allow-methods") || "", /(?:^|,\s*)DELETE(?:,|$)/);
});
test("account approval queues only an exact live-reviewed revision with verified reviewer attribution", async () => {
  const login = await post("/auth-api/login", {
    email: "engineer@example.test",
    password: "a-valid-test-password",
  });
  const headers = { Authorization: `Bearer ${login.body.token}` };
  const created = await post(
    "/engineer-api/proposals",
    { ticketId: "auth-test-ticket", kind: "discount-fix" },
    headers,
  );
  assert.equal(created.status, 201);
  const p = created.body;
  assert.equal(
    (
      await post(
        `/engineer-api/proposals/${p.id}/approve`,
        {
          revision: p.candidate_revision,
          revisionNumber: p.revision_number,
          reviewer: "spoofed",
        },
        headers,
      )
    ).status,
    409,
  );
  const authorized = control.store.authorizeVerification(p.id);
  const verification = randomUUID();
  control.store.db
    .prepare(
      "INSERT INTO runs(id,proposal_id,approval_id,candidate_revision,base_revision,requirements_hash,harness_hash,revision_number,state,started_at,finished_at,evidence,message,verification_mode) VALUES(?,?,?,?,?,?,?,?,'Verified awaiting engineer review',?,?,?,?,'live-agent-2')",
    )
    .run(
      verification,
      p.id,
      authorized.current_approval,
      p.candidate_revision,
      p.base_revision,
      p.requirements_hash,
      p.harness_hash,
      p.revision_number,
      new Date().toISOString(),
      new Date().toISOString(),
      "{}",
      "Synthetic verified result",
    );
  control.store.db
    .prepare(
      "UPDATE proposals SET state='Verified awaiting engineer review',last_run=? WHERE id=?",
    )
    .run(verification, p.id);
  assert.equal(
    (
      await post(
        `/engineer-api/proposals/${p.id}/approve`,
        { revision: "stale", revisionNumber: p.revision_number },
        headers,
      )
    ).status,
    409,
  );
  const approved = await post(
    `/engineer-api/proposals/${p.id}/approve`,
    {
      revision: p.candidate_revision,
      revisionNumber: p.revision_number,
      reviewer: "spoofed",
    },
    headers,
  );
  assert.equal(approved.status, 200);
  assert.equal(
    approved.body.queueApproval.reviewer,
    "engineer@example.test (verified-user-id)",
  );
  assert.equal(approved.body.state, "Approved");
  assert.equal(approved.body.runs.length, 1);
});
test("Terminal account pages work on desktop and mobile with two content font sizes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Sign in →", exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>("#account-form button")
          ?.disabled,
    );
    assert.equal(await page.locator(".typing-char").count(), 0);
    const sizes = await page.locator(".workspace").evaluate((el) =>
      [
        ...new Set(
          Array.from(el.querySelectorAll("*"))
            .filter(
              (node) =>
                node.childNodes.length &&
                Array.from(node.childNodes).some(
                  (child) =>
                    child.nodeType === Node.TEXT_NODE &&
                    child.textContent?.trim(),
                ) &&
                node.getBoundingClientRect().height > 0,
            )
            .map((node) => getComputedStyle(node).fontSize),
        ),
      ].sort(),
    );
    assert.deepEqual(sizes, ["13px", "22px"]);
    const artifacts = path.resolve("control/test-results/terminal");
    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({
      path: path.join(artifacts, "desktop.png"),
      fullPage: true,
    });
    await page.goto(origin + "/signup");
    assert.equal(await page.locator(".terminal-hero").count(), 0);
    await page.getByRole("tab", { name: "Sign up", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("ui@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("a-valid-test-password");
    await page.getByRole("button", { name: "Create account →" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Check your email" })
      .waitFor();
    await page
      .getByLabel("Email", { exact: true })
      .fill("engineer@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("a-valid-test-password");
    await page.getByRole("button", { name: "Sign in →", exact: true }).click();
    await page.getByRole("heading", { name: "Ticket inbox" }).waitFor();
    assert.equal(await page.locator(".terminal-hero, #agents").count(), 0);
    assert.equal(
      await page.getByRole("link", { name: "The agents", exact: true }).count(),
      0,
    );
    assert.equal(new URL(page.url()).pathname, "/");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(artifacts, "mobile-workspace.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Email", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(artifacts, "mobile-login.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
test("account configuration recovers from an outage without losing entered credentials", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.route("**/auth-api/config", (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "The hosted backend is starting or unavailable.",
      }),
    );
    await page.goto(origin + "/signup");
    await page
      .getByText("Account service could not be reached.", { exact: false })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Create account →" }).isEnabled(),
      false,
    );
    assert.equal(
      (await page.locator("body").innerText()).includes("not configured"),
      false,
    );
    await page
      .getByLabel("Email", { exact: true })
      .fill("recovery@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("a-valid-test-password");
    await page.unroute("**/auth-api/config");
    await page.getByRole("button", { name: "Retry connection" }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>("#account-form button")
          ?.disabled,
    );
    assert.equal(
      await page.getByLabel("Email", { exact: true }).inputValue(),
      "recovery@example.test",
    );
    assert.equal(
      await page.getByLabel("Password", { exact: true }).inputValue(),
      "a-valid-test-password",
    );
  } finally {
    await browser.close();
  }
});
test("plain-text hosted failures show a useful error and allow retry", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.route("**/auth-api/login", (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "The hosted backend is starting or unavailable. Retry shortly.",
      }),
    );
    await page.goto(origin + "/login");
    await page
      .getByLabel("Email", { exact: true })
      .fill("engineer@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("a-valid-test-password");
    await page.getByRole("button", { name: "Sign in →", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "temporarily unavailable" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Sign in →", exact: true })
        .isEnabled(),
      true,
    );
    assert.equal(
      (await page.locator("body").innerText()).includes("Unexpected token"),
      false,
    );
    await page.unroute("**/auth-api/login");
    await page
      .getByLabel("Email", { exact: true })
      .fill("engineer@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("a-valid-test-password");
    await page.getByRole("button", { name: "Sign in →", exact: true }).click();
    await page.getByRole("heading", { name: "Ticket inbox" }).waitFor();
    assert.equal(await page.locator(".terminal-hero, #agents").count(), 0);
    assert.equal(
      await page.getByRole("link", { name: "The agents", exact: true }).count(),
      0,
    );
  } finally {
    await browser.close();
  }
});
test("scroll reveals typed copy without replaying it after a render", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 550 },
    });
    await page.goto(origin);
    const agentTwo = page.locator('[data-type="agent-two-title"]');
    await agentTwo
      .locator(".typing-char")
      .first()
      .waitFor({ state: "attached" });
    assert.equal(await agentTwo.locator(".typing-char.is-visible").count(), 0);
    await agentTwo.scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      Array.from(
        document.querySelectorAll('[data-type="agent-two-title"] .typing-char'),
      ).every((el) => el.classList.contains("is-visible")),
    );
    await page.getByRole("tab", { name: "Sign up", exact: true }).click();
    assert.equal(await agentTwo.locator(".typing-char").count(), 0);
    assert.match(await agentTwo.innerText(), /Verify the result/);
  } finally {
    await browser.close();
  }
});
