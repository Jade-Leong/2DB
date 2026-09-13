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

export function createControl(
  options: {
    dataDir?: string;
    privateDir?: string;
    ticketSource?: string;
    remoteTickets?: () => Promise<any[]>;
    agentStatus?: typeof setupStatus;
    agent2Status?: typeof agent2Status;
    researchCheck?: typeof checkTavily;
    accountAuth?: AccountAuth;
  } = {},
) {
  const store = new Store(options.dataDir ?? defaultData, options.ticketSource),
    runner = new Runner(store);
  store.remoteTickets = options.remoteTickets;
  const agent = new AgentService(store, options.agentStatus);
  const scriptedDemo = new ScriptedDemoService(store);
  const agent2 = new Agent2Service(store, runner, options.agent2Status);
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
  function issueSession(identity: AccountIdentity) {
    const sessionToken = randomBytes(32).toString("base64url");
    sessions.set(sessionToken, { expiresAt: Date.now() + identity.expiresIn * 1000, reviewer: identity.reviewer, accessToken: identity.accessToken });
    return sessionToken;
  }
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use((req, res, next) => {
    const host = `127.0.0.1:${req.socket.localPort}`;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (req.headers.host !== host) {
      res.status(403).json({ error: "Use the loopback dashboard address." });
      return;
    }
    if (req.headers.origin && req.headers.origin !== `http://${host}`) {
      res
        .status(403)
        .json({ error: "Cross-origin controller requests are not allowed." });
      return;
    }
    next();
  });
  app.get("/health", (_req, res) => res.json({ ok: true, app: "2DB" }));
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
