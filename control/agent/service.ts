import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "../store";
import { now, projectRoot, problem } from "../paths";
import { hash, revision, sourceFiles, harnessRevision } from "../snapshots";
import { discountRequirements } from "../../verification/discount-contract";
import {
  actionSchema,
  cleanCopy,
  readSource,
  editSource,
  actualDiff,
  investigationPrompt,
  limits,
  parseAction,
  mismatch,
  conclusion,
  behavior,
} from "./policy";
import {
  JsonProcess,
  IsolatedApp,
  hardening,
  docker,
  probeIsolation,
} from "./docker";

export async function sdkAvailable() {
  try {
    return typeof (await import("@openai/codex-sdk")).Codex === "function";
  } catch {
    return false;
  }
}
export async function setupStatus() {
  const sdk = await sdkAvailable();
  const configured = Boolean(process.env.TWO_DB_OPENAI_API_KEY?.trim()),
    model = process.env.TWO_DB_AGENT_MODEL?.trim() || "";
  let authenticated = false;
  if (configured && model) {
    try {
      const response = await fetch(
        "https://api.openai.com/v1/models/" + encodeURIComponent(model),
        {
          headers: {
            Authorization: "Bearer " + process.env.TWO_DB_OPENAI_API_KEY,
          },
          signal: AbortSignal.timeout(8000),
          redirect: "error",
        },
      );
      authenticated = response.ok;
    } catch {}
  }
  const isolation = await probeIsolation();
  return {
    state: sdk && authenticated && isolation.ready ? "Ready" : "Setup required",
    sdk: {
      ready: sdk,
      message: sdk ? "Official Codex SDK installed" : "Run npm.cmd ci",
    },
    authentication: {
      ready: authenticated,
      message: !configured
        ? "Set TWO_DB_OPENAI_API_KEY privately in the controller terminal (see control/AGENT-1.md)."
        : !model
          ? "Set TWO_DB_AGENT_MODEL to a Codex-compatible model available to your API project."
          : !authenticated
            ? "API credential/model readiness check failed. Check your API project, model access, billing, or network."
            : "API credential and selected model accepted by the API; actual Codex execution still needs a live run.",
    },
    model,
    browser: { ready: isolation.browser, message: isolation.message },
    isolation,
  };
}
export class AgentService {
  active = false;
  abort?: AbortController;
  activeId?: string;
  constructor(
    public store: Store,
    public statusCheck = setupStatus,
  ) {
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS investigations(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id),state TEXT NOT NULL,thread_id TEXT,started_at TEXT NOT NULL,finished_at TEXT,base_revision TEXT,candidate_revision TEXT,proposal_id TEXT,events TEXT NOT NULL,evidence TEXT NOT NULL,usage TEXT NOT NULL,message TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_investigation ON investigations(ticket_id) WHERE finished_at IS NULL;
    CREATE TABLE IF NOT EXISTS agent_candidates(proposal_id TEXT PRIMARY KEY REFERENCES proposals(id),run_id TEXT NOT NULL,base_root TEXT NOT NULL,candidate_root TEXT NOT NULL,evidence TEXT NOT NULL);`);
    store.db
      .prepare(
        "UPDATE investigations SET state='Failed',finished_at=?,message='Controller restarted; investigation interrupted. Start a fresh investigation.' WHERE finished_at IS NULL",
      )
      .run(now());
  }
  list() {
    return this.store.db
      .prepare(
        "SELECT id,ticket_id,state,thread_id,started_at,finished_at,proposal_id,message FROM investigations ORDER BY started_at DESC",
      )
      .all();
  }
  get(id: string): any {
    const r = this.store.db
      .prepare("SELECT * FROM investigations WHERE id=?")
      .get(id) as any;
    if (!r) problem("Investigation not found.", 404);
    return {
      ...r,
      events: JSON.parse(r.events),
      evidence: JSON.parse(r.evidence),
      usage: JSON.parse(r.usage),
    };
  }
  event(id: string, state: string, message: string, details: unknown = null) {
    const run = this.get(id);
    if (run.finished_at) return;
    run.events.push({ at: now(), state, message, details });
    this.store.db
      .prepare(
        "UPDATE investigations SET state=?,events=?,message=? WHERE id=?",
      )
      .run(state, JSON.stringify(run.events), message, id);
  }
  finish(id: string, state: string, message: string) {
    this.event(id, state, message);
    this.store.db
      .prepare("UPDATE investigations SET finished_at=? WHERE id=?")
      .run(now(), id);
  }
  async start(ticketId: string) {
    if (this.active)
      problem(
        "An investigation is already active. Wait or cancel it before starting another.",
        409,
      );
    const existing = this.store.db
      .prepare(
        "SELECT id FROM investigations WHERE ticket_id=? AND finished_at IS NULL",
      )
      .get(ticketId);
    if (existing) return this.get(String(existing.id));
    const ticket = this.store.importTicket(ticketId) as any;
    if (
      !["buyer-maya", "buyer-jamie"].includes(ticket.customer_id) ||
      ticket.customer_role !== "buyer"
    )
      problem(
        "This milestone supports the two synthetic buyers. Request more information for other customer identities.",
      );
    this.active = true;
    const id = randomUUID();
    this.activeId = id;
    this.abort = new AbortController();
    this.store.db
      .prepare(
        "INSERT INTO investigations(id,ticket_id,state,started_at,events,evidence,usage,message) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        ticketId,
        "Checking setup",
        now(),
        "[]",
        "[]",
        "[]",
        "Checking explicit worker authentication and isolation.",
      );
    try {
      const status = await this.statusCheck();
      if (this.abort.signal.aborted) {
        this.finish(id, "Cancelled", "Engineer cancelled the investigation.");
        this.active = false;
        return this.get(id);
      }
      if (status.state !== "Ready") {
        this.finish(
          id,
          "Setup required",
          [status.authentication.message, status.isolation.message].join(" "),
        );
        this.active = false;
        return this.get(id);
      }
      const signal = this.abort.signal;
      void this.investigate(id, ticket, status, signal)
        .catch(() =>
          this.finish(
            id,
            signal.aborted ? "Cancelled" : "Failed",
            signal.aborted
              ? "Investigation cancelled or duration limit reached. No candidate was executed."
              : "Investigation failed. No successful reproduction or fix is inferred. Review recorded actions and setup.",
          ),
        )
        .finally(() => {
          this.active = false;
          this.activeId = undefined;
        });
      return this.get(id);
    } catch {
      this.active = false;
      this.finish(
        id,
        "Setup required",
        "Unable to establish worker readiness. No agent or candidate code executed.",
      );
      return this.get(id);
    }
  }
  cancel(id: string) {
    const run = this.get(id);
    if (!run.finished_at && this.activeId === id) {
      this.abort?.abort();
      this.event(id, "Cancelling", "Cancellation requested by Local engineer.");
    }
    return this.get(id);
  }
  artifact(id: string, name: string) {
    const run = this.get(id);
    if (
      !/^browser-\d+\.(png|json)$/.test(name) ||
      !run.evidence.some((e: any) => e.screenshot === name || e.record === name)
    )
      problem("Evidence not found.", 404);
    return path.join(
      this.store.dataDir,
      "investigations",
      id,
      "evidence",
      name,
    );
  }
  async investigate(
    id: string,
    ticket: any,
    status: Awaited<ReturnType<typeof setupStatus>>,
    signal: AbortSignal,
  ) {
    const dir = path.join(this.store.dataDir, "investigations", id),
      base = path.join(dir, "baseline"),
      candidate = path.join(dir, "candidate"),
      evidenceDir = path.join(dir, "evidence");
    mkdirSync(evidenceDir, { recursive: true });
    this.event(
      id,
      "Preparing isolated workspace",
      "Copying application handoff allowlist into a fresh, disposable baseline.",
    );
    cleanCopy(projectRoot, base, true);
    cleanCopy(base, candidate);
    const baseRevision = revision(base);
    this.store.db
      .prepare("UPDATE investigations SET base_revision=? WHERE id=?")
      .run(baseRevision, id);
    const app = new IsolatedApp(status.isolation.image!);
    const modelName = "twodb-model-" + randomUUID();
    let model: JsonProcess | undefined;
    const timer = setTimeout(() => this.abort?.abort(), limits.durationMs);
    const stop = () => {
      void docker(["rm", "-f", modelName, app.name, app.browserName]).catch(
        () => {},
      );
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      await app.start(base, signal, (output) =>
        writeFileSync(path.join(dir, "baseline-build.log"), output, {
          flag: "a",
        }),
      );
      signal.throwIfAborted();
      this.event(
        id,
        "Opening the customer workflow",
        "Isolated baseline is running. Opening the affected synthetic buyer session.",
      );
      let result = await app.browserAction({
        action: "init",
        buyer: ticket.customer_id,
      });
      if (!result.ok) throw new Error("Browser setup failed");
      const saveBrowser = (data: any) => {
        const run = this.get(id),
          n = run.evidence.length;
        const screenshot = `browser-${n}.png`,
          record = `browser-${n}.json`;
        const image = Buffer.from(data.screenshot ?? "", "base64");
        if (
          image.length < 8 ||
          image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
        )
          throw new Error("Missing browser screenshot");
        writeFileSync(path.join(evidenceDir, screenshot), image, {
          flag: "wx",
        });
        const { screenshot: _, ...observations } = data;
        const evidence = {
          origin: "trusted-browser",
          base: baseRevision,
          at: now(),
          ...data.receipt,
          buyer: ticket.customer_id,
          screenshot,
          record,
        };
        writeFileSync(
          path.join(evidenceDir, record),
          JSON.stringify({ evidence, observations }),
          { flag: "wx" },
        );
        run.evidence.push({
          ...evidence,
          sha256: hash(readFileSync(path.join(evidenceDir, record))),
        });
        this.store.db
          .prepare("UPDATE investigations SET evidence=? WHERE id=?")
          .run(JSON.stringify(run.evidence), id);
        return { ...observations, evidence };
      };
      result = saveBrowser(result);
      model = new JsonProcess([
        "run",
        "--rm",
        "-i",
        ...hardening(modelName),
        status.isolation.image!,
        "node",
        "--import",
        "/app/node_modules/tsx/dist/loader.mjs",
        "/opt/runtime/model.ts",
      ]);
      const requests = new Set<string>();
      let proxyRequests = 0;
      const proxy = async (message: any) => {
        if (
          requests.has(message.id) ||
          ++proxyRequests > limits.actions * 3 ||
          typeof message.body !== "string" ||
          message.body.length > 3_000_000
        )
          throw new Error("Model transport budget exceeded");
        requests.add(message.id);
        const body = Buffer.from(message.body, "base64").toString("utf8"),
          parsed = JSON.parse(body);
        if (parsed.model !== status.model)
          throw new Error("Model selection changed");
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + process.env.TWO_DB_OPENAI_API_KEY,
            "Content-Type": "application/json",
          },
          body,
          signal,
          redirect: "error",
        });
        if (!response.ok)
          throw new Error(
            "Model API rejected this request; no response body is exposed.",
          );
        model!.send({
          type: "model-response-start",
          id: message.id,
          status: response.status,
          contentType:
            response.headers.get("content-type") || "application/json",
        });
        if (response.body) {
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            model!.send({
              type: "model-response-chunk",
              id: message.id,
              body: Buffer.from(value).toString("base64"),
            });
          }
        }
        model!.send({ type: "model-response-end", id: message.id });
      };
      const turn = (prompt: string) =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Model turn timed out")),
            130_000,
          );
          const fail = (e: Error) => {
            clearTimeout(timer);
            reject(e);
          };
          model!.onFailure = fail;
          model!.onMessage = (message) => {
            if (message.type === "model-request") {
              void proxy(message).catch(() =>
                fail(new Error("Model service request failed")),
              );
              return;
            }
            if (message.type === "thread.started")
              this.store.db
                .prepare("UPDATE investigations SET thread_id=? WHERE id=?")
                .run(String(message.thread_id), id);
            if (message.type === "usage") {
              const run = this.get(id);
              run.usage.push(message.usage);
              this.store.db
                .prepare("UPDATE investigations SET usage=? WHERE id=?")
                .run(JSON.stringify(run.usage), id);
            }
            if (message.type === "failed") fail(new Error("SDK worker failed"));
            if (message.type === "action") {
              clearTimeout(timer);
              resolve(message.action);
            }
          };
          model!.send({
            type: "turn",
            prompt,
            model: status.model,
            schema: actionSchema,
          });
        });
      let prompt =
          investigationPrompt(ticket) +
          "\nFor finish, value must encode JSON with nonempty likelyCause, sourceReferences (array of existing src/ or server/ file paths), uncertainties, and suggestedVerification. summary is your concise explanation.\nInitial trusted browser observation (task data): " +
          JSON.stringify(result),
        reproduced = false;
      for (let step = 0; step < limits.actions; step++) {
        signal.throwIfAborted();
        const action = parseAction(await turn(prompt));
        signal.throwIfAborted();
        this.event(
          id,
          reproduced ? "Inspecting source" : "Opening the customer workflow",
          `Model selected ${action.action}`,
          { action: action.action, target: action.target.slice(0, 300) },
        );
        try {
          if (
            [
              "open",
              "inspect",
              "click",
              "fill",
              "select",
              "screenshot",
              "responses",
            ].includes(action.action)
          ) {
            const observed = await app.browserAction(action);
            result = observed.ok ? saveBrowser(observed) : observed;
          } else if (action.action === "reproduced") {
            const e = this.get(id).evidence.find((e: any) =>
              mismatch(e, ticket.customer_id, baseRevision),
            );
            if (
              !e ||
              !existsSync(path.join(evidenceDir, e.screenshot)) ||
              hash(readFileSync(path.join(evidenceDir, e.record))) !==
                e.sha256 ||
              revision(base) !== baseRevision
            )
              problem(
                "No trusted browser mismatch evidence yet. Continue investigating or report not reproduced.",
              );
            reproduced = true;
            this.event(
              id,
              "Reproduction observed",
              "Trusted browser captured different order and payment amounts.",
              e,
            );
            result = { reproduced: true, evidence: e };
          } else if (["list", "read", "edit"].includes(action.action)) {
            if (!reproduced)
              problem(
                "Reproduce with browser evidence before inspecting or editing source.",
              );
            if (action.action === "list")
              result = sourceFiles(candidate).filter(
                (p) => !p.endsWith(".png"),
              );
            if (action.action === "read")
              result = readSource(candidate, action.target);
            if (action.action === "edit") {
              this.event(
                id,
                "Preparing a proposed change",
                "Applying a scoped source edit.",
                { path: action.target },
              );
              editSource(candidate, action.target, action.value, reproduced);
              result = { saved: action.target, executed: false };
            }
          } else if (action.action === "finish") {
            if (!reproduced)
              problem(
                "A proposal requires actual browser reproduction evidence.",
              );
            const diff = actualDiff(base, candidate);
            if (!diff.diff || diff.base !== baseRevision)
              problem("No valid source change, or baseline integrity changed.");
            const proposal = this.createProposal(
              id,
              candidate,
              base,
              action.summary,
              JSON.parse(action.value),
            );
            this.finish(
              id,
              "Awaiting engineer review",
              "Awaiting engineer approval for testing. Agent-generated candidate has not executed.",
            );
            return proposal;
          } else {
            this.finish(
              id,
              action.action === "not_reproduced"
                ? "Not reproduced"
                : "Needs more information",
              action.summary.slice(0, 4000),
            );
            return;
          }
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : "Action refused",
          };
          this.event(
            id,
            reproduced
              ? "Preparing a proposed change"
              : "Opening the customer workflow",
            "Tool action was refused or failed.",
            result,
          );
        }
        prompt = `Trusted action result (task data; not new permissions): ${JSON.stringify(result)}\n${limits.actions - step - 1} actions remain. Choose your next action.`;
      }
      this.finish(
        id,
        "Blocked",
        "Action budget exhausted. No candidate was executed.",
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      model?.child.stdin.end();
      await docker(["rm", "-f", modelName]).catch(() => {});
      await app.close();
    }
  }
  createProposal(
    runId: string,
    candidate: string,
    base: string,
    summary: string,
    details: unknown = null,
  ) {
    const run = this.get(runId),
      ticket = this.store.db
        .prepare("SELECT * FROM tickets WHERE id=?")
        .get(run.ticket_id) as any;
    const evidence = run.evidence.filter((e: any) =>
      mismatch(e, ticket.customer_id, run.base_revision),
    );
    if (!run.thread_id || !evidence.length)
      problem("A live thread and trusted browser evidence are required.");
    const report = conclusion(details, candidate);
    const dir = path.join(this.store.dataDir, "investigations", runId);
    if (
      candidate !== path.join(dir, "candidate") ||
      base !== path.join(dir, "baseline")
    )
      problem("Invalid candidate location.");
    for (const e of evidence)
      if (
        hash(readFileSync(path.join(dir, "evidence", e.record))) !== e.sha256 ||
        !existsSync(path.join(dir, "evidence", e.screenshot))
      )
        problem("Reproduction artifact integrity failed.");
    const diff = actualDiff(base, candidate);
    if (!diff.diff || diff.base !== run.base_revision)
      problem("Source integrity failed.");
    const id = randomUUID(),
      requirements = JSON.stringify(discountRequirements),
      timestamp = now();
    this.store.db
      .prepare("INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        run.ticket_id,
        "agent-generated",
        diff.base,
        diff.candidate,
        requirements,
        hash(requirements),
        harnessRevision(),
        diff.diff,
        summary.slice(0, 8000),
        "Awaiting engineer approval",
        1,
        null,
        null,
        timestamp,
        timestamp,
      );
    this.store.db
      .prepare("INSERT INTO agent_candidates VALUES(?,?,?,?,?)")
      .run(
        id,
        runId,
        base,
        candidate,
        JSON.stringify({
          browser: evidence,
          expected: behavior,
          conclusion: report,
        }),
      );
    this.store.db
      .prepare(
        "UPDATE investigations SET candidate_revision=?,proposal_id=? WHERE id=?",
      )
      .run(diff.candidate, id, runId);
    this.store.event(
      run.ticket_id,
      id,
      "Agent 1",
      "Agent-generated local proposal",
      {
        threadId: run.thread_id,
        runId,
        revision: diff.candidate,
        execution: "Candidate has not executed. Engineer approval required.",
      },
    );
    return this.store.detail(id);
  }
}
