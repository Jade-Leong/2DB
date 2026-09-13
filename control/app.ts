import express from "express";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { Store } from "./store";
import { Runner } from "./runner";
import { controlRoot, defaultData, problem } from "./paths";
import type { FixtureKind } from "./snapshots";
import { AgentService, setupStatus } from "./agent/service";
import { Agent2Service, agent2Status } from "./agent2";
import { ScriptedDemoService } from "./scripted-demo";
import { checkTavily, tavilyStatus } from "./agent/tavily";
import { createAccountAuth, mountAccountRoutes, type AccountAuth, type AccountIdentity } from "./accounts";
import {
  type GitHubConfig,
  authorizationUrl,
  installUrl,
  safeCompareState,
  exchangeOAuthCode,
  fetchGitHubUser,
  listPushableRepos,
  createPullRequestFromDiff,
  encrypt,
  decrypt,
} from "./github";
import { createTicket } from "./tickets";

export function createControl(
  options: {
    dataDir?: string;
    privateDir?: string;
    ticketSource?: string;
    remoteTickets?: () => Promise<any[]>;
    remoteDeleteTicket?: (id: string) => Promise<boolean>;
    github?: GitHubConfig;
    agentStatus?: typeof setupStatus;
    agent2Status?: typeof agent2Status;
    researchCheck?: typeof checkTavily;
    accountAuth?: AccountAuth;
  } = {},
) {
  const store = new Store(options.dataDir ?? defaultData, options.ticketSource),
    runner = new Runner(store);
  store.remoteTickets = options.remoteTickets;
  store.remoteDeleteTicket = options.remoteDeleteTicket;
  const agent2 = new Agent2Service(store, runner, options.agent2Status);
  const agent = new AgentService(
    store,
    options.agentStatus,
    (proposalId) => agent2.start(proposalId),
  );
  const scriptedDemo = new ScriptedDemoService(
    store,
    undefined,
    (proposalId) => agent2.start(proposalId),
  );
  let researchCheckRunning = false;
  let researchCheckAt = 0;
  let researchCheckResult: Awaited<ReturnType<typeof checkTavily>> | null =
    null;
  let statusCache:
    { at: number; value: Awaited<ReturnType<typeof setupStatus>> } | undefined;
  let agent2StatusCache:
    { at: number; value: Awaited<ReturnType<typeof agent2Status>> } | undefined;
  const privateDir = options.privateDir ?? path.join(controlRoot, "private");
  mkdirSync(privateDir, { recursive: true });
  const keyFile = path.join(privateDir, "engineer-key.json");
  if (!existsSync(keyFile))
    writeFileSync(
      keyFile,
      JSON.stringify({ key: randomBytes(32).toString("base64url") }, null, 2),
      { mode: 0o600 },
    );
  const key = JSON.parse(readFileSync(keyFile, "utf8")).key as string,
    sessions = new Map<string, { expiresAt: number; reviewer: string; accessToken?: string }>(),
    attempts = new Map<string, { count: number; since: number }>();
  const app = express();
  const accountAuth = options.accountAuth ?? createAccountAuth();
  app.use(express.json({ limit: "64kb" }));
  function issueSession(identity: AccountIdentity) {
    const sessionToken = randomBytes(32).toString("base64url");
    sessions.set(sessionToken, { expiresAt: Date.now() + identity.expiresIn * 1000, reviewer: identity.reviewer, accessToken: identity.accessToken });
    return sessionToken;
  }
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use((req, res, next) => {
    const host = `127.0.0.1:${req.socket.localPort}`;
    const allowedOrigins = new Set((process.env.CONTROL_ALLOWED_ORIGINS ?? `http://${host}`).split(",").map((origin) => origin.trim()).filter(Boolean));
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Demo-Account, Idempotency-Key, X-Support-Source");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      if (!origin || !allowedOrigins.has(origin)) { res.status(403).json({ error: "Cross-origin controller requests are not allowed." }); return; }
      res.status(204).end(); return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    // The GitHub OAuth callback is reached by browser redirect from github.com. It has no
    // Authorization header — the `state` param (verified below) is the CSRF defense.
    const githubCallback = req.method === "GET" && req.path === "/engineer-api/github/callback";
    const publicAccess = process.env.CONTROL_PUBLIC === "1";
    if (!githubCallback && !publicAccess && req.headers.host !== host) {
      res.status(403).json({ error: "Use the loopback dashboard address." });
      return;
    }
    if (!githubCallback && origin && !allowedOrigins.has(origin)) {
      res
        .status(403)
        .json({ error: "Cross-origin controller requests are not allowed." });
      return;
    }
    next();
  });
  app.post("/api/support", (req, res) => {
    const selected = req.header("X-Support-Source");
    const source = selected === "elevenlabs" ? "elevenlabs" : selected === "support-form" || !selected ? "support-form" : null;
    if (!source) { res.status(400).json({ error: "Unsupported ticket source." }); return; }
    try {
      const ticket = createTicket(store, { accountId: req.header("X-Demo-Account") || "", subject: req.body?.subject ?? "", complaint: req.body?.message ?? "", source, relatedReference: req.body?.related_reference, requestId: req.header("Idempotency-Key") || undefined });
      res.status(201).json({ id: ticket!.id, ticket });
    } catch (error) { const status = Number((error as any)?.status) || 400; res.status(status).json({ error: status >= 500 ? "Ticket could not be saved. Please try again." : (error as Error).message }); }
  });
  app.post("/api/support/elevenlabs", (req, res) => {
    const configured = process.env.ELEVENLABS_SUPPORT_WEBHOOK_SECRET?.trim();
    const supplied = req.header("X-ElevenLabs-Webhook-Secret") || "";
    if (!configured || supplied.length !== configured.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(configured))) { res.status(401).json({ error: "Webhook authentication failed." }); return; }
    try {
      const body = req.body ?? {};
      const ticket = createTicket(store, { accountId: body.account_id || body.customer_id || "", subject: body.subject ?? "", complaint: body.message ?? body.complaint ?? "", source: "elevenlabs", relatedReference: body.related_reference ?? body.order_reference, requestId: req.header("Idempotency-Key") || body.request_id });
      res.status(201).json({ id: ticket!.id, ticket });
    } catch (error) { const status = Number((error as any)?.status) || 400; res.status(status).json({ error: status >= 500 ? "Ticket could not be saved. Please try again." : (error as Error).message }); }
  });
  app.get("/health", (_req, res) => res.json({ ok: true, app: "2DB" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true, app: "2DB" }));
  mountAccountRoutes(app, accountAuth, issueSession);
  app.post("/engineer-api/login", (req, res) => {
    const address = req.socket.remoteAddress ?? "local",
      previous = attempts.get(address);
    if (previous && Date.now() - previous.since < 60000 && previous.count >= 10)
      problem("Too many attempts. Wait one minute.", 429);
    const supplied = typeof req.body.key === "string" ? req.body.key : "";
    const digest = (s: string) => createHash("sha256").update(s).digest();
    if (!timingSafeEqual(digest(supplied), digest(key))) {
      attempts.set(address, {
        count:
          previous && Date.now() - previous.since < 60000
            ? previous.count + 1
            : 1,
        since: previous?.since ?? Date.now(),
      });
      problem(
        "A local engineer key is required. Marketplace identities cannot approve.",
        401,
      );
    }
    attempts.delete(address);
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { expiresAt: Date.now() + 8 * 60 * 60 * 1000, reviewer: "Local engineer" });
    res.json({ token, reviewer: "Local engineer", expiresInHours: 8 });
  });
  app.use("/engineer-api", (req, res, next) => {
    // GitHub OAuth callback lands here via browser redirect from github.com with
    // no Authorization header. Its CSRF defense is the `state` param verified in
    // the route handler.
    if (req.method === "GET" && req.path === "/github/callback") { next(); return; }
    const token = req.header("Authorization")?.replace(/^Bearer /, "");
    if (!token || !sessions.has(token) || sessions.get(token)!.expiresAt < Date.now())
      problem(
        "Your session has expired. Please sign in again.",
        401,
      );
    res.locals.reviewer = sessions.get(token!)!.reviewer;
    next();
  });
  app.post("/engineer-api/logout", async (req, res) => {
    const id = req.header("Authorization")!.slice(7);
    const upstream = sessions.get(id)?.accessToken;
    sessions.delete(id);
    if (upstream) await accountAuth.logout(upstream).catch(() => {});
    res.json({ ok: true });
  });
  app.get("/engineer-api/session", (_req, res) =>
    res.json({ reviewer: res.locals.reviewer, active: runner.active }),
  );
  app.get("/engineer-api/inbox", async (_req, res) => res.json(await store.inboxAsync()));
  app.get("/engineer-api/research/status", (_req, res) =>
    res.json({ ...tavilyStatus(), lastCheck: researchCheckResult }),
  );
  app.post("/engineer-api/research/check", async (_req, res) => {
    if (researchCheckRunning || Date.now() - researchCheckAt < 60_000)
      problem("Wait one minute between Tavily connection checks.", 429);
    researchCheckRunning = true;
    researchCheckAt = Date.now();
    try {
      researchCheckResult = await (options.researchCheck ?? checkTavily)();
      res.json(researchCheckResult);
    } finally {
      researchCheckRunning = false;
    }
  });
  app.get("/engineer-api/agent/status", async (_req, res) => {
    if (!statusCache || Date.now() - statusCache.at > 30_000)
      statusCache = { at: Date.now(), value: await agent.statusCheck() };
    res.json(statusCache.value);
  });
  app.get("/engineer-api/agent2/status", async (_req, res) => {
    if (!agent2StatusCache || Date.now() - agent2StatusCache.at > 30_000)
      agent2StatusCache = { at: Date.now(), value: await agent2.statusCheck() };
    res.json(agent2StatusCache.value);
  });
  app.get("/engineer-api/investigations", (_req, res) =>
    res.json(agent.list()),
  );
  app.get("/engineer-api/investigations/:id", (req, res) =>
    res.json(agent.get(String(req.params.id))),
  );
  app.post("/engineer-api/tickets/:id/investigate", async (req, res) =>
    res.status(202).json(await agent.start(String(req.params.id))),
  );
  app.post("/engineer-api/investigations/:id/cancel", (req, res) =>
    res.json(agent.cancel(String(req.params.id))),
  );
  app.get("/engineer-api/scripted-investigations", (req, res) =>
    res.json(scriptedDemo.list(req.query.ticketId ? String(req.query.ticketId) : undefined)),
  );
  app.post("/engineer-api/tickets/:id/scripted-demo", async (req, res) =>
    res.status(202).json(await scriptedDemo.start(String(req.params.id), req.body.kind as FixtureKind)),
  );
  app.post("/engineer-api/scripted-investigations/:id/cancel", (req, res) =>
    res.json(scriptedDemo.cancel(String(req.params.id))),
  );
  app.get("/engineer-api/scripted-investigations/:id/evidence/:name", (req, res) =>
    res.sendFile(scriptedDemo.artifact(String(req.params.id), String(req.params.name))),
  );
  app.get("/engineer-api/investigations/:id/evidence/:name", (req, res) =>
    res.sendFile(
      agent.artifact(String(req.params.id), String(req.params.name)),
    ),
  );
  app.get("/engineer-api/tickets", (_req, res) =>
    res.json(
      store.db.prepare("SELECT * FROM tickets ORDER BY imported_at DESC").all(),
    ),
  );
  app.get("/engineer-api/proposals", (_req, res) => res.json(store.list()));
  app.get("/engineer-api/proposals/:id", (req, res) =>
    res.json(store.detail(String(req.params.id))),
  );
  app.post("/engineer-api/tickets/:id/import", async (req, res) =>
    res.json(await store.receiveTicket(String(req.params.id))),
  );
  app.delete("/engineer-api/tickets/:id", async (req, res) =>
    res.json(await store.deleteTicket(String(req.params.id))),
  );

  function escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  }
  // ---- GitHub App integration (2DB Bridge) ----
  const github = options.github;
  // In-memory CSRF store: state -> {reviewer, expiresAt}. Cleared after use or 10min.
  const pendingInstalls = new Map<string, { reviewer: string; expiresAt: number }>();
  function pruneInstalls() {
    const now = Date.now();
    for (const [k, v] of pendingInstalls) if (v.expiresAt < now) pendingInstalls.delete(k);
  }
  app.get("/engineer-api/github/status", (_req, res) => {
    const reviewer = res.locals.reviewer as string;
    const link = github && store.githubLink(reviewer);
    res.json({
      configured: !!github,
      connected: !!link,
      login: link?.github_login ?? null,
      targetRepo: github?.targetRepo ?? null,
    });
  });
  app.post("/engineer-api/github/connect-url", (_req, res) => {
    if (!github) problem("GitHub App integration is not configured on this server.", 503);
    pruneInstalls();
    const state = randomBytes(24).toString("base64url");
    pendingInstalls.set(state, {
      reviewer: res.locals.reviewer as string,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    res.json({ url: authorizationUrl(github, state) });
  });
  app.post("/engineer-api/github/install-url", (_req, res) => {
    if (!github) problem("GitHub App integration is not configured on this server.", 503);
    res.json({ url: installUrl(github) });
  });
  app.get("/engineer-api/github/callback", async (req, res) => {
    if (!github) { res.status(503).send("GitHub App integration is not configured."); return; }
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    const installationId = Number(req.query.installation_id ?? 0);
    pruneInstalls();
    const pending = state && [...pendingInstalls.entries()].find(([k]) => safeCompareState(k, state));
    if (!pending) { res.status(400).send("Install session expired or invalid. Return to 2DB and try again."); return; }
    pendingInstalls.delete(pending[0]);
    if (!code) {
      res.status(400).send("GitHub callback is missing its authorization code.");
      return;
    }
    try {
      const oauth = await exchangeOAuthCode(github, code);
      const user = await fetchGitHubUser(oauth.access_token);
      const expiresAt = oauth.expires_in ? new Date(Date.now() + oauth.expires_in * 1000).toISOString() : null;
      store.saveGithubLink(pending[1].reviewer, {
        github_user_id: user.id,
        github_login: user.login,
        user_token: encrypt(github, oauth.access_token),
        user_token_expires_at: expiresAt,
        refresh_token: oauth.refresh_token ? encrypt(github, oauth.refresh_token) : null,
      });
      if (github.returnUrl) {
        const destination = new URL(github.returnUrl);
        destination.searchParams.set("github", "connected");
        res.redirect(303, destination.href);
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!doctype html><meta charset="utf-8"><title>Connected to GitHub · 2DB Bridge</title><style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: #1a1a1a; color: #eceeec; font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; display: flex; align-items: center; justify-content: center; padding: 24px; }
.card { max-width: 480px; width: 100%; padding: 28px 30px; border: 1px solid #2f2f2f; border-radius: 6px; background: #212121; }
.badge { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border: 1px solid #2f5f3a; border-radius: 999px; color: #9dd3b0; font-size: 12px; letter-spacing: 0.02em; text-transform: uppercase; }
.badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #9dd3b0; }
h1 { font-size: 20px; font-weight: 500; letter-spacing: -0.01em; margin: 14px 0 8px; }
p { color: #b3b3b3; margin: 10px 0; }
p strong { color: #eceeec; font-weight: 500; }
kbd { font: inherit; color: #eceeec; background: #2a2a2a; border: 1px solid #333; border-radius: 3px; padding: 1px 6px; }
.muted { color: #7d7d7d; font-size: 12px; margin-top: 18px; }
</style><div class="card"><span class="badge">Connected</span><h1>2DB Bridge is linked</h1><p>Signed in as <strong>${escapeHtml(user.login)}</strong>${installationId > 0 ? ` · installation <strong>#${installationId}</strong>` : ""}.</p><p>Close this tab and return to 2DB — the workspace picks up the connection automatically.</p><p class="muted">Tokens are stored encrypted at rest and never leave your local server.</p></div>`);
    } catch (e: any) {
      res.status(502).send(`GitHub callback failed: ${e?.message ?? "unknown error"}`);
    }
  });
  app.post("/engineer-api/github/disconnect", (_req, res) => {
    store.removeGithubLink(res.locals.reviewer as string);
    res.json({ ok: true });
  });
  app.get("/engineer-api/github/installations", async (_req, res) => {
    if (!github) problem("GitHub App integration is not configured on this server.", 503);
    const reviewer = res.locals.reviewer as string;
    const link = store.githubLink(reviewer);
    if (!link) problem("Connect a GitHub account first.", 409);
    const userToken = decrypt(github, link.user_token);
    const repos = await listPushableRepos(github, userToken);
    const byInstall = new Map<number, { id: number; account_login: string; repoCount: number }>();
    for (const r of repos) {
      const entry = byInstall.get(r.installationId) ?? { id: r.installationId, account_login: r.account_login, repoCount: 0 };
      entry.repoCount++;
      byInstall.set(r.installationId, entry);
    }
    res.json({ installations: [...byInstall.values()] });
  });
  app.get("/engineer-api/github/installations/:id/repos", async (req, res) => {
    if (!github) problem("GitHub App integration is not configured on this server.", 503);
    const reviewer = res.locals.reviewer as string;
    const link = store.githubLink(reviewer);
    if (!link) problem("Connect a GitHub account first.", 409);
    const installationId = Number(req.params.id);
    if (!Number.isInteger(installationId) || installationId <= 0) problem("Invalid installation.", 400);
    const userToken = decrypt(github, link.user_token);
    const all = await listPushableRepos(github, userToken);
    const repos = all.filter((r) => r.installationId === installationId).map(({ owner, repo, default_branch }) => ({ owner, repo, default_branch }));
    if (!repos.length && !all.some((r) => r.installationId === installationId))
      problem("You do not have push access to any repository covered by this installation.", 403);
    res.json({ repos });
  });
  app.post("/engineer-api/proposals/:id/pr", async (req, res) => {
    if (!github) problem("GitHub App integration is not configured on this server.", 503);
    const reviewer = res.locals.reviewer as string;
    const link = store.githubLink(reviewer);
    if (!link) problem("Connect a GitHub account first.", 409);
    const proposalId = String(req.params.id);
    const proposal = store.proposal(proposalId);
    if (proposal.state !== "Approved") problem("Only approved proposals can be pushed as PRs.", 409);
    const existing = store.prForProposal(proposalId);
    if (existing) { res.json({ url: existing.pr_url, number: existing.pr_number, existed: true }); return; }
    const userToken = decrypt(github, link.user_token);
    const pushable = await listPushableRepos(github, userToken);
    let owner: string, repo: string, installationId: number;
    const base = String(req.body.base ?? "main").trim() || "main";
    if (github.targetRepo) {
      owner = github.targetRepo.owner;
      repo = github.targetRepo.repo;
      const match = pushable.find((r) => r.owner === owner && r.repo === repo);
      if (!match) problem(`You need push access to ${owner}/${repo} with 2DB Bridge installed there. Fork it and install the app, or ask an owner to install it.`, 403);
      installationId = match.installationId;
    } else {
      installationId = Number(req.body.installationId);
      owner = String(req.body.owner ?? "").trim();
      repo = String(req.body.repo ?? "").trim();
      if (!Number.isInteger(installationId) || installationId <= 0 || !/^[A-Za-z0-9._-]{1,100}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo))
        problem("owner, repo, and installationId are required.", 400);
      if (!pushable.some((r) => r.installationId === installationId && r.owner === owner && r.repo === repo))
        problem("You do not have push access to this repository, or 2DB Bridge is not installed there.", 403);
    }
    const ticket = store.db.prepare("SELECT subject, complaint FROM tickets WHERE id=?").get(proposal.ticket_id) as { subject: string; complaint: string } | undefined;
    const title = `[2DB] ${ticket?.subject ?? "Proposed change"}`;
    const branch = `2db/${proposalId.slice(0, 8)}-${Date.now().toString(36)}`;
    const body = [
      `Opened by 2DB Bridge on behalf of ${link.github_login}.`,
      "",
      `Ticket: ${ticket?.subject ?? proposal.ticket_id}`,
      "",
      "## Proposal explanation",
      "",
      proposal.explanation || "(none provided)",
    ].join("\n");
    const pr = await createPullRequestFromDiff({
      config: github, installationId, owner, repo, base, branch, title, body,
      unifiedDiff: proposal.diff, authorName: link.github_login, authorEmail: `${link.github_login}@users.noreply.github.com`,
    });
    store.savePr(proposalId, { url: pr.url, number: pr.number, branch: pr.branch, owner, repo });
    store.event(proposal.ticket_id, proposalId, `GitHub (${link.github_login})`, "PR opened", { url: pr.url });
    res.status(201).json({ url: pr.url, number: pr.number, branch: pr.branch });
  });
  app.get("/engineer-api/proposals/:id/pr", (req, res) => {
    const pr = store.prForProposal(String(req.params.id));
    res.json(pr ? { url: pr.pr_url, number: pr.pr_number, branch: pr.head_branch, owner: pr.owner, repo: pr.repo } : null);
  });
  app.post("/engineer-api/proposals", async (req, res) => {
    await store.receiveTicket(String(req.body.ticketId));
    return res
      .status(201)
      .json(
        store.create(String(req.body.ticketId), req.body.kind as FixtureKind),
      ); },
  );
  app.post("/engineer-api/proposals/:id/revision", (req, res) =>
    res.json(store.change(String(req.params.id), req.body.kind)),
  );
  app.post("/engineer-api/proposals/:id/submit", (req, res) =>
    res.json(store.submit(String(req.params.id), res.locals.reviewer)),
  );
  app.post("/engineer-api/proposals/:id/approve", (req, res) =>
    res.json(
      store.approve(
        String(req.params.id),
        req.body.revision,
        req.body.revisionNumber,
        res.locals.reviewer,
      ),
    ),
  );
  app.post("/engineer-api/proposals/:id/changes", (req, res) =>
    res.json(
      store.decision(
        String(req.params.id),
        "changes",
        String(req.body.note ?? "").slice(0, 2000),
        res.locals.reviewer,
      ),
    ),
  );
  app.post("/engineer-api/proposals/:id/reject", (req, res) =>
    res.json(
      store.decision(
        String(req.params.id),
        "reject",
        String(req.body.note ?? "").slice(0, 2000),
        res.locals.reviewer,
      ),
    ),
  );
  app.post("/engineer-api/proposals/:id/verify", async (req, res) =>
    res.status(202).json(await runner.start(String(req.params.id), "scripted-verification")),
  );
  app.post("/engineer-api/proposals/:id/verify-live", async (req, res) =>
    res.status(202).json(await agent2.start(String(req.params.id))),
  );
  app.post("/engineer-api/agent2/:runId/cancel", (req, res) =>
    res.json(agent2.cancel(String(req.params.runId))),
  );
  app.get("/engineer-api/agent2/:runId/evidence/:name", (req, res) =>
    res.sendFile(agent2.artifact(String(req.params.runId), String(req.params.name))),
  );
  app.get(
    "/engineer-api/artifact/:runId/:environment/:group/:name",
    (req, res) => {
      const { runId, environment, group, name } = req.params;
      const run = store.db
        .prepare("SELECT id FROM runs WHERE id=?")
        .get(String(runId));
      if (
        !run ||
        !["baseline", "candidate"].includes(String(environment)) ||
        !["required", "known-unresolved"].includes(String(group))
      )
        problem("Artifact not found.", 404);
      const root = path.join(
        store.dataDir,
        "runs",
        String(runId),
        String(environment),
        String(group),
      );
      const relative = String(name);
      if (relative.includes("..") || path.isAbsolute(relative))
        problem("Invalid artifact path.", 400);
      const file = path.resolve(root, relative);
      if (
        !existsSync(file) ||
        !realpathSync(file).startsWith(realpathSync(root) + path.sep)
      )
        problem("Artifact not found.", 404);
      if (![".png", ".zip", ".json", ".log"].includes(path.extname(file)))
        problem("Unsupported artifact.", 400);
      if (file.endsWith(".zip")) res.download(file);
      else res.sendFile(file);
    },
  );
  app.get("/engineer-api/run-log/:runId/:environment/:name", (req, res) => {
    const { runId, environment, name } = req.params;
    if (
      !store.db.prepare("SELECT id FROM runs WHERE id=?").get(String(runId)) ||
      !["baseline", "candidate"].includes(String(environment)) ||
      !["typecheck.log", "build.log", "summary.json"].includes(String(name))
    )
      problem("Log not found.", 404);
    res.sendFile(
      path.join(
        store.dataDir,
        "runs",
        String(runId),
        String(environment),
        String(name),
      ),
    );
  });
  app.get("/engineer-api/test-summary", (_req, res) => {
    const p = path.join(controlRoot, "test-results/latest.json");
    res.json(existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  });
  app.get("/engineer-api/runs/:id", (req, res) => {
    const row = store.db
      .prepare("SELECT * FROM runs WHERE id=?")
      .get(String(req.params.id)) as any;
    if (!row) problem("Run not found.", 404);
    res.json({
      ...row,
      evidence: row.evidence ? JSON.parse(row.evidence) : null,
    });
  });
  app.get(["/login", "/signup"], (_req, res) => res.sendFile(path.join(controlRoot, "web/index.html")));
  app.use(express.static(path.join(controlRoot, "web")));
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) =>
      res.status(err.status ?? 500).json({
        error: err.status
          ? err.message
          : "Controller operation failed. See the local terminal.",
      }),
  );
  return { app, store, runner, agent, agent2, scriptedDemo, keyFile };
}
